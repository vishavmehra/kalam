/**
 * Catalogue registry: parses locale JSON into flat key maps, loads languages on demand, and tells
 * React when a catalogue arrives. English is bundled so the fallback is always available.
 * Pure TypeScript (the JSON files are plain data).
 */
import { isDev } from './dev';
import en from './locales/en.json';
import { DEFAULT_LANGUAGE, resolveLanguage, type LanguageCode } from './languages';
import {
  PLURAL_CATEGORIES,
  type CatalogueMeta,
  type Message,
  type ParsedCatalogue,
  type PluralForms,
} from './types';

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

const PLURAL_KEYS: ReadonlySet<string> = new Set(PLURAL_CATEGORIES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A leaf plural object: every key is a plural category, every value a string, `other` present. */
function asPluralForms(value: Record<string, unknown>): PluralForms | null {
  const keys = Object.keys(value);
  if (keys.length === 0 || !keys.every((k) => PLURAL_KEYS.has(k) && typeof value[k] === 'string')) return null;
  return typeof value.other === 'string' ? (value as unknown as PluralForms) : null;
}

function parseMeta(raw: unknown): CatalogueMeta {
  if (!isRecord(raw)) return { draft: true };
  const meta: CatalogueMeta = { draft: typeof raw.draft === 'boolean' ? raw.draft : true };
  if (typeof raw.note === 'string') meta.note = raw.note;
  return meta;
}

/**
 * Flattens a locale file into `dot.separated.key` messages. Lenient: it keeps what is valid and lists
 * what is not in `problems`, so one bad entry never takes a whole language down.
 */
export function parseCatalogue(raw: unknown): ParsedCatalogue {
  const messages = new Map<string, Message>();
  const problems: string[] = [];
  if (!isRecord(raw)) return { meta: { draft: true }, messages, problems: ['catalogue is not an object'] };

  const walk = (node: Record<string, unknown>, prefix: string): void => {
    for (const [name, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${name}` : name;
      if (name === '' || name.includes('.')) {
        problems.push(`${path}: key names cannot be empty or contain a dot`);
      } else if (typeof value === 'string') {
        if (value.trim() === '') problems.push(`${path}: empty string`);
        else messages.set(path, value);
      } else if (isRecord(value)) {
        const forms = asPluralForms(value);
        if (forms) {
          if (Object.values(forms).some((s) => typeof s === 'string' && s.trim() === '')) problems.push(`${path}: empty plural form`);
          else messages.set(path, forms);
        } else {
          if (Object.keys(value).some((k) => PLURAL_KEYS.has(k) && typeof value[k] === 'string')) {
            problems.push(`${path}: mixes plural categories with other keys`);
          }
          walk(value, path);
        }
      } else {
        problems.push(`${path}: unsupported value type`);
      }
    }
  };

  const { $meta, ...rest } = raw;
  walk(rest, '');
  return { meta: parseMeta($meta), messages, problems };
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

type RawModule = { default?: unknown } | Record<string, unknown>;
export type CatalogueLoader = () => Promise<RawModule>;

/** One literal `import()` per file so the bundler can split them. */
const DEFAULT_LOADERS: Record<LanguageCode, CatalogueLoader> = {
  en: () => Promise.resolve({ default: en }),
  hi: () => import('./locales/hi.json'),
  gu: () => import('./locales/gu.json'),
  mr: () => import('./locales/mr.json'),
  bn: () => import('./locales/bn.json'),
  ta: () => import('./locales/ta.json'),
  te: () => import('./locales/te.json'),
  kn: () => import('./locales/kn.json'),
  ml: () => import('./locales/ml.json'),
  pa: () => import('./locales/pa.json'),
};

let loaders: Record<LanguageCode, CatalogueLoader> = { ...DEFAULT_LOADERS };
const loaded = new Map<string, ParsedCatalogue>([[DEFAULT_LANGUAGE, parseCatalogue(en)]]);
const inflight = new Map<string, Promise<ParsedCatalogue | undefined>>();
const failed = new Set<string>();
const listeners = new Set<() => void>();
let version = 1;

function bump(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** Loaded catalogue for a language, or undefined if it has not been loaded yet. */
export function getCatalogue(language: string): ParsedCatalogue | undefined {
  return loaded.get(resolveLanguage(language));
}

export function isCatalogueLoaded(language: string): boolean {
  return loaded.has(resolveLanguage(language));
}

/** True once a load has finished, whether it worked or failed. Use it to stop waiting on a language. */
export function isCatalogueSettled(language: string): boolean {
  const code = resolveLanguage(language);
  return loaded.has(code) || failed.has(code);
}

/** Adds or replaces a catalogue from raw JSON. Used by tests and by tooling that ships its own strings. */
export function registerCatalogue(language: string, raw: unknown): ParsedCatalogue {
  const parsed = parseCatalogue(raw);
  loaded.set(resolveLanguage(language), parsed);
  bump();
  return parsed;
}

/**
 * Loads a language's catalogue once. Resolves to the catalogue, or undefined if loading failed (the UI
 * then keeps showing English). A failed load can be retried by calling again.
 */
export function loadCatalogue(language: string): Promise<ParsedCatalogue | undefined> {
  const code = resolveLanguage(language);
  const existing = loaded.get(code);
  if (existing) return Promise.resolve(existing);
  const pending = inflight.get(code);
  if (pending) return pending;

  const task = (async (): Promise<ParsedCatalogue | undefined> => {
    try {
      const mod = await loaders[code]();
      const raw = 'default' in mod && mod.default !== undefined ? mod.default : mod;
      const parsed = parseCatalogue(raw);
      loaded.set(code, parsed);
      failed.delete(code);
      bump();
      return parsed;
    } catch (error) {
      if (isDev()) console.warn(`[i18n] could not load the "${code}" catalogue; showing English`, error);
      failed.add(code);
      bump();
      return undefined;
    } finally {
      inflight.delete(code);
    }
  })();
  inflight.set(code, task);
  return task;
}

/** Subscribe to "a catalogue was added". Returns an unsubscribe function. */
export function subscribeCatalogues(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Changes whenever a catalogue is added; use it as a React store snapshot. */
export function getCatalogueVersion(): number {
  return version;
}

/** Replaces the loaders. For tests (to force a failure or a slow load). */
export function setCatalogueLoaders(overrides: Partial<Record<LanguageCode, CatalogueLoader>>): void {
  loaders = { ...loaders, ...overrides };
}

/** Restores the default loaders and drops every catalogue except English. For tests. */
export function resetCatalogues(): void {
  loaders = { ...DEFAULT_LOADERS };
  loaded.clear();
  loaded.set(DEFAULT_LANGUAGE, parseCatalogue(en));
  inflight.clear();
  failed.clear();
  bump();
}
