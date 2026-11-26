import type { StoredApp } from '@/core/contracts';
import { filterShelf, type ShelfCategory } from '@/core/templates/catalog';

export interface ShelfViewOptions {
  query: string;
  sort: 'recent' | 'name';
  category: ShelfCategory | 'all';
  /** The archive is open instead of the main shelf. */
  archived: boolean;
}

/**
 * The apps the shelf shows: the archive or the main shelf, then the category, then the search words, then the order.
 * The store hands apps over pinned first, then most recently used; "name" keeps pinned first and sorts the rest by name.
 */
export function shelfView(apps: readonly StoredApp[], { query, sort, category, archived }: ShelfViewOptions): StoredApp[] {
  const q = query.trim().toLowerCase();
  const inView = filterShelf(apps, { category, archived });
  const found = q ? inView.filter((a) => `${a.spec.name} ${a.spec.description ?? ''}`.toLowerCase().includes(q)) : inView;
  if (sort === 'recent') return found;
  return [...found].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.spec.name.localeCompare(b.spec.name));
}

/**
 * Style of the shelf title, which sits in a row with the phone's tool icons. It takes the row's leftover width
 * instead of the width its text was first measured at: Android can measure the heading before its font is in, wrap
 * the last word onto a second line that the stale one-line height then clips, and show only "Your" after a tab switch.
 * With a width the row decides, the heading wraps and grows in height when it must, and is never cut.
 */
export const shelfTitleStyle = { flex: 1 } as const;
