/**
 * Drop-in for `const [draft, setDraft] = useState<Draft | null>(null)` in the editor, with undo and
 * redo (docs/14 §4.2). Every `setDraft(next)` is a step; `setDraft(null)` (kept or discarded) starts a
 * fresh history, because a kept change is a saved version and the version history owns it from then on.
 * Undoing the first step brings the draft back to null, which is the saved app.
 */
import { useCallback, useState, type SetStateAction } from 'react';
import { canRedo, canUndo, newHistory, record, redo, undo, type History } from '@/core/edit/history';

/** The step `setDraft(next)` takes. Exported so it can be tested without React. */
export function stepDraft<T>(h: History<T | null>, next: SetStateAction<T | null>): History<T | null> {
  const value = typeof next === 'function' ? (next as (prev: T | null) => T | null)(h.present) : next;
  return value === null ? newHistory<T | null>(null) : record(h, value);
}

export function useDraftHistory<T>() {
  const [h, setH] = useState<History<T | null>>(() => newHistory<T | null>(null));
  const setDraft = useCallback((next: SetStateAction<T | null>) => setH((cur) => stepDraft(cur, next)), []);
  const undoDraft = useCallback(() => setH((cur) => undo(cur)), []);
  const redoDraft = useCallback(() => setH((cur) => redo(cur)), []);
  return { draft: h.present, setDraft, undo: undoDraft, redo: redoDraft, canUndo: canUndo(h), canRedo: canRedo(h) };
}
