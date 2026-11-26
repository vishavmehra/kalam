/**
 * Plain-English change history (docs/14 §11). Pure TypeScript.
 *
 * A ChangeEntry is one readable line that says what differs between two designs of the same app. Entries are
 * built deterministically from the specs (no model call), so history works offline and never misreports.
 */

/** Fixed display order. */
export const CHANGE_CATEGORIES = ['structure', 'data', 'look', 'logic', 'ai', 'text', 'settings'] as const;
export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number];

/**
 * How far a change reaches:
 *  - cosmetic: wording or looks only, nothing works differently.
 *  - behaviour: the app works differently (buttons, calculations, screens, AI steps).
 *  - data: how saved entries are read or kept can change (a field removed or its type changed).
 */
export type ChangeImpact = 'cosmetic' | 'behaviour' | 'data';
export const IMPACT_RANK: Record<ChangeImpact, number> = { cosmetic: 0, behaviour: 1, data: 2 };

export type ChangeKind = 'added' | 'removed' | 'changed' | 'renamed' | 'moved';

/** One before and after pair for the detail view (docs/14 §11.4). Values are plain words, not JSON. */
export interface ChangeDetail {
  name: string;
  before?: string;
  after?: string;
}

export interface ChangeEntry {
  /** Unique within one result. Safe to use as a list key. */
  key: string;
  kind: ChangeKind;
  category: ChangeCategory;
  impact: ChangeImpact;
  /** One short sentence, no trailing full stop, no em dash. Safe to use alone in a one-line summary. */
  text: string;
  /** Optional second sentence that explains a consequence (what happens to saved entries). Shown under `text`. */
  note?: string;
  /** Stable ids involved, outermost first: screen, component, collection, field, action, AI step. */
  ids: string[];
  details?: ChangeDetail[];
}

export const CATEGORY_LABELS: Record<ChangeCategory, string> = {
  structure: 'Screens and layout',
  data: 'Entries and fields',
  look: 'Look',
  logic: 'Buttons and calculations',
  ai: 'AI steps',
  text: 'Wording',
  settings: 'App settings',
};

export const IMPACT_LABELS: Record<ChangeImpact, string> = {
  cosmetic: 'Look and wording only',
  behaviour: 'Changes how it works',
  data: 'Affects entries',
};

/** The strongest impact in a list. A list with no entries is cosmetic. */
export function topImpact(entries: readonly Pick<ChangeEntry, 'impact'>[]): ChangeImpact {
  let best: ChangeImpact = 'cosmetic';
  for (const e of entries) if (IMPACT_RANK[e.impact] > IMPACT_RANK[best]) best = e.impact;
  return best;
}

/** Distinct categories in display order. */
export function categoriesOf(entries: readonly Pick<ChangeEntry, 'category'>[]): ChangeCategory[] {
  const seen = new Set(entries.map((e) => e.category));
  return CHANGE_CATEGORIES.filter((c) => seen.has(c));
}

export interface ChangeGroup {
  category: ChangeCategory;
  label: string;
  entries: ChangeEntry[];
}

/** Entries grouped by category in display order; empty groups are left out. */
export function groupByCategory(entries: readonly ChangeEntry[]): ChangeGroup[] {
  return CHANGE_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    entries: entries.filter((e) => e.category === category),
  })).filter((g) => g.entries.length > 0);
}
