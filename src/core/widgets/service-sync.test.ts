/**
 * What the person is told and what reaches the home screen when things go wrong or overlap: a publish that fails, syncs that
 * run at the same time, translated labels, and widgets written by a newer Kalam.
 */
import { describe, expect, it } from 'vitest';
import { WIDGET_COPY, WIDGET_HOME_LABELS } from './copy';
import { newDraft, widgetDefinitionSchema, type WidgetDefinition } from './model';
import { widgetPayloadSchema } from './payload';
import { createWidgetService } from './service';
import { createBlobWidgetStore, createMemoryWidgetStore, STORE_VERSION, type WidgetStore, type WidgetStoreData } from './store';
import { chaiSpec, fakeEngine, fakePlatform, NOON, record, storedApp } from './test-kit';

const APP = 'app_chai01';
const stat: WidgetDefinition['source'] = { kind: 'stat', screen: 'home', component: 'cups' };
const draft = (title = 'Cups sold') => newDraft(APP, title, stat);
const sent = (json: string) => widgetPayloadSchema.parse(JSON.parse(json));

function setup(opts: Parameters<typeof fakePlatform>[0] = {}, extra: { labels?: () => unknown; store?: WidgetStore } = {}) {
  const apps = [storedApp(chaiSpec())];
  const platform = fakePlatform(opts);
  const store = extra.store ?? createMemoryWidgetStore();
  let seed = 0;
  const held = { qty: 2 };
  const service = createWidgetService({
    store, platform, engine: fakeEngine,
    apps: { list: async () => apps },
    records: { listAll: async () => ({ orders: [record(APP, 'orders', { name: 'Tea', qty: held.qty })], notes: [] }) },
    state: { all: async () => ({}) },
    newId: () => `abcd${String(++seed).padStart(6, '0')}`,
    now: () => NOON.getTime(),
    ...(extra.labels ? { labels: extra.labels as never } : {}),
  });
  return { service, platform, store, held };
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('a widget the home screen did not take', () => {
  it('is saved, and the result says the home screen was not updated', async () => {
    const { service, platform, store } = setup();
    platform.publish = async () => {
      throw new Error('disk full');
    };
    const made = await service.create(draft());
    expect(made).toMatchObject({ ok: true, sync: { platform: 'failed' } });
    expect((await store.list()).length).toBe(1);
  });

  it('says the home screen took it when it did, and that there is none on a device without widgets', async () => {
    expect(await setup().service.create(draft())).toMatchObject({ ok: true, sync: { platform: 'ok', published: 1 } });
    const web = setup({ availabilityNow: { supported: false, platform: 'web', reason: 'The web app has no home-screen widgets.' } });
    expect(await web.service.create(draft())).toMatchObject({ ok: true, sync: { platform: 'unsupported' } });
  });

  it('does not ask the system to add it, and does not call it unknown', async () => {
    const { service, platform } = setup();
    const made = await service.create(draft());
    if (!made.ok) throw new Error('setup');
    platform.publish = async () => {
      throw new Error('disk full');
    };
    const r = await service.addToHomeScreen(made.widget.id);
    expect(r).toEqual({ ok: false, reason: 'not_published', message: WIDGET_COPY.status.home_not_updated });
    expect(platform.pins).toEqual([]);
  });
});

describe('syncs that overlap', () => {
  it('reach the home screen in the order they were asked, so an older snapshot never lands last', async () => {
    const { service, platform, held } = setup();
    await service.create(draft());
    platform.published.length = 0;
    let first = true;
    platform.publish = async (json) => {
      // The first publish is slow: without a queue the second would finish before it.
      if (first) {
        first = false;
        await pause(30);
      }
      platform.published.push(json);
    };
    const a = service.sync('open');
    await pause(5);
    held.qty = 9;
    const b = service.sync('open');
    await Promise.all([a, b]);
    expect(platform.published.map((j) => sent(j).widgets[0].entries[0].headline)).toEqual(['2 cups', '9 cups']);
  });

  it('share one run for changes asked while another run is still going', async () => {
    const { service, platform, held } = setup();
    await service.create(draft());
    platform.published.length = 0;
    let slow = true;
    platform.publish = async (json) => {
      if (slow) {
        slow = false;
        await pause(30);
      }
      platform.published.push(json);
    };
    const running = service.sync('change');
    await pause(5);
    held.qty = 4;
    const waiting = [service.sync('change'), service.sync('change'), service.sync('change')];
    await Promise.all([running, ...waiting]);
    expect(platform.published).toHaveLength(2);
    expect(sent(platform.published[1]).widgets[0].entries[0].headline).toBe('4 cups');
  });

  it('keep going after one run fails', async () => {
    const { service, platform } = setup();
    await service.create(draft());
    const real = platform.publish;
    platform.publish = async () => {
      throw new Error('once');
    };
    expect(await service.sync('open')).toMatchObject({ platform: 'failed' });
    platform.publish = real;
    expect(await service.sync('open')).toMatchObject({ platform: 'ok', published: 1 });
  });
});

describe('the words the home screen prints', () => {
  const translated = { ...WIDGET_HOME_LABELS, done: 'Hecho', notDone: 'Pendiente', stale: 'Abre Kalam para actualizar' };

  it('are the English defaults unless the sender supplies others', async () => {
    const { service, platform } = setup();
    await service.create(draft());
    expect(sent(platform.published[0]).labels).toEqual(WIDGET_HOME_LABELS);
  });

  it('can be translated by the sender', async () => {
    const { service, platform } = setup({}, { labels: () => translated });
    await service.create(draft());
    expect(sent(platform.published[0]).labels).toMatchObject({ done: 'Hecho', notDone: 'Pendiente', stale: 'Abre Kalam para actualizar' });
  });

  it('fall back to the defaults when a translation is missing, too long or throws', async () => {
    for (const labels of [() => ({ stale: 'x' }), () => ({ ...translated, done: 'x'.repeat(200) }), () => { throw new Error('no catalogue'); }]) {
      const { service, platform } = setup({}, { labels });
      expect(await service.create(draft())).toMatchObject({ ok: true, sync: { platform: 'ok' } });
      expect(sent(platform.published[0]).labels).toEqual(WIDGET_HOME_LABELS);
    }
  });
});

describe('widgets written by a newer Kalam', () => {
  const mine = (id: string): WidgetDefinition => widgetDefinitionSchema.parse({ ...draft(), id, v: 1, createdAt: 1, updatedAt: 1 });
  /** A row this build cannot read: a newer schema version and a field it does not know. */
  const future = { id: 'wgt_future0001', v: 2, appId: APP, title: 'Later', source: { kind: 'gauge' }, extra: true };

  function blobStore(initial: WidgetStoreData) {
    let data: WidgetStoreData = JSON.parse(JSON.stringify(initial));
    return { store: createBlobWidgetStore({ load: async () => data, save: async (next) => void (data = JSON.parse(JSON.stringify(next))) }), read: () => data };
  }
  const prefs = { webShortcuts: false };

  it('are kept untouched while this build adds, changes and removes its own', async () => {
    const { store, read } = blobStore({ v: STORE_VERSION, widgets: [mine('wgt_mine000001'), future], prefs });
    expect((await store.list()).map((w) => w.id)).toEqual(['wgt_mine000001']);
    await store.put(mine('wgt_mine000002'));
    await store.setPrefs({ webShortcuts: true });
    await store.remove('wgt_mine000001');
    expect(read().widgets).toContainEqual(future);
    expect((await store.list()).map((w) => w.id)).toEqual(['wgt_mine000002']);
  });

  it('go when their app goes, or when the person removes them by id', async () => {
    const { store, read } = blobStore({ v: STORE_VERSION, widgets: [future], prefs });
    expect(await store.removeForApp('app_other001')).toBe(0);
    expect(read().widgets).toHaveLength(1);
    await store.removeForApp(APP);
    expect(read().widgets).toEqual([]);
    const again = blobStore({ v: STORE_VERSION, widgets: [future], prefs });
    await again.store.remove('wgt_future0001');
    expect(again.read().widgets).toEqual([]);
  });

  it('are not overwritten by an older Kalam, which says why, while "Delete everything" still works', async () => {
    const { store, read } = blobStore({ v: STORE_VERSION + 1, widgets: [mine('wgt_mine000001'), future], prefs });
    expect((await store.list()).map((w) => w.id)).toEqual(['wgt_mine000001']);
    await expect(store.put(mine('wgt_mine000002'))).rejects.toMatchObject({ kind: 'newer' });
    await expect(store.setPrefs({ webShortcuts: true })).rejects.toMatchObject({ kind: 'newer' });
    expect(read().widgets).toHaveLength(2);

    const { service } = setup({}, { store });
    expect(await service.create(draft())).toMatchObject({ ok: false, reason: 'store', message: WIDGET_COPY.refuse.store_newer });

    await store.clear();
    expect(read().widgets).toEqual([]);
    expect(read().v).toBe(STORE_VERSION);
  });

  it('treat a value from before versions existed as version 1', async () => {
    const { store, read } = blobStore({ widgets: [mine('wgt_mine000001')], prefs });
    await store.put(mine('wgt_mine000002'));
    expect(read()).toMatchObject({ v: STORE_VERSION });
    expect(read().widgets).toHaveLength(2);
  });
});
