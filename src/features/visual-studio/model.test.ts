import { describe, expect, it } from 'vitest';
import type { KalamComponent } from '@/core/spec/schema';
import type { Part } from '@/features/editing/overlay/hit-test';
import { DRAG_SLOP, dropTargetAt, exceedsSlop, filledCollections, nameOf, nounOf, sizeFromDrag, slotLine, SIZE_STEP } from './model';

describe('filledCollections', () => {
  it('lists only collections with entries, from the listAll shape (object, not array)', () => {
    const filled = filledCollections({ orders: [{}, {}], notes: [], customers: [{}] });
    expect([...filled].sort()).toEqual(['customers', 'orders']);
    expect(filled.has('notes')).toBe(false);
    expect(filledCollections({}).size).toBe(0);
  });
});

const part = (id: string, y: number): Part => ({ id, rect: { x: 10, y, width: 200, height: 40 } });
const parts = [part('a', 0), part('b', 60), part('c', 120)];

describe('sizeFromDrag', () => {
  it('moves one size per step and stops at the ends', () => {
    expect(sizeFromDrag('medium', 0)).toBe('medium');
    expect(sizeFromDrag('medium', SIZE_STEP)).toBe('large');
    expect(sizeFromDrag('medium', -SIZE_STEP)).toBe('small');
    expect(sizeFromDrag('medium', SIZE_STEP * 5)).toBe('large');
    expect(sizeFromDrag('small', -400)).toBe('small');
    expect(sizeFromDrag('small', SIZE_STEP * 2)).toBe('large');
    expect(sizeFromDrag('medium', SIZE_STEP * 0.4)).toBe('medium');
  });
});

describe('drag start', () => {
  it('needs a few pixels of movement', () => {
    expect(exceedsSlop(2, 2)).toBe(false);
    expect(exceedsSlop(DRAG_SLOP, 0)).toBe(true);
  });
});

describe('dropTargetAt', () => {
  const chips = [{ screen: 'other', rect: { x: 0, y: 0, width: 80, height: 32 } }];
  it('puts the part in front of the first later part, or at the end', () => {
    expect(dropTargetAt({ x: 50, y: 70 }, parts, 'c', [])).toEqual({ kind: 'slot', before: 'b' });
    expect(dropTargetAt({ x: 50, y: 5 }, parts, 'c', [])).toEqual({ kind: 'slot', before: 'a' });
    expect(dropTargetAt({ x: 50, y: 400 }, parts, 'a', [])).toEqual({ kind: 'slot', before: null });
  });
  it('lets a screen chip win over the parts under it', () => {
    expect(dropTargetAt({ x: 20, y: 10 }, parts, 'b', chips)).toEqual({ kind: 'screen', screen: 'other' });
  });
  it('does nothing for a part that is not on screen', () => {
    expect(dropTargetAt({ x: 50, y: 70 }, parts, 'ghost', [])).toEqual({ kind: 'none' });
  });
});

describe('slotLine', () => {
  it('sits above the next part, or under the last other part', () => {
    expect(slotLine(parts, 'b', 'c')).toEqual({ x: 10, y: 57, width: 200 });
    expect(slotLine(parts, null, 'c')).toEqual({ x: 10, y: 103, width: 200 });
    expect(slotLine([part('a', 0)], null, 'a')).toBeUndefined();
  });
});

describe('names', () => {
  const button = { id: 'go', type: 'bigButton', label: '  Save   the order now and then some more words ', action: 'x' } as KalamComponent;
  it('gives a plain noun and a short name', () => {
    expect(nounOf(button)).toBe('button');
    expect(nounOf({ id: 'n', type: 'number', label: 'Chest', field: 'chest' } as KalamComponent)).toBe('field');
    expect(nounOf({ id: 'c', type: 'chart' } as KalamComponent)).toBe('part');
    expect(nameOf(button)).toBe('Save the order now and then…');
    expect(nameOf({ id: 'c', type: 'chart' } as KalamComponent)).toBe('');
  });
});
