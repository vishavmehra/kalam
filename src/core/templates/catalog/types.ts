/**
 * Template gallery model (docs/14 §12). A catalog entry is a ready-made starting point: the KalamSpec it builds,
 * the plain facts a gallery card shows, and made-up example entries so the person can see it working before
 * installing. Pure TypeScript: no storage, no clock, no network.
 */
import type { RecordValue } from '../../contracts';
import type { IconGlyph, KalamSpec, SuggestedMode, ThemePreset } from '../../spec/schema';
import type { BuildOpts } from '../base';

/** docs/14 §12.2, in display order. */
export const CATALOG_CATEGORIES = ['shop', 'health', 'home', 'school', 'work', 'personal'] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export const CATEGORY_LABELS: Readonly<Record<CatalogCategory, string>> = {
  shop: 'Shop',
  health: 'Health',
  home: 'Home',
  school: 'School',
  work: 'Work',
  personal: 'Personal',
};

/**
 * One made-up entry. Two kinds of values need resolving against the day the preview is shown:
 *  - `~0`, `~-3`, `~+5`: a date, that many days from today (so a preview never shows stale dates).
 *  - `>key`: a link to the entry of the linked collection that has that `key`.
 * Every other string is shown as it is. Both prefixes are reserved and never appear in plain sample text.
 */
export interface SampleRow {
  /** Name other rows use to link to this one. Not stored. */
  key?: string;
  values: Record<string, RecordValue>;
}

/**
 * Everything a preview needs. All of it is made up: a template never carries anyone's real entries (docs/14 §12.5).
 * There are no preview images (docs/14 §12.4): the gallery shows the real screens, rebuilt from this data, which cannot
 * drift from the app a person gets.
 */
export interface SampleData {
  /** collection id → rows, oldest first. */
  records?: Record<string, SampleRow[]>;
  /** Counters kept in the app's saved values (`state.count`). */
  state?: Record<string, RecordValue>;
  /** Values typed into the form of a screen with no collection (a calculator). */
  form?: Record<string, RecordValue>;
}

export interface CatalogAccessibility {
  /** One or two sentences a screen reader can say about the whole app. Also written into the installed app. */
  summary: string;
  /** Modes the app offers on first open. The person decides; nothing is switched on. */
  suggestedModes: SuggestedMode[];
}

export interface CatalogEntry {
  /** Stable id, 40 characters at most. Stored as `meta.templateId` on every app made from it. */
  id: string;
  /**
   * Revision of this template, bumped when its design changes. The installed app records only `meta.templateId` today
   * (`meta` is strict and has no field for a version), so this is how a later fix is told apart inside the catalog.
   */
  version: number;
  title: string;
  description: string;
  category: CatalogCategory;
  /** Language the app's own words are written in. */
  lang: string;
  glyph: IconGlyph;
  /** Theme the card is tinted with; also the app's starting theme. */
  theme: ThemePreset;
  /** Search words: English, Hinglish and Hindi. */
  keywords: string[];
  accessibility: CatalogAccessibility;
  /** AI the template needs to work. Always empty: every template runs without a model, offline. */
  requiredAI: readonly never[];
  /** Who made the template. Kept on the installed app (`meta.author`). */
  author: string;
  /** Rows shown in the preview. Never installed. */
  sample: SampleData;
  /** Set when the keyword-matched generator (src/core/templates/apps) builds the app. */
  generator?: string;
  /** Builds a fresh app. `opts.appId` makes it a separate, independent app. */
  build(opts: BuildOpts): KalamSpec;
}

/** Overrides the person can set while installing (docs/14 §12.6). */
export interface InstallChoices {
  name?: string;
  theme?: ThemePreset;
}
