/**
 * Where queued operations live. The device database implements this
 * (`src/infrastructure/storage/pending-ops.ts`); the in-memory version is for tests and previews.
 * Both drop any row that does not pass validation.
 */
import { parsePendingOp, type PendingOperation } from './model';

export interface OperationStore {
  /** Every valid row, in no particular order. */
  list(): Promise<PendingOperation[]>;
  get(id: string): Promise<PendingOperation | undefined>;
  /** Validates, then stores. Throws when the row is not valid. */
  put(op: PendingOperation): Promise<void>;
  remove(id: string): Promise<void>;
  /** Called after any change, including a delete made by an app cascade. Returns unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export function createMemoryOperationStore(initial: readonly PendingOperation[] = []): OperationStore {
  const rows = new Map<string, PendingOperation>(initial.map((o) => [o.id, o]));
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of [...listeners]) l();
  };
  return {
    list: async () => [...rows.values()].map((o) => structuredClone(o)),
    get: async (id) => {
      const row = rows.get(id);
      return row ? structuredClone(row) : undefined;
    },
    put: async (op) => {
      const valid = parsePendingOp(op);
      if (!valid) throw new Error('Queued operation is not in the expected shape');
      rows.set(valid.id, structuredClone(valid));
      changed();
    },
    remove: async (id) => {
      if (rows.delete(id)) changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
