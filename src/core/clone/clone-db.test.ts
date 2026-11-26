/**
 * The clone against the real local database (fake IndexedDB), which checks every entry against the design before it is
 * written: required fields, links, options. The in-memory stores of clone.test.ts skip that check, so this is where a
 * copy that cannot satisfy the design would show.
 */
import { describe, expect, it } from 'vitest';
import type { KalamRecord, RecordValue, StoredApp } from '@/core/contracts';
import { createWebDatabase } from '@/infrastructure/storage/database.web';
import type { KalamLocalDatabase } from '@/infrastructure/storage/kalam-database';
import type { KalamSpec } from '../spec/schema';
import { cloneSpec } from '../versioning';
import { instantiateCatalogEntry } from '../templates/catalog';
import { CloneLeftoverError, applyClonePlan, fieldsToRelax, planClone, type CloneStore } from './index';

let counter = 0;
const fresh = () => createWebDatabase(`kalam-clone-${++counter}-${Date.now()}`);
const NOW = 1_794_950_000_000;

/** The Kirana Credit Book, changed by `initial` before any entry exists and by `later` after the entries were written. */
async function original(
  db: KalamLocalDatabase,
  opts: { initial?: (s: KalamSpec) => void; fill: (db: KalamLocalDatabase) => Promise<void>; later?: (s: KalamSpec) => void },
): Promise<StoredApp> {
  const built = instantiateCatalogEntry('kirana_credit_book', { appId: 'app_source', now: NOW - 1000, lang: 'en' });
  if (!built.ok) throw new Error(built.error);
  const spec = cloneSpec(built.value.spec);
  opts.initial?.(spec);
  const app: StoredApp = { id: 'app_source', spec, createdAt: NOW - 1000, updatedAt: NOW - 1000, origin: { ...built.value.origin } };
  await db.apps.save(app, { summary: 'Created', source: 'create' });
  await opts.fill(db);
  if (opts.later) {
    const stored = (await db.apps.get('app_source'))!;
    const next = cloneSpec(stored.spec);
    opts.later(next);
    await db.apps.save({ ...stored, spec: next }, { summary: 'Rules tightened', source: 'edit' });
  }
  return (await db.apps.get('app_source'))!;
}

async function copyOf(db: KalamLocalDatabase, source: StoredApp) {
  const records = Object.values(await db.records.listAll(source.id)).flat();
  const planned = planClone(source, { name: 'Branch Two', mode: 'with_records', confirmedRecords: true }, { newId: () => 'app_copy1', now: NOW, records, state: {} });
  if (!planned.ok) throw new Error(planned.message);
  const outcome = await applyClonePlan(planned.plan, db);
  return { plan: planned.plan, outcome };
}

const byName = (rows: KalamRecord[]) => Object.fromEntries(rows.map((r) => [String(r.values.name ?? r.values.kind), r]));

const kirana = async (db: KalamLocalDatabase) => {
  const ramesh = await db.records.insert('app_source', 'customers', { name: 'Ramesh', phone: '98xxxxxx01' });
  const sunita = await db.records.insert('app_source', 'customers', { name: 'Sunita' }); // no phone
  await db.records.insert('app_source', 'entries', { customer: ramesh.id, kind: 'Credit given', amount: 100, date: '2026-11-01' });
  await db.records.insert('app_source', 'entries', { customer: sunita.id, kind: 'Payment received', amount: 40, date: '2026-11-02' });
  return { ramesh, sunita };
};

