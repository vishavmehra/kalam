import { describe, expect, it } from 'vitest';

import { PHONE_ORDER, shellSides, tabOrder } from './shell-layout';

describe('left-handed shell (D10-024)', () => {
  it('keeps the right-handed order, with Make in the middle', () => {
    expect(tabOrder(false)).toEqual(['shelf', 'bazaar', 'create', 'activity', 'settings']);
    expect(tabOrder(false)[2]).toBe('create');
  });

  it('mirrors the tab order for a left hand and keeps Make in the middle', () => {
    const order = tabOrder(true);
    expect(order).toEqual([...PHONE_ORDER].reverse());
    expect(order[2]).toBe('create');
    expect(order).toHaveLength(PHONE_ORDER.length);
  });

  it('does not change the shared order when it mirrors', () => {
    tabOrder(true);
    expect(PHONE_ORDER[0]).toBe('shelf');
  });

  it('moves the rail to the far side and its hairline to the other edge', () => {
    expect(shellSides(false)).toMatchObject({ direction: 'row', railEdge: 'borderEndWidth', headerDirection: 'row' });
    expect(shellSides(true)).toMatchObject({ direction: 'row-reverse', railEdge: 'borderStartWidth', headerDirection: 'row-reverse' });
  });
});
