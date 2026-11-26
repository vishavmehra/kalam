/**
 * Multi-step writes as one unit (docs/09 §7.3, docs/05 §7.8: "without leaving partially updated data").
 *
 * `applyOps` hands the whole list to `records.batch` when the repository has it, which the local database
 * runs as ONE storage transaction. A repository without `batch` gets the next best thing: the writes run one
 * by one and, if one fails, the inserts and updates already made are undone. A delete cannot be undone (the
 * entry's id cannot be given back), so put deletes last; `rolledBack` says honestly whether everything is back.
 * Pure TypeScript.
 */
import type { KalamRecord, RecordOp, RecordRepository } from '@/core/contracts';
import { isSharedRecordId } from '@/core/share/model';
import type { DeletePlan } from './v11/relations';

export type OpsResult = { ok: true } | { ok: false; error: unknown; failedAt: number; rolledBack: boolean };

export async function applyOps(records: RecordRepository, appId: string, ops: RecordOp[]): Promise<OpsResult> {
  if (!ops.length) return { ok: true };
  if (records.batch) {
    try {
      await records.batch(appId, ops);
      return { ok: true };
    } catch (error) {
      return { ok: false, error, failedAt: 0, rolledBack: true };
    }
  }

  // Fallback: what each finished write needs to be undone.
  const undo: Array<() => Promise<unknown>> = [];
  let removed = false;
  const before = new Map<string, KalamRecord[]>();
  const rowsOf = async (collection: string) => {
    if (!before.has(collection)) before.set(collection, await records.list(appId, collection));
    return before.get(collection)!;
  };
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      if (op.op === 'insert') {
        const row = await records.insert(appId, op.collection, op.values);
        undo.push(() => records.remove(appId, op.collection, row.id));
      } else if (op.op === 'update') {
        const prev = (await rowsOf(op.collection)).find((r) => r.id === op.id);
        await records.update(appId, op.collection, op.id, op.values);
        if (prev) {
          const was = Object.fromEntries(Object.keys(op.values).map((k) => [k, prev.values[k] ?? null]));
          undo.push(() => records.update(appId, op.collection, op.id, was));
        }
      } else {
        await records.remove(appId, op.collection, op.id);
        removed = true;
      }
    } catch (error) {
      let rolledBack = !removed;
      for (const back of undo.reverse()) {
        try {
          await back();
        } catch {
          rolledBack = false;
        }
      }
      return { ok: false, error, failedAt: i, rolledBack };
    }
  }
  return { ok: true };
}

/** The writes of a v11 delete plan in the order `applyDeletePlan` uses: linked entries, the entry, then the cleared links. */
export function deletePlanOps(plan: DeletePlan, collection: string, id: string): RecordOp[] {
  return [
    ...plan.cascade.map((d): RecordOp => ({ op: 'remove', collection: d.collection, id: d.id })),
    { op: 'remove', collection, id },
    ...plan.clear.map((c): RecordOp => ({ op: 'update', collection: c.collection, id: c.id, values: { [c.field]: null } })),
  ];
}

/**
 * Gives `wrapper` (the sharing layer, which does not know `batch`) the base repository's atomic `batch`, after
 * refusing any write to an entry that belongs to another app (shared entries are read only).
 */
export function withBatch(wrapper: RecordRepository, base: RecordRepository): RecordRepository {
  if (wrapper.batch || !base.batch) return wrapper;
  const batch = base.batch.bind(base);
  return {
    ...wrapper,
    async batch(appId, ops) {
      // Same name the sharing layer's own error has, so the dispatcher words it the same way (dispatch.ts ownMessage).
      if (ops.some((op) => op.op !== 'insert' && isSharedRecordId(op.id))) {
        throw Object.assign(new Error('Shared entries are read only'), { name: 'SharedRecordReadOnlyError' });
      }
      await batch(appId, ops);
    },
  };
}