describe('applyClonePlan on the real database', () => {
  it('a plain copy needs one saved version and rewrites every link', async () => {
    const db = fresh();
    const source = await original(db, { fill: async (d) => { await kirana(d); } });
    const { plan, outcome } = await copyOf(db, source);
    expect(fieldsToRelax(plan)).toEqual([]);
    expect(outcome).toMatchObject({ entriesCopied: 4, skippedEntries: 0, skippedPictures: 0 });
    expect((await db.versions.list('app_copy1')).map((v) => v.version)).toEqual([1]);
    const all = await db.records.listAll('app_copy1');
    const customers = new Set(all.customers!.map((c) => c.id));
    expect(all.entries!.every((e) => customers.has(String(e.values.customer)))).toBe(true);
  });

  it('copies entries of a list whose picture field is required, without the pictures, and keeps the field required', async () => {
    const db = fresh();
    const source = await original(db, {
      initial: (s) => { s.collections.customers!.fields.photo = { type: 'image', label: 'Photo' }; },
      fill: async (d) => {
        await d.records.insert('app_source', 'customers', { name: 'Ramesh', photo: 'local:abc1' });
        await d.records.insert('app_source', 'customers', { name: 'Sunita', photo: 'local:abc2' });
      },
      later: (s) => { s.collections.customers!.fields.photo = { type: 'image', label: 'Photo', required: true }; },
    });
    const { plan, outcome } = await copyOf(db, source);
    expect(fieldsToRelax(plan)).toEqual([{ collection: 'customers', field: 'photo' }]);
    expect(outcome).toMatchObject({ entriesCopied: 2, skippedEntries: 0, skippedPictures: 2 });
    const rows = (await db.records.listAll('app_copy1')).customers!;
    expect(rows.map((r) => r.values.name).sort()).toEqual(['Ramesh', 'Sunita']);
    expect(rows.every((r) => !r.values.photo)).toBe(true);
    // The copy is the same design as the original again: the picture field is required.
    const stored = (await db.apps.get('app_copy1'))!;
    expect(stored.spec.collections.customers!.fields.photo).toMatchObject({ required: true });
    expect(outcome.app.spec.collections.customers!.fields.photo).toMatchObject({ required: true });
    expect((await db.versions.list('app_copy1')).map((v) => v.version)).toEqual([2, 1]);
    expect((await db.versions.materialize('app_copy1', 1))!.collections.customers!.fields.photo).not.toHaveProperty('required');
  });

  it('copies an entry from before a field became required', async () => {
    const db = fresh();
    const source = await original(db, {
      fill: async (d) => { await kirana(d); },
      later: (s) => { s.collections.customers!.fields.phone = { type: 'text', label: 'Phone', required: true }; },
    });
    const { outcome } = await copyOf(db, source);
    expect(outcome).toMatchObject({ entriesCopied: 4, skippedEntries: 0 });
    const customers = byName((await db.records.listAll('app_copy1')).customers!);
    expect(customers.Sunita!.values.phone ?? null).toBeNull();
    expect((await db.apps.get('app_copy1'))!.spec.collections.customers!.fields.phone).toMatchObject({ required: true });
  });

  it('fills a required link to an entry that is copied later (a self link and a loop between two lists)', async () => {
    const db = fresh();
    const link = (collection: string) => ({ type: 'text' as const, label: 'Link', ref: { collection, display: collection === 'customers' ? 'name' : 'kind', onDelete: 'restrict' as const } });
    let ids: { ramesh: string; sunita: string; credit: string } | undefined;
    const source = await original(db, {
      initial: (s) => {
        s.collections.customers!.fields.referred_by = link('customers');
        s.collections.customers!.fields.latest = link('entries');
      },
      fill: async (d) => {
        const { ramesh, sunita } = await kirana(d);
        const credit = (await d.records.list('app_source', 'entries')).find((e) => e.values.customer === ramesh.id)!;
        await d.records.update('app_source', 'customers', ramesh.id, { referred_by: sunita.id, latest: credit.id });
        await d.records.update('app_source', 'customers', sunita.id, { latest: (await d.records.list('app_source', 'entries')).find((e) => e.values.customer === sunita.id)!.id });
        ids = { ramesh: ramesh.id, sunita: sunita.id, credit: credit.id };
      },
      later: (s) => {
        s.collections.customers!.fields.referred_by = { ...link('customers'), required: false };
        s.collections.customers!.fields.latest = { ...link('entries'), required: true };
      },
    });
    expect(ids).toBeDefined();
    const { plan, outcome } = await copyOf(db, source);
    expect(fieldsToRelax(plan)).toEqual([{ collection: 'customers', field: 'latest' }]);
    expect(outcome).toMatchObject({ entriesCopied: 4, skippedEntries: 0 });
    const all = await db.records.listAll('app_copy1');
    const customers = byName(all.customers!);
    const newEntries = new Set(all.entries!.map((e) => e.id));
    const newCustomers = new Set(all.customers!.map((c) => c.id));
    // Each link points at an entry of the copy, never at the original.
    expect(newEntries.has(String(customers.Ramesh!.values.latest))).toBe(true);
    expect(newEntries.has(String(customers.Sunita!.values.latest))).toBe(true);
    expect(customers.Ramesh!.values.referred_by).toBe(customers.Sunita!.id);
    expect(newCustomers.has(String(customers.Ramesh!.values.referred_by))).toBe(true);
    // The link from an entry to its customer is of the copy as well.
    expect(all.entries!.every((e) => newCustomers.has(String(e.values.customer)))).toBe(true);
    expect((await db.apps.get('app_copy1'))!.spec.collections.customers!.fields.latest).toMatchObject({ required: true });
  });

  it('leaves out one entry that no longer fits its list, copies the rest and says how many', async () => {
    const db = fresh();
    const source = await original(db, {
      fill: async (d) => { await kirana(d); },
      later: (s) => { s.collections.entries!.fields.kind = { type: 'enum', label: 'Type', options: ['Credit given'], required: true }; },
    });
    const { outcome } = await copyOf(db, source);
    expect(outcome).toMatchObject({ entriesCopied: 3, skippedEntries: 1 });
    const all = await db.records.listAll('app_copy1');
    expect(all.customers).toHaveLength(2);
    expect(all.entries!.map((e) => e.values.kind)).toEqual(['Credit given']);
  });

  it('a link to an entry that does not exist any more stays empty and does not stop the copy', async () => {
    const db = fresh();
    const source = await original(db, {
      fill: async (d) => { await kirana(d); },
    });
    // Make a dangling link by writing the entry as it would look after an import: plan it by hand.
    const records = Object.values(await db.records.listAll(source.id)).flat();
    const dangling: KalamRecord = { ...records.find((r) => r.collectionId === 'entries')!, id: 'gone_entry', values: { customer: 'does_not_exist', kind: 'Credit given', amount: 5, date: '2026-11-03' } };
    const planned = planClone(source, { name: 'Branch Two', mode: 'with_records', confirmedRecords: true }, { newId: () => 'app_copy1', now: NOW, records: [...records, dangling], state: {} });
    if (!planned.ok) throw new Error(planned.message);
    expect(fieldsToRelax(planned.plan)).toEqual([{ collection: 'entries', field: 'customer' }]);
    const outcome = await applyClonePlan(planned.plan, db);
    expect(outcome.entriesCopied).toBe(planned.plan.records.length);
    const copied = (await db.records.listAll('app_copy1')).entries!;
    expect(copied.some((e) => !e.values.customer)).toBe(true);
  });
});

