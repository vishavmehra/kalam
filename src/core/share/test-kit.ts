/** Shared test helpers for the sharing tests (imported only by *.test.ts files). */
import type { KalamRecord, RecordRepository, RecordValue, StoredApp } from '../contracts';
import { fixtureSpec } from '../backup/test-fixtures';
import type { KalamCollection, KalamSpec } from '../spec/schema';
import { createShareService, type ShareLogEvent, type ShareService } from './service';
import { createMemoryShareLinkStore, type ShareLinkStore } from './store';

export const SENTINEL = 'SENTINEL-ZETA-991';

export const customers: KalamCollection = {
  label: 'Customers',
  fields: {
    name: { type: 'text', label: 'Name', required: true },
    phone: { type: 'text', label: 'Phone' },
    city: { type: 'enum', label: 'City', options: ['Delhi', 'Pune'] },
    vip: { type: 'boolean', label: 'VIP' },
    joined: { type: 'date', label: 'Joined' },
    credit: { type: 'number', label: 'Credit' },
    secret_note: { type: 'text', label: 'Private note' },
  },
};

export const orders: KalamCollection = {
  label: 'Orders',
  fields: {
    customer_name: { type: 'text', label: 'Customer name', required: true },
    phone: { type: 'text', label: 'Phone' },
    city: { type: 'text', label: 'City' },
    amount: { type: 'number', label: 'Amount' },
  },
};

export function specWith(id: string, name: string, collections: Record<string, KalamCollection>, meta: Partial<KalamSpec['meta']> = {}): KalamSpec {
  return { ...fixtureSpec(id, name), collections, meta: { createdAt: 1, ...meta } };
}

export const APP_C = 'app_customers';
export const APP_O = 'app_orders';
export const APP_X = 'app_stranger';

export function storedApp(spec: KalamSpec): StoredApp {
  return { id: spec.id, spec, createdAt: 1, updatedAt: 1, origin: { route: 'cloud' } };
}

/** Records for several apps in memory, with call tracking and the change listeners the runtime uses. */
export function fakeRecords() {
  const rows: KalamRecord[] = [];
  const reads: string[] = [];
  const listeners = new Map<string, Set<() => void>>();
  let n = 0;
  const emit = (appId: string) => listeners.get(appId)?.forEach((l) => l());
  const failWith: { next?: Error } = {};
  const repo: RecordRepository = {
    async list(appId, collectionId) {
      reads.push(`${appId}/${collectionId}`);
      return rows.filter((r) => r.appId === appId && r.collectionId === collectionId).map((r) => ({ ...r, values: { ...r.values } }));
    },
    async listAll(appId) {
      const out: Record<string, KalamRecord[]> = {};
      for (const r of rows.filter((x) => x.appId === appId)) (out[r.collectionId] ??= []).push(r);
      return out;
    },
    async insert(appId, collectionId, values) {
      if (failWith.next) {
        const e = failWith.next;
        failWith.next = undefined;
        throw e;
      }
      const row: KalamRecord = { id: `rec${++n}`, appId, collectionId, createdAt: n, updatedAt: n, values: { ...values } };
      rows.push(row);
      emit(appId);
      return row;
    },
    async update(appId, collectionId, id, values) {
      const row = rows.find((r) => r.id === id && r.appId === appId && r.collectionId === collectionId);
      if (!row) throw new Error('Record not found');
      row.values = { ...row.values, ...values };
      emit(appId);
      return row;
    },
    async remove(appId, collectionId, id) {
      const i = rows.findIndex((r) => r.id === id && r.appId === appId && r.collectionId === collectionId);
      if (i >= 0) rows.splice(i, 1);
      emit(appId);
    },
    subscribe(appId, listener) {
      const set = listeners.get(appId) ?? new Set<() => void>();
      listeners.set(appId, set);
      set.add(listener);
      return () => void set.delete(listener);
    },
  };
  return {
    repo, rows, reads, emit, failWith,
    add: async (appId: string, collectionId: string, values: Record<string, RecordValue>) => repo.insert(appId, collectionId, values),
  };
}

export interface Rig {
  service: ShareService;
  store: ShareLinkStore;
  records: ReturnType<typeof fakeRecords>;
  apps: Map<string, StoredApp>;
  events: ShareLogEvent[];
  clock: { t: number };
}

/** Customers, orders and an unrelated third app, an in-memory store and a counting id source. */
export function rig(extra: StoredApp[] = []): Rig {
  const apps = new Map<string, StoredApp>();
  for (const a of [
    storedApp(specWith(APP_C, 'Customer Book', { customers })),
    storedApp(specWith(APP_O, 'Order Book', { orders })),
    storedApp(specWith(APP_X, 'Stranger', { customers })),
    ...extra,
  ]) apps.set(a.id, a);
  const store = createMemoryShareLinkStore();
  const records = fakeRecords();
  const events: ShareLogEvent[] = [];
  const clock = { t: 1_000 };
  let ids = 0;
  const service = createShareService({
    store,
    apps: { get: async (id) => apps.get(id) },
    records: records.repo,
    newId: () => `abcdef${String(++ids).padStart(6, '0')}`,
    now: () => ++clock.t,
    log: (e) => events.push(e),
  });
  return { service, store, records, apps, events, clock };
}

export const NAME_PHONE = [{ source: 'name', target: 'customer_name' }, { source: 'phone', target: 'phone' }];
