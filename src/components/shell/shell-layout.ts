/**
 * Left-handed mode in the shell (docs/10 §4.6): the navigation rail moves to the right edge of a wide screen, where a
 * left hand does not cross the page to reach it, and the phone tab bar reads in the opposite order so the keys
 * line up with the left thumb. Make stays in the middle either way. Text direction never changes.
 * Pure data, so it is tested without a screen.
 */
export type TabKey = 'shelf' | 'create' | 'bazaar' | 'activity' | 'settings';

/** Phones put Make in the middle where the thumb rests. */
export const PHONE_ORDER: readonly TabKey[] = ['shelf', 'bazaar', 'create', 'activity', 'settings'];

export function tabOrder(leftHanded: boolean): TabKey[] {
  return leftHanded ? [...PHONE_ORDER].reverse() : [...PHONE_ORDER];
}

export interface ShellSides {
  /** Row direction of rail and content. `row-reverse` puts the rail on the far side of the page. */
  direction: 'row' | 'row-reverse';
  /** Which edge of the rail faces the content (it carries the hairline). Logical: start or end. */
  railEdge: 'borderEndWidth' | 'borderStartWidth';
  /** Header: row order (logo first, or actions first). */
  headerDirection: 'row' | 'row-reverse';
}

export function shellSides(leftHanded: boolean): ShellSides {
  return leftHanded
    ? { direction: 'row-reverse', railEdge: 'borderStartWidth', headerDirection: 'row-reverse' }
    : { direction: 'row', railEdge: 'borderEndWidth', headerDirection: 'row' };
}
