import { describe, expect, it } from 'vitest';
import type { StoredApp } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { createWebDatabase } from './database.web';
import { RecordLimitError } from './kalam-database';

let n = 0;

const spec: KalamSpec = {
  id: 'app_batch', schemaVersion: '1.0.0', version: 1, name: 'Batch', lang: 'en',
  theme: { primary: '#315C4C', radius: 12, fontScale: 1 },
  collections: {
    customers: { label: 'Customers', fields: { name: { type: 'text', label: 'Name', required: true, maxLength: 40 } } },
    entries: {
      label: 'Entries',
      fields: { title: { type: 'text', label: 'Title', required: true, maxLength: 40 }, amount: { type: 'number', label: 'Amount', min: 0, max: 1000 } },
    },
  },
  screens: [{ id: 'home', title: 'Batch', children: [{ id: 'all', type: 'list', source: 'entries', primary: 'title' }] }],
  initialScreen: 'home', actions: {}, aiBlocks: {}, intents: {}, meta: { createdAt: 1 },
};
const app: StoredApp = { id: spec.id, spec, createdAt: 1, updatedAt: 1, origin: { route: 'template', templateId: 'x' } };
const create = { summary: 'Created', source: 'create' } as const;
const APP = spec.id;

async function setup(opts?: Parameters<typeof createWebDatabase>[1]) {
  const db = createWebDatabase(`kalam-batch-${++n}-${Date.now()}`, opts);
  await db.apps.save(app, create);
  return db;
}

describe('records.batch (docs/09 §7.3)', () => {
  it('applies inserts, updates and removes as one unit and tells listeners once', async () => {
    const db = await setup();
    const keep = await db.records.insert(APP, 'entries', { title: 'Tea', amount: 2 });
    const drop = await db.records.insert(APP, 'entries', { title: 'Old', amount: 1 });
    let heard = 0;
    db.records.subscribe(APP, () => heard++);
    await db.records.batch!(APP, [
      { op: 'insert', collection: 'customers', values: { name: 'Asha' } },
      { op: 'update', collection: 'entries', id: keep.id, values: { amount: 5 } },
      { op: 'remove', collection: 'entries', id: drop.id },
    ]);
    expect(heard).toBe(1);
    expect((await db.records.list(APP, 'customers')).map((r) => r.values.name)).toEqual(['Asha']);
    expect((await db.records.list(APP, 'entries')).map((r) => [r.values.title, r.values.amount])).toEqual([['Tea', 5]]);
  });

  it('changes nothing when a later write is refused', async () => {
    const db = await setup();
    const keep = await db.records.insert(APP, 'entries', { title: 'Tea', amount: 2 });
    let heard = 0;
    db.records.subscribe(APP, () => heard++);
    await expect(db.records.batch!(APP, [
      { op: 'insert', collection: 'customers', values: { name: 'Asha' } },
      { op: 'update', collection: 'entries', id: keep.id, values: { amount: 5 } },
      { op: 'update', collection: 'entries', id: keep.id, values: { amount: 99999 } }, // over the field's max
    ])).rejects.toThrow();
    expect(heard).toBe(0);
    expect(await db.records.list(APP, 'customers')).toEqual([]);
    expect((await db.records.list(APP, 'entries'))[0].values.amount).toBe(2);
  });

  it('does not let a batch step past the list limit, and rolls back the rest', async () => {
    const db = await setup({ recordCap: 2 });
    await expect(db.records.batch!(APP, [
      { op: 'insert', collection: 'entries', values: { title: 'a' } },
      { op: 'insert', collection: 'entries', values: { title: 'b' } },
      { op: 'insert', collection: 'entries', values: { title: 'c' } },
    ])).rejects.toBeInstanceOf(RecordLimitError);
    expect(await db.records.list(APP, 'entries')).toEqual([]);
  });

  it('refuses a record of another app or collection', async () => {
    const db = await setup();
    const row = await db.records.insert(APP, 'entries', { title: 'Tea' });
    await expect(db.records.batch!(APP, [{ op: 'remove', collection: 'customers', id: row.id }])).rejects.toThrow();
    expect(await db.records.list(APP, 'entries')).toHaveLength(1);
  });
});
