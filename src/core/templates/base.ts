/**
 * Shared building blocks for deterministic templates: common params (app name + theme),
 * spec assembly with honest template metadata, bilingual intent phrases and formula snippets.
 */
import { z } from 'zod';
import {
  SCHEMA_VERSION, THEME_PRESETS,
  type IconGlyph, type KalamAction, type KalamCollection, type KalamScreen, type KalamSpec, type ThemePreset,
} from '../spec/schema';
import type { TemplateDefinition, TemplateId } from '../contracts';
import { extractAppName } from './extract';
import { themeFromPreset } from './themes';

/**
 * Contract template plus `strongKeywords`: words that on their own identify the template
 * (e.g. "calculator", "kharcha"). Other `keywords` only add supporting evidence.
 */
export interface KalamTemplate<P> extends TemplateDefinition<P> {
  strongKeywords: string[];
}

export const baseParamsShape = {
  name: z.string().trim().min(1).max(60),
  theme: z.enum(THEME_PRESETS),
};

export interface BuildOpts { appId: string; now: number; lang: string }

/** Colour / mood words → preset. "bada text" / "high contrast" → accessible preset. */
export function extractTheme(text: string): ThemePreset | undefined {
  const t = text.toLowerCase();
  if (/high contrast|large text|big text|bade? akshar|bada text|elderly|buzurg|weak eyesight/.test(t)) return 'high_contrast';
  if (/\b(?:lavender|purple|violet|pink)\b|baingani/.test(t)) return 'soft_lavender';
  if (/\b(?:blue|ocean|navy|neela|sky)\b/.test(t)) return 'ocean_blue';
  if (/\b(?:paper|warm|brown|beige|vintage)\b/.test(t)) return 'warm_paper';
  if (/\b(?:minimal|monochrome|black and white|plain)\b/.test(t)) return 'minimal_neutral';
  if (/\b(?:green|hara|calm)\b/.test(t)) return 'calm_green';
  return undefined;
}

export function extractBase(text: string): { name?: string; theme?: ThemePreset } {
  const out: { name?: string; theme?: ThemePreset } = {};
  const name = extractAppName(text);
  const theme = extractTheme(text);
  if (name) out.name = name;
  if (theme) out.theme = theme;
  return out;
}

export interface SpecParts {
  /** A TemplateId, or the id of a gallery entry (src/core/templates/catalog). Stored as meta.templateId. */
  templateId: TemplateId | (string & {});
  name: string;
  description: string;
  glyph: IconGlyph;
  theme: ThemePreset;
  collections: Record<string, KalamCollection>;
  screens: KalamScreen[];
  actions: Record<string, KalamAction>;
  intents: Record<string, string[]>;
  tags: string[];
}

export function assembleSpec(parts: SpecParts, opts: BuildOpts): KalamSpec {
  const theme = themeFromPreset(parts.theme);
  const first = parts.screens[0];
  if (!first) throw new Error(`Template ${parts.templateId} produced no screens`);
  return {
    id: opts.appId,
    schemaVersion: SCHEMA_VERSION,
    version: 1,
    name: parts.name.slice(0, 60),
    description: parts.description.slice(0, 280),
    icon: { glyph: parts.glyph, background: theme.primary, foreground: '#FFFFFF' },
    lang: opts.lang,
    theme,
    collections: parts.collections,
    screens: parts.screens,
    initialScreen: first.id,
    actions: parts.actions,
    aiBlocks: {},
    // Only keep intents whose action exists (validator rejects dangling intents).
    intents: Object.fromEntries(Object.entries(parts.intents).filter(([id]) => id in parts.actions)),
    meta: {
      createdAt: opts.now,
      description: parts.description.slice(0, 280),
      tags: parts.tags.slice(0, 8),
      source: 'template',
      templateId: parts.templateId,
      generator: { route: 'deterministic', provider: 'deterministic' },
    },
  };
}

/**
 * Voice/intent phrases: English, Hinglish (Latin script) and Hindi (Devanagari, as produced by
 * hi-IN speech recognition). Each list stays ≤ 12 phrases (LIMITS.intentPhrasesPerAction).
 */
export const PHRASES = {
  save: ['save', 'save it', 'done', 'rakh do', 'save karo', 'likh lo', 'सेव करो', 'रख दो'],
  update: ['save changes', 'update', 'badal do', 'update karo', 'बदल दो', 'अपडेट करो'],
  remove: ['delete', 'remove', 'hata do', 'mita do', 'हटा दो', 'मिटा दो'],
  home: ['go back', 'back', 'home', 'wapas', 'peeche jao', 'वापस', 'होम'],
  clear: ['clear', 'reset', 'start again', 'saaf karo', 'mita do', 'साफ़ करो'],
} as const;

export const phrases = (...lists: ReadonlyArray<readonly string[]>): string[] =>
  [...new Set(lists.flat())].slice(0, 12);

/** Standard "go home" + "save" + "update" + "delete" actions for a record collection. */
export function crudActions(collection: string, noun: string, home: string, addScreen: string): Record<string, KalamAction> {
  return {
    go_home: { type: 'navigate', screen: home },
    go_add: { type: 'navigate', screen: addScreen },
    [`save_${collection}`]: {
      type: 'insert', collection, then: { feedback: `${noun} saved`, navigate: home },
    },
    [`update_${collection}`]: {
      type: 'update', collection, record: 'selected', then: { feedback: `${noun} updated`, navigate: home },
    },
    [`delete_${collection}`]: {
      type: 'delete', collection, record: 'selected',
      confirm: `Delete this ${noun.toLowerCase()}? This cannot be undone.`,
      then: { feedback: `${noun} deleted`, navigate: home },
    },
  };
}

/** Makes user text safe inside a single-quoted formula string literal. */
export const quoteLiteral = (s: string): string => s.replace(/['\\\n\r]/g, '');

/** Enum options that are also used inside formulas: quote-safe, trimmed, unique, never empty. */
export function cleanOptions(list: readonly string[], fallback: string): string[] {
  const out = [...new Set(list.map((s) => quoteLiteral(s).trim().slice(0, 40)).filter(Boolean))];
  return out.length ? out : [fallback];
}

export const optionalString = z.string().trim().min(1).max(60);
export const labelList = (max: number) => z.array(z.string().trim().min(1).max(40)).min(1).max(max);
