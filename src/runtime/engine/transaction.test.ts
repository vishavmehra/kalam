import { describe, expect, it } from 'vitest';
import type { RecordOp, RecordRepository } from '@/core/contracts';
import { createMemoryStores } from './memory-store';
import { applyOps, deletePlanOps, withBatch } from './transaction';

const APP = 'app_t';
const stores = () => createMemoryStores(APP);
/** The same repository with `batch` taken away, as a wrapper that does not know about it would look. */
const withoutBatch = (r: RecordRepository): RecordRepository => ({ ...r, batch: undefined });
const names = async (r: RecordRepository, c = 'people') => (await r.list(APP, c)).map((x) => x.values.name).sort();

describe('applyOps with a repository that has batch', () => {
  it('writes everything', async () => {
    const { records } = stores();
    const a = await records.insert(APP, 'people', { name: 'Asha' });
    const res = await applyOps(records, APP, [
      { op: 'insert', collection: 'people', values: { name: 'Bela' } },
      { op: 'update', collection: 'people', id: a.id, values: { name: 'Asha K' } },
    ]);
    expect(res).toEqual({ ok: true });
    expect(await names(records)).toEqual(['Asha K', 'Bela']);
  });

  it('writes nothing when one write fails', async () => {
    const { records } = stores();
    await records.insert(APP, 'people', { name: 'Asha' });
    const res = await applyOps(records, APP, [
      { op: 'insert', collection: 'people', values: { name: 'Bela' } },
      { op: 'update', collection: 'people', id: 'nope', values: { name: 'X' } },
    ]);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.rolledBack).toBe(true);
    expect(await names(records)).toEqual(['Asha']);
  });

  it('tells listeners once for the whole batch', async () => {
    const { records } = stores();
    let heard = 0;
    records.subscribe(APP, () => heard++);
    await applyOps(records, APP, [
      { op: 'insert', collection: 'people', values: { name: 'A' } },
      { op: 'insert', collection: 'people', values: { name: 'B' } },
      { op: 'insert', collection: 'people', values: { name: 'C' } },
    ]);
    expect(heard).toBe(1);
  });

  it('does nothing for an empty list', async () => {
    expect(await applyOps(stores().records, APP, [])).toEqual({ ok: true });
  });
});

describe('applyOps with a repository that has no batch', () => {
  it('undoes the inserts and updates already made when a later write fails', async () => {
    const base = stores().records;
    const a = await base.insert(APP, 'people', { name: 'Asha', city: 'Pune' });
    const records = withoutBatch(base);
    const res = await applyOps(records, APP, [
      { op: 'insert', collection: 'people', values: { name: 'Bela' } },
      { op: 'update', collection: 'people', id: a.id, values: { city: 'Delhi' } },
      { op: 'update', collection: 'people', id: 'nope', values: { city: 'X' } },
    ]);
    expect(res).toMatchObject({ ok: false, failedAt: 2, rolledBack: true });
    const rows = await base.list(APP, 'people');
    expect(rows.map((r) => r.values.name)).toEqual(['Asha']);
    expect(rows[0].values.city).toBe('Pune');
  });

  it('says so when a delete had already gone through, because that cannot be undone', async () => {
    const base = stores().records;
    const a = await base.insert(APP, 'people', { name: 'Asha' });
    const res = await applyOps(withoutBatch(base), APP, [
      { op: 'remove', collection: 'people', id: a.id },
      { op: 'update', collection: 'people', id: 'nope', values: { name: 'X' } },
    ]);
    expect(res).toMatchObject({ ok: false, failedAt: 1, rolledBack: false });
  });

  it('succeeds like the batch when nothing fails', async () => {
    const base = stores().records;
    const res = await applyOps(withoutBatch(base), APP, [{ op: 'insert', collection: 'people', values: { name: 'Z' } }]);
    expect(res).toEqual({ ok: true });
    expect(await names(base)).toEqual(['Z']);
  });
});

describe('deletePlanOps', () => {
  it('lists linked entries, then the entry, then the links to clear', () => {
    const ops = deletePlanOps(
      { cascade: [{ collection: 'entries', id: 'e1' }, { collection: 'entries', id: 'e2' }], clear: [{ collection: 'notes', id: 'n1', field: 'customer' }] },
      'customers', 'c1',
    );
    expect(ops).toEqual<RecordOp[]>([
      { op: 'remove', collection: 'entries', id: 'e1' },
      { op: 'remove', collection: 'entries', id: 'e2' },
      { op: 'remove', collection: 'customers', id: 'c1' },
      { op: 'update', collection: 'notes', id: 'n1', values: { customer: null } },
    ]);
  });
});

describe('withBatch', () => {
  it('forwards batch through a wrapper that lacks it, and refuses entries from other apps', async () => {
    const base = stores().records;
    const wrapped = withBatch(withoutBatch(base), base);
    expect(wrapped.batch).toBeTypeOf('function');
    await wrapped.batch!(APP, [{ op: 'insert', collection: 'people', values: { name: 'Q' } }]);
    expect(await names(base)).toEqual(['Q']);
    await expect(wrapped.batch!(APP, [{ op: 'remove', collection: 'people', id: 'shared:x' }])).rejects.toMatchObject({
      name: 'SharedRecordReadOnlyError',
    });
  });

  it('leaves a repository that already has batch alone', () => {
    const base = stores().records;
    expect(withBatch(base, base)).toBe(base);
  });
});
