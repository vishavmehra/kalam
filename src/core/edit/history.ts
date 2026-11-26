/**
 * Undo and redo for the editor (docs/14 §4.2, docs/15 §7). A plain past / present / future stack over
 * any snapshot type. The editor stores whole drafts: every edit already returns a fresh validated
 * spec, so a snapshot is a reference, never a copy. Pure and immutable.
 */
export const HISTORY_LIMIT = 50;

export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}

export const newHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/** Makes `next` the present. A new change drops the redo steps; the same snapshot again is not a step. */
export function record<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (Object.is(next, h.present)) return h;
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [] };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1] as T, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0] as T, future: h.future.slice(1) };
}
