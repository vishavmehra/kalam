import { describe, expect, it } from 'vitest';
import type { RecordRepository } from '@/core/contracts';
import type { KalamField, KalamSpec } from '@/core/spec/schema';
import { createMemoryStores } from '@/runtime/engine/memory-store';
import { saveDocumentRecords } from './save-records';

const make = (extra: Record<string, KalamField> = {}) => ({
  schemaVersion: '1.1', id: 'app_slips0001', name: 'Slips', lang: 'en', version: 1,
  collections: {
    orders: {
      label: 'Orders',
      fields: {
        customer: { type: 'text', label: 'Customer', required: true },
        chest: { type: 'number', label: 'Chest', min: 20, max: 80 },
        ...extra,
      },
    },
  },
  screens: [], home: 'home',
} as unknown as KalamSpec);
const APP = 'app_slips0001';
const rows = async (repo: RecordRepository) => (await repo.list(APP, 'orders')).map((r) => r.values);

describe('saveDocumentRecords', () => {
  it('saves every record, with the list defaults filled in', async () => {
    const { records } = createMemoryStores(APP);
    const out = await saveDocumentRecords(records, make(), APP, 'orders', [{ customer: 'Raju', chest: 40 }, { customer: 'Mohan' }]);
    expect(out).toEqual({ ok: true });
    expect(await rows(records)).toEqual([{ customer: 'Raju', chest: 40 }, { customer: 'Mohan', chest: null }]);
  });

  it('checks the whole list, so a required field the photo step does not read blocks everything', async () => {
    const { records } = createMemoryStores(APP);
    const spec = make({ phone: { type: 'text', label: 'Phone', required: true } });
    const out = await saveDocumentRecords(records, spec, APP, 'orders', [{ customer: 'Raju' }, { customer: 'Mohan' }]);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toMatch(/^Phone: /);
    expect(await rows(records)).toEqual([]);
  });

  it('saves nothing when the list cannot hold them all, and says so in plain words', async () => {
    const { records } = createMemoryStores(APP);
    const full: RecordRepository = {
      ...records,
      batch: async () => { throw Object.assign(new Error('x'), { name: 'RecordLimitError', limit: 50 }); },
    };
    const out = await saveDocumentRecords(full, make(), APP, 'orders', [{ customer: 'Raju' }, { customer: 'Mohan' }]);
    expect(!out.ok && out.message).toContain('50');
    expect(await rows(records)).toEqual([]);
  });

  it('undoes the earlier writes when a repository without batch fails on the second', async () => {
    const { records } = createMemoryStores(APP);
    let n = 0;
    const flaky: RecordRepository = {
      ...records,
      batch: undefined,
      insert: async (a, c, v) => { if (++n === 2) throw new Error('disk'); return records.insert(a, c, v); },
    };
    const out = await saveDocumentRecords(flaky, make(), APP, 'orders', [{ customer: 'A' }, { customer: 'B' }, { customer: 'C' }]);
    expect(out).toEqual({ ok: false, message: "Couldn't save. Nothing was changed. Please try again." });
    expect(await rows(records)).toEqual([]);
  });

  it('says so when the list is gone', async () => {
    const { records } = createMemoryStores(APP);
    const out = await saveDocumentRecords(records, make(), APP, 'nope', [{ customer: 'Raju' }]);
    expect(out.ok).toBe(false);
  });
});
