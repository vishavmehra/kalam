/**
 * The template gallery (docs/14 §12): every ready-made starting point, how to find one, and how to turn one into an
 * app of your own. Nothing here talks to storage or the network: a template is installed by building its spec,
 * validating it, and handing it to whoever saves apps.
 */
import { themeFromPreset } from '../themes';
import { validateSpec } from '../../spec/validate';
import type { KalamSpec } from '../../spec/schema';
import { LIMITS } from '../../spec/schema';
import type { BuildOpts } from '../base';
import { normalizeText } from '../extract';
import { GENERATED_ENTRIES } from './entries/generated';
import { HEALTH_HOME_ENTRIES } from './entries/health-home';
import { SCHOOL_ENTRIES } from './entries/school';
import { SHOP_ENTRIES } from './entries/shop';
import {
  CATALOG_CATEGORIES, CATEGORY_LABELS, type CatalogCategory, type CatalogEntry, type InstallChoices,
} from './types';

/** The five showcase apps of docs/14 §12.3 come first; the rest follow by category. */
export const SHOWCASE_IDS = ['tailor_book', 'medicine_tracker', 'gst_calculator', 'kirana_credit_book', 'notes'] as const;

const ALL: CatalogEntry[] = [...GENERATED_ENTRIES, ...SHOP_ENTRIES, ...SCHOOL_ENTRIES, ...HEALTH_HOME_ENTRIES];
const categoryRank = (c: CatalogCategory): number => CATALOG_CATEGORIES.indexOf(c);
const showcaseRank = (id: string): number => {
  const i = (SHOWCASE_IDS as readonly string[]).indexOf(id);
  return i < 0 ? SHOWCASE_IDS.length : i;
};

export const CATALOG: readonly CatalogEntry[] = [...ALL].sort(
  (a, b) => showcaseRank(a.id) - showcaseRank(b.id)
    || (showcaseRank(a.id) < SHOWCASE_IDS.length ? 0 : categoryRank(a.category) - categoryRank(b.category) || a.title.localeCompare(b.title, 'en')),
);

const BY_ID = new Map(CATALOG.map((e) => [e.id, e] as const));

export const listCatalog = (): readonly CatalogEntry[] => CATALOG;
export const getCatalogEntry = (id: string): CatalogEntry | undefined => BY_ID.get(id);
export const isShowcase = (id: string): boolean => (SHOWCASE_IDS as readonly string[]).includes(id);

// ─── Categories ───────────────────────────────────────────────────────────────
export interface GalleryCategory {
  id: CatalogCategory | 'all';
  label: string;
  count: number;
}

/** "All" first, then each category that has at least one template, in the order of docs/14 §12.2. */
export function galleryCategories(entries: readonly CatalogEntry[] = CATALOG): GalleryCategory[] {
  const rows: GalleryCategory[] = [{ id: 'all', label: 'All', count: entries.length }];
  for (const id of CATALOG_CATEGORIES) {
    const count = entries.filter((e) => e.category === id).length;
    if (count > 0) rows.push({ id, label: CATEGORY_LABELS[id], count });
  }
  return rows;
}

// ─── Search ───────────────────────────────────────────────────────────────────
/** Words that carry no meaning in a search ("app for the shop"). */
const SKIP = new Set(['a', 'an', 'the', 'my', 'for', 'of', 'to', 'and', 'app', 'apps', 'make', 'create', 'build', 'me', 'ka', 'ki', 'ke']);

interface SearchIndex { title: string[]; keywords: Set<string>; keywordText: string[]; description: Set<string>; category: string[] }
const indexCache = new WeakMap<CatalogEntry, SearchIndex>();
const words = (text: string): string[] => normalizeText(text).split(' ').filter(Boolean);

function indexOf(e: CatalogEntry): SearchIndex {
  let idx = indexCache.get(e);
  if (!idx) {
    idx = {
      title: words(e.title),
      keywords: new Set(e.keywords.flatMap(words)),
      keywordText: e.keywords.map(normalizeText),
      description: new Set(words(e.description)),
      category: words(CATEGORY_LABELS[e.category]),
    };
    indexCache.set(e, idx);
  }
  return idx;
}

