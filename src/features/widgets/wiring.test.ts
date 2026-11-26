/**
 * The widget core over the real pieces of the app: the runtime's own formatting, the device store and the web install
 * menu. These are the parts that must not drift apart from the screens the person already uses.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KalamRecord, RecordValue } from '@/core/contracts';
import { statCurrency } from '@/core/spec/v11';
import { createWidgetService, newDraft, buildTimeline, type WidgetDefinition } from '@/core/widgets';
import { chaiSpec, fakePlatform, NOON, record, storedApp } from '@/core/widgets/test-kit';
import { collectionValues, evaluate, formatFieldValue, formatStat, formulaContext, queryList } from '@/runtime/engine/data';
import { collectionFieldDefs } from '@/runtime/engine/fields';

const { asyncData } = vi.hoisted(() => ({ asyncData: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => asyncData.get(k) ?? null,
    setItem: async (k: string, v: string) => void asyncData.set(k, v),
    removeItem: async (k: string) => void asyncData.delete(k),
  },
}));

const { widgetEngine } = await import('./engine');
const { createDeviceWidgetStore, WIDGETS_STORAGE_KEY } = await import('./device-store');
const { createWidgetPlatform, PINNED_CACHE, PINNED_URL } = await import('./platform.web');

const APP = 'app_chai01';
const spec = chaiSpec(APP, {
  settings: { currency: 'INR' },
  screens: [
    {
      id: 'home', title: 'Home',
      children: [
        { id: 'money', type: 'stat', label: 'Takings', expr: 'sum(orders.qty) * 10', format: 'currency' },
        { id: 'soon', type: 'list', source: 'orders', primary: 'name', secondary: 'due', sort: { field: 'due', direction: 'asc' }, limit: 2, label: 'Coming up' },
      ],
    },
    { id: 'add', title: 'Add', form: 'orders', children: [] },
  ],
});
const rows: KalamRecord[] = [
  record(APP, 'orders', { name: 'Tea', qty: 5, due: '2026-12-03', paid: false }),
  record(APP, 'orders', { name: 'Coffee', qty: 7.5, due: '2026-12-01', paid: true }),
  record(APP, 'orders', { name: 'Lassi', qty: 2, due: '2026-12-02', paid: false }),
];
const def = (source: WidgetDefinition['source']): WidgetDefinition => ({ ...newDraft(APP, 'W', source), id: 'wgt_a1b2c3d4e5', v: 1, createdAt: 1, updatedAt: 1 });
const data = { records: { orders: rows, notes: [] as KalamRecord[] }, state: {} as Record<string, RecordValue> };

describe('a widget reads the same as the screen it points at', () => {
  it('prints a stat the way the Stat component does (formula, format, currency)', () => {
    const stat = spec.screens[0].children[0];
    if (stat.type !== 'stat') throw new Error('setup');
    const asTheScreenDoes = formatStat(
      stat, evaluate(stat.expr, formulaContext(collectionValues(spec, data.records), {}, {}, NOON, null), spec.lang), spec.lang, statCurrency(spec, stat),
    );
    const t = buildTimeline(spec, def({ kind: 'stat', screen: 'home', component: 'money' }), data, widgetEngine, NOON);
    expect(t.ok && t.entries[0].headline).toBe(asTheScreenDoes);
    expect(asTheScreenDoes).toBe('₹145.00');
  });

  it('shows the rows of a list the way the List component orders, limits and formats them', () => {
    const list = spec.screens[0].children[1];
    if (list.type !== 'list') throw new Error('setup');
    const ctx = formulaContext(collectionValues(spec, data.records), {}, {}, NOON, null);
    const defs = collectionFieldDefs(spec, 'orders') ?? {};
    const asTheScreenDoes = queryList(list, rows, ctx, spec.lang).rows.map((r) => ({
      text: formatFieldValue(defs.name, r.values.name, spec.lang), detail: formatFieldValue(defs.due, r.values.due, spec.lang),
    }));
    const t = buildTimeline(spec, def({ kind: 'list', screen: 'home', component: 'soon', rows: 5, fields: ['name', 'due'] }), data, widgetEngine, NOON);
    expect(t.ok && t.entries[0].rows).toEqual(asTheScreenDoes);
    expect(asTheScreenDoes).toEqual([{ text: 'Coffee', detail: 'Dec 1, 2026' }, { text: 'Lassi', detail: 'Dec 2, 2026' }]);
  });

  it('counts entries the way count() does', () => {
    const t = buildTimeline(spec, def({ kind: 'count', collection: 'orders' }), data, widgetEngine, NOON);
    expect(t.ok && t.entries[0].headline).toBe('3');
  });
});

describe('widgets on the device', () => {
  beforeEach(() => asyncData.clear());

  it('are kept as one value, read back, and survive a damaged value', async () => {
    const store = createDeviceWidgetStore();
    await store.put(def({ kind: 'count', collection: 'orders' }));
    expect(JSON.parse(asyncData.get(WIDGETS_STORAGE_KEY) as string).widgets).toHaveLength(1);
    expect((await createDeviceWidgetStore().list()).map((w) => w.id)).toEqual(['wgt_a1b2c3d4e5']);
    asyncData.set(WIDGETS_STORAGE_KEY, '{not json');
    expect(await store.list()).toEqual([]);
    await store.put(def({ kind: 'count', collection: 'orders' }));
    expect(await store.list()).toHaveLength(1);
    await store.clear();
    expect(asyncData.has(WIDGETS_STORAGE_KEY)).toBe(false);
  });

  it('work through the service with the real engine and store', async () => {
    const platform = fakePlatform();
    const service = createWidgetService({
      store: createDeviceWidgetStore(), platform, engine: widgetEngine,
      apps: { list: async () => [storedApp(spec)] }, records: { listAll: async () => data.records }, state: { all: async () => ({}) },
      newId: () => 'abcdef012345', now: () => NOON.getTime(),
    });
    const made = await service.create(newDraft(APP, 'Takings', { kind: 'stat', screen: 'home', component: 'money' }));
    expect(made.ok).toBe(true);
    expect(JSON.parse(platform.published[0]).widgets[0].entries[0].headline).toBe('₹145.00');
    expect((await service.list())[0].widget.title).toBe('Takings');
  });
});

describe('the web install menu', () => {
  type Stored = Map<string, string>;
  function fakeCaches(): { caches: unknown; buckets: Map<string, Stored> } {
    const buckets = new Map<string, Stored>();
    const open = async (name: string) => {
      let b = buckets.get(name);
      if (!b) buckets.set(name, (b = new Map()));
      const bucket = b;
      return {
        put: async (url: string, res: Response) => void bucket.set(url, await res.text()),
        delete: async (url: string) => bucket.delete(url),
      };
    };
    return { caches: { open }, buckets };
  }

  it('keeps pinned shortcuts where the service worker looks, and removes them when there are none', async () => {
    const { caches, buckets } = fakeCaches();
    vi.stubGlobal('caches', caches);
    const platform = createWidgetPlatform();
    await platform.setShortcuts([{ name: 'Tea', url: '/app/app_tea0001' }]);
    expect(JSON.parse(buckets.get(PINNED_CACHE)?.get(PINNED_URL) as string)).toEqual([{ name: 'Tea', url: '/app/app_tea0001' }]);
    await platform.setShortcuts([]);
    expect(buckets.get(PINNED_CACHE)?.has(PINNED_URL)).toBe(false);
    vi.unstubAllGlobals();
  });

  it('does nothing, and does not fail, where there is no Cache API', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(createWidgetPlatform().setShortcuts([{ name: 'Tea', url: '/app/app_tea0001' }])).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('reports honestly that the web has no widgets', async () => {
    const p = createWidgetPlatform();
    expect(await p.availability()).toMatchObject({ supported: false, platform: 'web' });
    expect(await p.requestPin('wgt_a1b2c3d4e5')).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  it('uses the cache name and path the built service worker reads', () => {
    const script = readFileSync(fileURLToPath(new URL('../../../scripts/build-pwa.mjs', import.meta.url)), 'utf8');
    expect(script).toContain(`const PINNED_CACHE = '${PINNED_CACHE}';`);
    expect(script).toContain(`const PINNED_URL = '${PINNED_URL}';`);
  });
});
