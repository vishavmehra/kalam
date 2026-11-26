import { describe, expect, it } from 'vitest';
import { createMemoryWidgetStore, createWidgetService, newDraft, widgetSources } from '@/core/widgets';
import { chaiSpec, fakeEngine, fakePlatform, NOON, record, storedApp } from '@/core/widgets/test-kit';
import { createWidgetsController } from './controller';
import { WIDGET_UI } from './copy';

const APP = 'app_chai01';
const OTHER = 'app_other01';

function setup(opts: Parameters<typeof fakePlatform>[0] = {}) {
  const apps = [storedApp(chaiSpec(APP)), storedApp(chaiSpec(OTHER, { name: 'Other Shop' }))];
  const platform = fakePlatform(opts);
  const store = createMemoryWidgetStore();
  let n = 0;
  const service = createWidgetService({
    store, platform, engine: fakeEngine,
    apps: { list: async () => apps }, records: { listAll: async () => ({ orders: [record(APP, 'orders', { name: 'Tea', qty: 2 })], notes: [] }) },
    state: { all: async () => ({}) }, newId: () => `id${String(++n).padStart(8, '0')}`, now: () => NOON.getTime(),
  });
  const controller = (appId?: string) => createWidgetsController({ service, appId, onChanged: (l) => store.subscribe(l) });
  return { service, platform, store, controller };
}
const settle = () => new Promise((r) => setTimeout(r, 5));
const chai = widgetSources(chaiSpec(APP));
const statRef = chai.find((c) => c.kind === 'stat')!.ref;

describe('the widget screens state', () => {
  it('loads this app\'s widgets, what it could show, what the device can do and the settings', async () => {
    const { controller, service } = setup();
    await service.create(newDraft(APP, 'Cups', statRef));
    await service.create(newDraft(OTHER, 'Elsewhere', { ...statRef }));
    const c = controller(APP);
    expect(c.getState().phase).toBe('loading');
    c.start();
    await settle();
    const s = c.getState();
    expect(s.phase).toBe('ready');
    expect(s.views.map((v) => v.widget.title)).toEqual(['Cups']);
    expect(s.candidates.map((x) => x.key)).toEqual(chai.map((x) => x.key));
    expect(s.availability).toMatchObject({ supported: true, canPin: true });
    expect(s.prefs).toEqual({ webShortcuts: false });
    c.stop();
  });

  it('lists every widget, and no candidates, without an app', async () => {
    const { controller, service } = setup();
    await service.create(newDraft(APP, 'Cups', statRef));
    await service.create(newDraft(OTHER, 'Elsewhere', statRef));
    const c = controller();
    c.start();
    await settle();
    expect(c.getState().views.map((v) => v.widget.title)).toEqual(['Cups', 'Elsewhere']);
    expect(c.getState().candidates).toEqual([]);
    c.stop();
  });

  it('follows changes made anywhere, and tells its listeners', async () => {
    const { controller, service } = setup();
    const c = controller(APP);
    let heard = 0;
    c.subscribe(() => void (heard += 1));
    c.start();
    await settle();
    await service.create(newDraft(APP, 'Cups', statRef));
    await settle();
    expect(c.getState().views).toHaveLength(1);
    expect(heard).toBeGreaterThan(1);
    c.stop();
    await service.create(newDraft(APP, 'Another', statRef));
    await settle();
    expect(c.getState().views).toHaveLength(1);
  });

  it('creates, updates and removes through the service and says so in plain words', async () => {
    const { controller } = setup();
    const c = controller(APP);
    c.start();
    await settle();
    const made = await c.create(newDraft(APP, 'Cups', statRef));
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(c.getState().views).toHaveLength(1);
    expect(await c.update(made.widget.id, { title: 'Renamed' })).toMatchObject({ ok: true });
    expect(c.getState().views[0].widget.title).toBe('Renamed');
    expect(await c.remove(made.widget.id)).toEqual({ ok: true, message: WIDGET_UI.added.removed });
    expect(c.getState().views).toEqual([]);
    c.stop();
  });

  it('says what happened when the system is asked to add a widget, and when it cannot', async () => {
    const { controller, platform } = setup();
    const c = controller(APP);
    c.start();
    const made = await c.create(newDraft(APP, 'Cups', statRef));
    if (!made.ok) throw new Error('setup');
    expect(await c.addToHomeScreen(made.widget.id)).toMatchObject({ ok: true, message: WIDGET_UI.added.asked });
    platform.pinResult = { ok: false, reason: 'unsupported', message: 'This launcher cannot add widgets from an app.' };
    expect(await c.addToHomeScreen(made.widget.id)).toMatchObject({ ok: false, message: 'This launcher cannot add widgets from an app.' });
    c.stop();
  });

  it('saves settings and clears everything', async () => {
    const { controller, store, platform } = setup();
    const c = controller();
    c.start();
    await settle();
    expect((await c.setPrefs({ webShortcuts: true })).ok).toBe(true);
    expect(c.getState().prefs).toEqual({ webShortcuts: true });
    await c.create(newDraft(APP, 'Cups', statRef));
    expect(await c.clearAll()).toEqual({ ok: true, message: WIDGET_UI.settings.cleared });
    expect(await store.list()).toEqual([]);
    expect(c.getState().prefs).toEqual({ webShortcuts: false });
    expect(platform.cleared).toBeGreaterThan(0);
    c.stop();
  });

  it('shows a failure as a failed phase, never as an empty list', async () => {
    const { controller, service } = setup();
    service.list = async () => {
      throw new Error('disk');
    };
    const c = controller(APP);
    c.start();
    await settle();
    expect(c.getState().phase).toBe('failed');
    c.stop();
  });
});
