import { describe, expect, it } from 'vitest';
import type { KalamRecord, StoredApp } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { validateSpec } from '@/core/spec/validate';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import { createWebDatabase } from './database.web';

const spec = validateSpec(loadFixture('valid', 'tailor-orders-linked', 'v11')).spec as KalamSpec;
const other = { ...spec, id: 'app_other', name: 'Other' } as KalamSpec;
const stored = (s: KalamSpec): StoredApp => ({ id: s.id, spec: s, createdAt: 1, updatedAt: 1, origin: { route: 'manual' } } as StoredApp);
const create = { summary: 'Created', source: 'create' } as const;
let n = 0;
const fresh = () => createWebDatabase(`kalam-links-${++n}-${Date.now()}`);

/** A device where another app already owns `taken`, and a backup of the linked app that reuses that id. */
async function setup(taken?: string) {
  const db = fresh();
  await db.apps.save(stored(other), create);
  const local = await db.records.insert('app_other', 'customers', { name: 'Someone' });
  const id = taken ?? local.id;
  const file = {
    apps: [stored(spec)],
    versions: [],
    records: [
      { id, appId: spec.id, collectionId: 'customers', values: { name: 'Asha' }, createdAt: 1, updatedAt: 1 },
      { id: 'o_1', appId: spec.id, collectionId: 'orders', values: { customer: id, garment: 'Kurta' }, createdAt: 1, updatedAt: 1 },
      { id: 'p_1', appId: spec.id, collectionId: 'payments', values: { order: 'o_1', amount: 100 }, createdAt: 1, updatedAt: 1 },
    ],
    state: [],
    drawings: [],
    blobs: [],
  };
  return { db, local, id, file };
}

const customerOf = async (db: ReturnType<typeof fresh>) => {
  const [asha] = (await db.records.list(spec.id, 'customers')) as KalamRecord[];
  const [order] = (await db.records.list(spec.id, 'orders')) as KalamRecord[];
  const [payment] = (await db.records.list(spec.id, 'payments')) as KalamRecord[];
  return { asha, order, payment };
};

describe('links survive a restore that gives an entry a new id', () => {
  it('importAll points the order at the customer that moved, and leaves other links alone', async () => {
    const { db, local, id, file } = await setup();
    const summary = await db.importAll({ format: 'kalam-backup', formatVersion: 1, exportedAt: 1, ...file });
    expect(summary.records).toBe(3);
    const { asha, order, payment } = await customerOf(db);
    expect(asha.id).not.toBe(id);
    expect(order.values.customer).toBe(asha.id);
    expect(payment.values.order).toBe('o_1');
    expect((await db.records.list('app_other', 'customers'))[0].id).toBe(local.id);
  });

  it('writeBackupData does the same', async () => {
    const { db, id, file } = await setup();
    await db.writeBackupData({ ...file, settings: undefined } as never, { replaceAppIds: [], replaceDrawingIds: [] });
    const { asha, order } = await customerOf(db);
    expect(asha.id).not.toBe(id);
    expect(order.values.customer).toBe(asha.id);
  });

  it('changes nothing when no id moved', async () => {
    const db = fresh();
    const { file } = await setup('c_free');
    await db.importAll({ format: 'kalam-backup', formatVersion: 1, exportedAt: 1, ...file });
    const { asha, order } = await customerOf(db);
    expect(asha.id).toBe('c_free');
    expect(order.values.customer).toBe('c_free');
  });
});
