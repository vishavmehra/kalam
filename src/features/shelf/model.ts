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
