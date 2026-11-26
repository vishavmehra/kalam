import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, HISTORY_LIMIT, newHistory, record, redo, undo } from './history';

describe('edit history', () => {
  it('undoes and redoes step by step', () => {
    let h = newHistory<string | null>(null);
    h = record(h, 'a');
    h = record(h, 'b');
    expect([h.present, canUndo(h), canRedo(h)]).toEqual(['b', true, false]);
    h = undo(h);
    expect(h.present).toBe('a');
    h = undo(h);
    expect([h.present, canUndo(h), canRedo(h)]).toEqual([null, false, true]);
    expect(undo(h)).toBe(h); // nothing left to undo
    h = redo(redo(h));
    expect([h.present, canRedo(h)]).toEqual(['b', false]);
    expect(redo(h)).toBe(h);
  });

  it('a new change drops the redo steps, and the same snapshot is not a step', () => {
    let h = record(record(newHistory(0), 1), 2);
    h = undo(h);
    expect(record(h, 1)).toBe(h);
    h = record(h, 9);
    expect([h.present, canRedo(h)]).toEqual([9, false]);
    expect(undo(h).present).toBe(1);
  });

  it('keeps only the newest steps', () => {
    let h = newHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = record(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(10);
  });
});
