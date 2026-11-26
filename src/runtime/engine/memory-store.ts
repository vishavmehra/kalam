/**
 * In-memory record + key-value repositories for previews and tests. Same contract as the
 * persistent database, nothing leaves memory. Seed data is deep-copied so previews never touch
 * the user's real records.
 */
import type { KalamRecord, KeyValueRepository, RecordRepository, RecordValue } from '@/core/contracts';

export interface MemoryStores {
  records: RecordRepository;
  state: KeyValueRepository;
}

export function createMemoryStores(
  appId: string,
  seed: { records?: Record<string, KalamRecord[]>; state?: Record<string, RecordValue> } = {},
): MemoryStores {
  const records = new Map<string, KalamRecord[]>();
  for (const [c, rs] of Object.entries(seed.records ?? {})) records.set(c, rs.map((r) => ({ ...r, values: { ...r.values } })));
  const kv: Record<string, RecordValue> = { ...(seed.state ?? {}) };
  const recordListeners = new Set<() => void>();
  const stateListeners = new Set<() => void>();
  let seq = 0;
  let clock = 0;
  // Monotonic timestamps so "newest first" ordering is stable even within one millisecond.
  const tick = () => (clock = Math.max(Date.now(), clock + 1));
  const emit = (set: Set<() => void>) => set.forEach((l) => l());
  const check = (id: string) => {
    if (id !== appId) throw new Error('Memory store is scoped to a single app');
  };
  const list = (c: string) => records.get(c) ?? [];

  // The three writes, without notifying, so `batch` can run several and notify once.
  const addRow = (c: string, values: Record<string, RecordValue>): KalamRecord => {
    const t = tick();
    const rec: KalamRecord = { id: `mem_${++seq}_${t.toString(36)}`, appId, collectionId: c, createdAt: t, updatedAt: t, values: { ...values } };
    records.set(c, [...list(c), rec]);
    return { ...rec, values: { ...rec.values } };
  };
  const changeRow = (c: string, id: string, values: Record<string, RecordValue>): KalamRecord => {
    const existing = list(c).find((r) => r.id === id);
    if (!existing) throw new Error('Record not found');
    // Partial update, like the persistent database: unspecified fields are preserved.
    const rec: KalamRecord = { ...existing, updatedAt: tick(), values: { ...existing.values, ...values } };
    records.set(c, list(c).map((r) => (r.id === id ? rec : r)));
    return { ...rec, values: { ...rec.values } };
  };
  const dropRow = (c: string, id: string): void => {
    records.set(c, list(c).filter((r) => r.id !== id));
  };

  const recordRepo: RecordRepository = {
    async list(a, c) {
      check(a);
      return list(c).map((r) => ({ ...r, values: { ...r.values } }));
    },
    async listAll(a) {
      check(a);
      const out: Record<string, KalamRecord[]> = {};
      for (const [c, rs] of records) out[c] = rs.map((r) => ({ ...r, values: { ...r.values } }));
      return out;
    },
    async insert(a, c, values) {
      check(a);
      const rec = addRow(c, values);
      emit(recordListeners);
      return rec;
    },
    async update(a, c, id, values) {
      check(a);
      const rec = changeRow(c, id, values);
      emit(recordListeners);
      return rec;
    },
    async remove(a, c, id) {
      check(a);
      dropRow(c, id);
      emit(recordListeners);
    },
    /** All or nothing: the arrays are replaced, never edited in place, so a copy of the map is a full snapshot. */
    async batch(a, ops) {
      check(a);
      const before = new Map(records);
      try {
        for (const op of ops) {
          if (op.op === 'insert') addRow(op.collection, op.values);
          else if (op.op === 'update') changeRow(op.collection, op.id, op.values);
          else dropRow(op.collection, op.id);
        }
      } catch (e) {
        records.clear();
        for (const [c, rs] of before) records.set(c, rs);
        throw e;
      }
      emit(recordListeners);
    },
    subscribe(a, listener) {
      check(a);
      recordListeners.add(listener);
      return () => recordListeners.delete(listener);
    },
  };

  const stateRepo: KeyValueRepository = {
    async all(a) {
      check(a);
      return { ...kv };
    },
    async set(a, key, value) {
      check(a);
      kv[key] = value;
      emit(stateListeners);
    },
    subscribe(a, listener) {
      check(a);
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
  };

  return { records: recordRepo, state: stateRepo };
}
