/**
 * What the sheet offers on each kind of device, and what it says afterwards. The web has no home screen widgets, and that
 * must never stop a person making one: it shows as a card on the shelf (docs/14 §18.3).
 */
import { describe, expect, it } from 'vitest';
import { createMemoryWidgetStore, createWidgetService, newDraft, widgetSources, type WidgetAvailability } from '@/core/widgets';
import { chaiSpec, fakeEngine, fakePlatform, NOON, record, storedApp } from '@/core/widgets/test-kit';
import { createWidgetsController } from './controller';
import { WIDGET_UI } from './copy';
import { addedMessage, savedMessage, widgetAbilities } from './sheet-model';

const web: WidgetAvailability = { supported: false, platform: 'web', reason: 'The web app has no home-screen widgets.' };
const noModule: WidgetAvailability = { supported: false, platform: 'android', reason: 'This build has no widget module.' };
const android: WidgetAvailability = { supported: true, platform: 'android', canPin: true, canCount: true };
const androidNoPin: WidgetAvailability = { supported: true, platform: 'android', canPin: false, canCount: true };
const ios: WidgetAvailability = { supported: true, platform: 'ios', canPin: false, canCount: false };

describe('what the sheet offers', () => {
  it('lets a widget be made on every device, and only asks the system where the system can be asked', () => {
    expect(widgetAbilities(web)).toEqual({ canCreate: true, canPin: false, shelfOnly: true });
    expect(widgetAbilities(noModule)).toEqual({ canCreate: true, canPin: false, shelfOnly: true });
    expect(widgetAbilities(android)).toEqual({ canCreate: true, canPin: true, shelfOnly: false });
    expect(widgetAbilities(androidNoPin)).toEqual({ canCreate: true, canPin: false, shelfOnly: false });
    expect(widgetAbilities(ios)).toEqual({ canCreate: true, canPin: false, shelfOnly: false });
  });

  it('waits until the device has answered', () => {
    expect(widgetAbilities(undefined)).toEqual({ canCreate: false, canPin: false, shelfOnly: false });
  });
});

describe('what the sheet says', () => {
  const ok = { published: 1, removed: 0, broken: 0 };
  it('says where a saved widget will show, and when the home screen did not take it', () => {
    expect(savedMessage({ ...ok, platform: 'ok' })).toBe(WIDGET_UI.added.saved);
    expect(savedMessage({ ...ok, platform: 'unsupported' })).toBe(WIDGET_UI.added.savedCard);
    expect(savedMessage({ ...ok, platform: 'failed' })).toBe(WIDGET_UI.status.syncFailed);
    expect(WIDGET_UI.status.syncFailed).toContain('saved');
  });

  it('does not say "saved" twice after Save and add', () => {
    const outcome = { ok: false as const, reason: 'failed' as const, message: 'The system could not be asked to add the widget.' };
    expect(addedMessage('Widget saved.', { ok: true, message: WIDGET_UI.added.asked, outcome: { ok: true, requested: true } })).toBe(WIDGET_UI.added.asked);
    expect(addedMessage('Widget saved.', { ok: false, message: outcome.message, outcome })).toBe(`Widget saved. ${outcome.message}`);
    const notPublished = { ok: false as const, reason: 'not_published' as const, message: WIDGET_UI.status.syncFailed };
    expect(addedMessage('ignored', { ok: false, message: notPublished.message, outcome: notPublished })).toBe(WIDGET_UI.status.syncFailed);
  });
});

describe('a web visitor with no home screen widgets', () => {
  const APP = 'app_chai01';
  function setup(availabilityNow: WidgetAvailability) {
    const apps = [storedApp(chaiSpec(APP))];
    const platform = fakePlatform({ availabilityNow });
    const store = createMemoryWidgetStore();
    let n = 0;
    const service = createWidgetService({
      store, platform, engine: fakeEngine,
      apps: { list: async () => apps }, records: { listAll: async () => ({ orders: [record(APP, 'orders', { name: 'Tea', qty: 2 })], notes: [] }) },
      state: { all: async () => ({}) }, newId: () => `id${String(++n).padStart(8, '0')}`, now: () => NOON.getTime(),
    });
    return { platform, controller: createWidgetsController({ service, appId: APP, onChanged: (l) => store.subscribe(l) }) };
  }
  const settle = () => new Promise((r) => setTimeout(r, 5));

  for (const [name, availability] of [['the web', web], ['a build without the module', noModule]] as const) {
    it(`can make, see and remove a widget on ${name}`, async () => {
      const { controller, platform } = setup(availability);
      controller.start();
      await settle();
      const s = controller.getState();
      expect(s.phase).toBe('ready');
      // What the sheet reads to decide what to show: the form and "New widget" are offered, "Add to home screen" is not.
      expect(widgetAbilities(s.availability)).toMatchObject({ canCreate: true, canPin: false, shelfOnly: true });
      expect(s.candidates.length).toBeGreaterThan(0);

      const stat = s.candidates.find((c) => c.kind === 'stat') ?? widgetSources(chaiSpec(APP))[0];
      const made = await controller.create(newDraft(APP, 'Cups', stat.ref));
      if (!made.ok) throw new Error(made.message);
      expect(savedMessage(made.sync)).toBe(WIDGET_UI.added.savedCard);
      expect(controller.getState().views.map((v) => v.widget.title)).toEqual(['Cups']);
      // Nothing was sent to a home screen that does not exist.
      expect(platform.published).toEqual([]);
      expect(await controller.preview(newDraft(APP, 'Cups', stat.ref))).toMatchObject({ ok: true, body: { headline: '2 cups' } });

      expect((await controller.remove(made.widget.id)).ok).toBe(true);
      expect(controller.getState().views).toEqual([]);
      controller.stop();
    });
  }
});
