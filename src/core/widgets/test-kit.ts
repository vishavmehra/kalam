/**
 * Shared by the widget tests: a small valid app, a fake home screen, an engine built on the real formula
 * evaluator, and a store. Not exported from the index and never imported by app code.
 */
import type { KalamRecord, RecordValue, StoredApp } from '../contracts';
import { evaluateFormula, localDate } from '../formula';
import type { KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import type { PinOutcome, WidgetAvailability, WidgetPlatform } from './service';
import type { WidgetEngine } from './snapshot';
import type { WebShortcut } from './shortcuts';

export function chaiSpec(id = 'app_chai01', over: Record<string, unknown> = {}): KalamSpec {
  const spec = {
    id, schemaVersion: '1.1.0', version: 1, name: 'Chai Shop', lang: 'en',
    theme: { primary: '#315C4C', radius: 12, fontScale: 1 },
    collections: {
      orders: {
        label: 'Orders',
        fields: {
          name: { type: 'text', label: 'Item' },
          qty: { type: 'number', label: 'Cups' },
          due: { type: 'date', label: 'Due' },
          paid: { type: 'boolean', label: 'Paid' },
          secret: { type: 'text', label: 'Customer phone' },
          photo: { type: 'image', label: 'Photo' },
        },
      },
      notes: { label: 'Notes', fields: { text: { type: 'text', label: 'Note' } } },
    },
    screens: [
      {
        id: 'home', title: 'Home',
        children: [
          { id: 'cups', type: 'stat', label: 'Cups sold', expr: 'sum(orders.qty)', suffix: ' cups' },
          { id: 'hidden_stat', type: 'stat', label: 'Hidden', expr: 'count(orders)', visible: false },
          {
            id: 'due_today', type: 'list', source: 'orders', primary: 'name', secondary: 'qty', toggleField: 'paid',
            filter: 'due == today', emptyText: 'Nothing due today', label: 'Due today',
          },
        ],
      },
      { id: 'add', title: 'Add order', form: 'orders', children: [{ id: 'item_in', type: 'textInput', label: 'Item', field: 'name' }] },
    ],
    initialScreen: 'home', actions: {}, aiBlocks: {}, intents: {}, meta: { createdAt: 1 },
    ...over,
  };
  const checked = validateSpec(spec);
  if (!checked.ok || !checked.spec) throw new Error(`test spec invalid: ${JSON.stringify(checked.errors)}`);
  return checked.spec;
}

export const storedApp = (spec: KalamSpec, extra: Partial<StoredApp> = {}): StoredApp => ({
  id: spec.id, spec, createdAt: 1, updatedAt: 1, origin: { route: 'manual' }, ...extra,
});

let n = 0;
export function record(appId: string, collectionId: string, values: Record<string, RecordValue>): KalamRecord {
  n += 1;
  return { id: `r${n}`, appId, collectionId, createdAt: 1000 + n, updatedAt: 1000 + n, values };
}

/** The same kinds of answer the app's own screens give, small enough to read: a stat is its number plus prefix and suffix, a list is filtered and newest first. */
export const fakeEngine: WidgetEngine = {
  statText(_spec, stat, ctx) {
    const r = evaluateFormula(stat.expr, ctx);
    if (!r.ok || r.value === null || Array.isArray(r.value)) return '—';
    return `${stat.prefix ?? ''}${String(r.value)}${stat.suffix ?? ''}`;
  },
  listRows(list, records, ctx) {
    const kept = list.filter
      ? records.filter((rec) => {
          const r = evaluateFormula(list.filter as string, { ...ctx, record: rec.values });
          return r.ok && !!r.value;
        })
      : [...records];
    const sorted = kept.sort((a, b) => b.createdAt - a.createdAt);
    return list.limit ? sorted.slice(0, list.limit) : sorted;
  },
  fieldText: (_spec, _collection, _field, value) => (value === undefined || value === null ? '' : String(value)),
};

export interface FakePlatform extends WidgetPlatform {
  published: string[];
  cleared: number;
  pins: string[];
  shortcuts: WebShortcut[][];
  placedNow: Record<string, number>;
  availabilityNow: WidgetAvailability;
  pinResult: PinOutcome;
}

export function fakePlatform(over: Partial<Pick<FakePlatform, 'availabilityNow' | 'pinResult'>> = {}): FakePlatform {
  const p: FakePlatform = {
    published: [], cleared: 0, pins: [], shortcuts: [], placedNow: {},
    availabilityNow: { supported: true, platform: 'android', canPin: true, canCount: true },
    pinResult: { ok: true, requested: true },
    ...over,
    availability: async () => p.availabilityNow,
    publish: async (json) => void p.published.push(json),
    clear: async () => void (p.cleared += 1),
    requestPin: async (id) => {
      p.pins.push(id);
      return p.pinResult;
    },
    placed: async () => p.placedNow,
    setShortcuts: async (list) => void p.shortcuts.push([...list]),
  };
  return p;
}

/** Local noon on a fixed date, so "today" and the midnights after it are the same in every time zone. */
export const NOON = new Date(2026, 10, 25, 12, 0, 0, 0);
export const todayText = localDate(NOON);
export const dayText = (offset: number): string => localDate(new Date(2026, 10, 25 + offset, 12));
