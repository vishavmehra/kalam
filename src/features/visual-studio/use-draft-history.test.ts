import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, newHistory, undo } from '@/core/edit/history';
import { stepDraft } from './use-draft-history';

type Draft = { n: number };

describe('stepDraft', () => {
  it('records each draft, undoes back to no draft, and starts over on null', () => {
    let h = newHistory<Draft | null>(null);
    h = stepDraft(h, { n: 1 });
    h = stepDraft(h, (d) => ({ n: (d?.n ?? 0) + 1 }));
    expect(h.present).toEqual({ n: 2 });
    h = undo(undo(h));
    expect(h.present).toBeNull();
    expect(canRedo(h)).toBe(true);
    h = stepDraft(h, { n: 7 });
    expect(canRedo(h)).toBe(false);
    h = stepDraft(h, null); // kept or discarded
    expect([h.present, canUndo(h), canRedo(h)]).toEqual([null, false, false]);
  });
});
