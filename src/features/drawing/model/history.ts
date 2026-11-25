/**
 * Snapshot history (docs/08 §12). Documents are immutable and share structure between versions,
 * so storing whole snapshots is cheap and makes undo/redo trivially correct.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Consecutive commits with the same key inside the window merge into one step (docs/08 §12.3). */
  lastKey?: string;
  lastAt?: number;
}

export const HISTORY_LIMIT = 100;
const COALESCE_MS = 1200;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function commit<T>(
  h: History<T>, next: T, opts: { coalesceKey?: string; now?: number; limit?: number } = {},
): History<T> {
  if (next === h.present) return h;
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? HISTORY_LIMIT;
  const merge = opts.coalesceKey !== undefined && opts.coalesceKey === h.lastKey
    && h.lastAt !== undefined && now - h.lastAt < COALESCE_MS;
  const past = merge ? h.past : [...h.past, h.present].slice(-limit);
  return { past, present: next, future: [], lastKey: opts.coalesceKey, lastAt: now };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const present = h.past[h.past.length - 1]!;
  return { past: h.past.slice(0, -1), present, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [present, ...future] = h.future;
  return { past: [...h.past, h.present], present: present!, future };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;
