/**
 * The ten interface languages (docs/10 §11.1) and the helpers that normalise language tags.
 * `native` is the name in its own script and is never translated.
 * Pure TypeScript.
 */
import type { Script } from './scripts';

export interface LanguageInfo {
  /** Stable code used for catalogues, settings and `lang` attributes. */
  readonly code: string;
  readonly native: string;
  readonly english: string;
  readonly script: Script;
  /** Regional locale used for Intl and speech: `hi-IN`. English defaults to `en-IN`. */
  readonly locale: string;
}

export const LANGUAGES = [
  { code: 'en', native: 'English', english: 'English', script: 'latin', locale: 'en-IN' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', script: 'devanagari', locale: 'hi-IN' },
  { code: 'gu', native: 'ગુજરાતી', english: 'Gujarati', script: 'gujarati', locale: 'gu-IN' },
  { code: 'mr', native: 'मराठी', english: 'Marathi', script: 'devanagari', locale: 'mr-IN' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali', script: 'bengali', locale: 'bn-IN' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil', script: 'tamil', locale: 'ta-IN' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu', script: 'telugu', locale: 'te-IN' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada', script: 'kannada', locale: 'kn-IN' },
  { code: 'ml', native: 'മലയാളം', english: 'Malayalam', script: 'malayalam', locale: 'ml-IN' },
  { code: 'pa', native: 'ਪੰਜਾਬੀ', english: 'Punjabi', script: 'gurmukhi', locale: 'pa-IN' },
] as const satisfies readonly LanguageInfo[];

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export const LANGUAGE_CODES: readonly LanguageCode[] = LANGUAGES.map((l) => l.code);
export const DEFAULT_LANGUAGE: LanguageCode = 'en';

const BY_CODE: ReadonlyMap<string, (typeof LANGUAGES)[number]> = new Map(LANGUAGES.map((l) => [l.code, l]));

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && BY_CODE.has(value);
}

/** Primary language subtag, lower-cased: `HI_in` and `hi-IN` both give `hi`. Empty string if unusable. */
function primarySubtag(tag: string | null | undefined): string {
  if (!tag) return '';
  const first = tag.trim().split(/[-_]/)[0] ?? '';
  return /^[A-Za-z]{2,3}$/.test(first) ? first.toLowerCase() : '';
}

/** Maps any tag (`hi-IN`, `mr_IN`, `pa-Guru-IN`) to a supported language, or `en`. */
export function resolveLanguage(tag: string | null | undefined): LanguageCode {
  const primary = primarySubtag(tag);
  return isLanguageCode(primary) ? primary : DEFAULT_LANGUAGE;
}

/** First supported language in an ordered list such as the device's preferred languages. */
export function pickSupportedLanguage(tags: readonly (string | null | undefined)[]): LanguageCode {
  for (const tag of tags) {
    const primary = primarySubtag(tag);
    if (isLanguageCode(primary)) return primary;
  }
  return DEFAULT_LANGUAGE;
}

export function languageInfo(tag: string | null | undefined): (typeof LANGUAGES)[number] {
  return BY_CODE.get(resolveLanguage(tag)) as (typeof LANGUAGES)[number];
}

/** Intl and speech locale for a language, for example `hi-IN`. */
export function localeFor(tag: string | null | undefined): string {
  return languageInfo(tag).locale;
}

/**
 * Value for the HTML `lang` attribute. Keeps a valid BCP-47 tag (including tags for languages Kalam
 * has no catalogue for, such as an app written in French) and falls back to `en`.
 */
export function htmlLang(tag: string | null | undefined): string {
  if (!tag) return DEFAULT_LANGUAGE;
  const parts = tag.trim().split(/[-_]/);
  if (!parts.length || !/^[A-Za-z]{2,3}$/.test(parts[0] ?? '')) return DEFAULT_LANGUAGE;
  const clean: string[] = [];
  for (const [i, part] of parts.entries()) {
    if (!/^[A-Za-z0-9]{1,8}$/.test(part)) return DEFAULT_LANGUAGE;
    if (i === 0) clean.push(part.toLowerCase());
    else if (part.length === 4 && /^[A-Za-z]+$/.test(part)) clean.push(part[0]!.toUpperCase() + part.slice(1).toLowerCase());
    else if (part.length === 2 && /^[A-Za-z]+$/.test(part)) clean.push(part.toUpperCase());
    else clean.push(part.toLowerCase());
  }
  return clean.join('-');
}

const RTL_LANGUAGES: ReadonlySet<string> = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'ckb', 'dv']);

/** All ten shipped languages are left to right. Ready for RTL so layouts need no rewrite later. */
export function textDirection(tag: string | null | undefined): 'ltr' | 'rtl' {
  const parts = (tag ?? '').trim().split(/[-_]/);
  if (parts.some((p, i) => i > 0 && p.toLowerCase() === 'arab')) return 'rtl';
  return RTL_LANGUAGES.has((parts[0] ?? '').toLowerCase()) ? 'rtl' : 'ltr';
}
