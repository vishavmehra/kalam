/**
 * Shelf categories and archive (docs/00 §21). Pure helpers over the apps already on the shelf: which category an app
 * belongs to, how many apps each category has, which apps to show, and the archived flag (docs/11 §6.5: archiving
 * hides an app from the main shelf and deletes nothing).
 *
 * The category is worked out from what the app is, never typed in or sent anywhere: first its template, then the
 * words of its name, description, tags and lists. An app that matches nothing is "Other".
 *
 * This file does not import the gallery (30 templates and their made-up entries), so the shelf stays light. Import it as
 * `@/core/templates/catalog/shelf`.
 */
import type { StoredApp } from '../../contracts';
import { normalizeText } from '../extract';
import { categoryOfTemplate } from './categories';
import { CATALOG_CATEGORIES, CATEGORY_LABELS, type CatalogCategory } from './types';

export type ShelfCategory = CatalogCategory | 'other';
export const SHELF_CATEGORY_LABELS: Readonly<Record<ShelfCategory, string>> = { ...CATEGORY_LABELS, other: 'Other' };

/** Words that put an app in a category when its template is not known. Whole words, lower case. */
const CATEGORY_WORDS: Readonly<Record<CatalogCategory, readonly string[]>> = {
  shop: ['shop', 'store', 'kirana', 'sales', 'sale', 'stock', 'inventory', 'supplier', 'suppliers', 'invoice', 'gst', 'tailor', 'orders', 'order', 'delivery', 'ledger', 'credit', 'udhaar', 'dukaan', 'khata'],
  health: ['medicine', 'medicines', 'health', 'doctor', 'clinic', 'patient', 'patients', 'appointment', 'appointments', 'dose', 'doses', 'tablet', 'pills', 'dawai', 'visit', 'visits'],
  home: ['home', 'household', 'family', 'grocery', 'groceries', 'bills', 'bill', 'budget', 'rent', 'chores', 'ghar'],
  school: ['school', 'student', 'students', 'class', 'attendance', 'homework', 'marks', 'tutor', 'teacher', 'fees', 'exam', 'syllabus', 'grades'],
  work: ['work', 'task', 'tasks', 'project', 'meeting', 'office', 'client', 'clients', 'leads', 'follow', 'visitor', 'visitors', 'customers', 'customer'],
  personal: ['notes', 'note', 'diary', 'journal', 'habit', 'habits', 'goal', 'goals', 'reading', 'travel', 'counter', 'tally', 'personal', 'expenses', 'expense'],
};

/** Text that describes an app, from its spec only. */
function describing(app: Pick<StoredApp, 'spec'>): string {
  const { spec } = app;
  const lists = Object.values(spec.collections).map((c) => c.label ?? '');
  return normalizeText([spec.name, spec.description ?? '', ...(spec.meta.tags ?? []), ...lists].join(' '));
}

/** The category of one app. A gallery template decides at once; otherwise the category with the most matching words. */
export function shelfCategoryOf(app: Pick<StoredApp, 'spec' | 'origin'>): ShelfCategory {
  const templateId = app.origin.templateId ?? app.spec.meta.templateId;
  const fromTemplate = templateId ? categoryOfTemplate(templateId) : undefined;
  if (fromTemplate) return fromTemplate;
  const words = new Set(describing(app).split(' ').filter(Boolean));
  let best: ShelfCategory = 'other';
  let bestHits = 0;
  for (const c of CATALOG_CATEGORIES) {
    const hits = CATEGORY_WORDS[c].filter((w) => words.has(w)).length;
    if (hits > bestHits) { best = c; bestHits = hits; }
  }
  return best;
}

export interface ShelfCategoryRow {
  id: ShelfCategory | 'all';
  label: string;
  count: number;
}

/** Counts for the category chips: "All" first, then each category that has an app, "Other" last. Archived apps are not counted. */
export function shelfCategories(apps: readonly Pick<StoredApp, 'spec' | 'origin' | 'archived'>[]): ShelfCategoryRow[] {
  const live = apps.filter((a) => !a.archived);
  const counts = new Map<ShelfCategory, number>();
  for (const a of live) counts.set(shelfCategoryOf(a), (counts.get(shelfCategoryOf(a)) ?? 0) + 1);
  const rows: ShelfCategoryRow[] = [{ id: 'all', label: 'All', count: live.length }];
  for (const id of [...CATALOG_CATEGORIES, 'other' as const]) {
    const count = counts.get(id) ?? 0;
    if (count > 0) rows.push({ id, label: SHELF_CATEGORY_LABELS[id], count });
  }
  return rows;
}

export interface ShelfFilter {
  category?: ShelfCategory | 'all';
  /** Show the archived apps instead of the main shelf. */
  archived?: boolean;
}

/**
 * The category that is really in force: one that no app on the shelf has any more (the last app of it was deleted or
 * archived) counts as "All", so a filter can never leave the person looking at an empty shelf with no chip to clear it.
 */
export function effectiveCategory(
  apps: readonly Pick<StoredApp, 'spec' | 'origin' | 'archived'>[], category: ShelfCategory | 'all' | undefined,
): ShelfCategory | 'all' {
  if (!category || category === 'all') return 'all';
  return apps.some((a) => !a.archived && shelfCategoryOf(a) === category) ? category : 'all';
}

/**
 * The apps to show, in the order given. The main shelf never shows an archived app, and the archive shows only those,
 * all of them: the category chips are not shown there, so a category chosen earlier does not apply.
 */
export function filterShelf<T extends Pick<StoredApp, 'spec' | 'origin' | 'archived'>>(apps: readonly T[], filter: ShelfFilter = {}): T[] {
  const category = filter.archived ? 'all' : effectiveCategory(apps, filter.category);
  return apps.filter((a) => {
    if (!!a.archived !== !!filter.archived) return false;
    return category === 'all' || shelfCategoryOf(a) === category;
  });
}

export const archivedCount = (apps: readonly Pick<StoredApp, 'archived'>[]): number => apps.filter((a) => a.archived).length;

/**
 * The app with its archived flag changed. Nothing else changes, nothing is deleted, and the design, history and entries
 * are untouched. Hand the result to `AppRepository.save` with `ARCHIVE_CHANGE`.
 */
export function withArchived<T extends StoredApp>(app: T, archived: boolean): T {
  const { archived: _was, ...rest } = app;
  return (archived ? { ...rest, archived: true } : rest) as T;
}

/**
 * The change argument `AppRepository.save` requires. Archiving changes no design, so the database takes its
 * metadata-only path and writes no version: this text is never stored and never shown.
 */
export const ARCHIVE_CHANGE = { summary: 'Archive flag changed', source: 'edit' } as const;
