/**
 * Schema-v4 repository: queued-until-online operations (docs/09 §18). One table of small rows, indexed by
 * the owning app so deleting an app removes its queued work and the files that work kept, in the same
 * transaction (see `removeAppCascade`). Every row is validated on the way in and again on the way out.
 */
import { parsePendingOp, type PendingOperation } from '@/core/queue/model';
import type { OperationStore } from '@/core/queue/store';
import type { StorageDriver, StorageTables } from './driver';
import { removeOwnedBlobs } from './repositories';

export interface PendingOpRepository extends OperationStore {
  /** Tells subscribers something changed without a write through this repository (a cascade delete). */
  notifyChanged(): void;
}

/** Deletes the queued work of an app, and the files that work owns, inside an open transaction. */
export async function removePendingOpsOfApp(t: StorageTables, appId: string): Promise<number> {
  const rows = await t.pendingOps.where('appId', appId);
  for (const row of rows) await removeOwnedBlobs(t, row.id);
  await t.pendingOps.deleteWhere('appId', appId);
  return rows.length;
}

const valid = (rows: readonly unknown[]): PendingOperation[] =>
  rows.flatMap((row) => {
    const op = parsePendingOp(row);
    return op ? [op] : [];
  });

export function createPendingOpRepository(driver: StorageDriver): PendingOpRepository {
  const { tables } = driver;
  const listeners = new Set<() => void>();
  const notifyChanged = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A listener must not break a write that already happened.
      }
    }
  };
  return {
    notifyChanged,
    async list() {
      return valid(await tables.pendingOps.all());
    },
    async get(id) {
      return valid([await tables.pendingOps.get(id)])[0];
    },
    async put(op) {
      const row = parsePendingOp(op);
      if (!row) throw new Error('Queued operation is not in the expected shape');
      await tables.pendingOps.put(row);
      notifyChanged();
    },
    async remove(id) {
      await tables.pendingOps.delete(id);
      notifyChanged();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