describe('a copy that fails half way', () => {
  const failing = (removeFails: boolean): { store: CloneStore; log: string[] } => {
    const log: string[] = [];
    let inserts = 0;
    const store: CloneStore = {
      apps: {
        save: async (app) => { log.push('save'); return app; },
        remove: async () => { log.push('remove'); if (removeFails) throw new Error('storage gone'); },
      },
      records: {
        insert: async (appId, collectionId, values: Record<string, RecordValue>) => {
          if (++inserts === 2) throw new Error('disk full'); // not a refusal of the entry: a real failure
          return { id: `n${inserts}`, appId, collectionId, createdAt: 1, updatedAt: 1, values };
        },
        update: async () => { throw new Error('unused'); },
      },
      state: { set: async () => undefined },
    };
    return { store, log };
  };

  it('removes the half-made copy and raises the original error', async () => {
    const db = fresh();
    const source = await original(db, { fill: async (d) => { await kirana(d); } });
    const records = Object.values(await db.records.listAll(source.id)).flat();
    const planned = planClone(source, { name: 'Copy', mode: 'with_records', confirmedRecords: true }, { newId: () => 'app_copy2', now: NOW, records, state: {} });
    if (!planned.ok) throw new Error(planned.message);
    const m = failing(false);
    await expect(applyClonePlan(planned.plan, m.store)).rejects.toThrow('disk full');
    expect(m.log).toEqual(['save', 'remove']);
  });

  it('says so when the half-made copy could not be removed either, so the person can delete it', async () => {
    const db = fresh();
    const source = await original(db, { fill: async (d) => { await kirana(d); } });
    const records = Object.values(await db.records.listAll(source.id)).flat();
    const planned = planClone(source, { name: 'Copy', mode: 'with_records', confirmedRecords: true }, { newId: () => 'app_copy3', now: NOW, records, state: {} });
    if (!planned.ok) throw new Error(planned.message);
    const error = await applyClonePlan(planned.plan, failing(true).store).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloneLeftoverError);
    expect((error as CloneLeftoverError).appId).toBe('app_copy3');
  });
});