const stem = (w: string): string => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const same = (a: string, b: string): boolean => a === b || stem(a) === stem(b);

/** How well one word matches one entry. Zero means it does not match at all. */
function wordScore(e: CatalogEntry, word: string): number {
  const idx = indexOf(e);
  if (idx.title.some((t) => same(t, word))) return 6;
  if ([...idx.keywords].some((k) => same(k, word))) return 5;
  if (word.length >= 3 && idx.title.some((t) => t.startsWith(word))) return 4;
  if (word.length >= 3 && [...idx.keywords].some((k) => k.startsWith(word))) return 3;
  if ([...idx.description].some((d) => same(d, word))) return 1;
  if (idx.category.some((c) => same(c, word))) return 2;
  return 0;
}

/**
 * Templates that match every word of `query`, best first. Matches the title, the search words (English, Hinglish and
 * Hindi), the description and the category. An empty query returns everything in gallery order.
 */
export function searchCatalog(
  query: string,
  opts: { category?: CatalogCategory | 'all'; entries?: readonly CatalogEntry[] } = {},
): CatalogEntry[] {
  const pool = (opts.entries ?? CATALOG).filter((e) => !opts.category || opts.category === 'all' || e.category === opts.category);
  const tokens = words(query).filter((w) => !SKIP.has(w));
  if (!tokens.length) return [...pool];
  const scored: Array<{ e: CatalogEntry; s: number; at: number }> = [];
  pool.forEach((e, at) => {
    let total = 0;
    for (const t of tokens) {
      const s = wordScore(e, t);
      if (s === 0) return; // every word has to match something
      total += s;
    }
    scored.push({ e, s: total, at });
  });
  return scored.sort((a, b) => b.s - a.s || a.at - b.at).map((x) => x.e);
}

// ─── Installing ───────────────────────────────────────────────────────────────
export interface InstalledTemplate {
  spec: KalamSpec;
  entry: CatalogEntry;
  /** Notes from validation. Never errors: an app with errors is not installed. */
  warnings: string[];
  /** What the app's `origin` should say, so the shelf shows "From a template". */
  origin: { route: 'template'; provider: 'deterministic'; templateId: string };
}

export type InstallResult = { ok: true; value: InstalledTemplate } | { ok: false; error: string };

/**
 * Builds a fresh, independent app from a template (docs/14 §12.5): the spec is validated before anything is saved,
 * the name and theme can be changed first (§12.6), and no example entries are copied in.
 */
export function instantiateCatalogEntry(id: string, opts: BuildOpts, choices: InstallChoices = {}): InstallResult {
  const entry = BY_ID.get(id);
  if (!entry) return { ok: false, error: 'That template is not in the gallery.' };
  let spec: KalamSpec;
  try {
    spec = entry.build(opts);
  } catch {
    return { ok: false, error: 'This template could not be built. Nothing was saved.' };
  }
  const name = choices.name?.trim();
  if (choices.name !== undefined && (!name || name.length > LIMITS.nameLength)) {
    return { ok: false, error: `Give the app a name of 1 to ${LIMITS.nameLength} characters.` };
  }
  if (name) {
    // The name a person types is also the heading of the screen that carries the template's own name (what the app shows).
    const original = spec.name;
    spec = { ...spec, name, screens: spec.screens.map((s) => (s.title === original ? { ...s, title: name } : s)) };
  }
  if (choices.theme) {
    const theme = themeFromPreset(choices.theme);
    spec = { ...spec, theme, ...(spec.icon ? { icon: { ...spec.icon, background: theme.primary } } : {}) };
  }
  const checked = validateSpec(spec);
  if (!checked.ok) return { ok: false, error: 'This template did not pass the safety check. Nothing was saved.' };
  return {
    ok: true,
    value: {
      spec, entry, warnings: checked.warnings.map((w) => w.message),
      origin: { route: 'template', provider: 'deterministic', templateId: entry.id },
    },
  };
}
