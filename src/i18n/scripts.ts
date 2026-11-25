/**
 * Writing scripts: which script a language uses, which script a piece of text is written in,
 * and the font family names the Noto script fonts register under (docs/10 §12.1, docs/02 §6.2).
 * Pure TypeScript, so it runs in Node tests. Loading the font files happens in `use-script-fonts.ts`.
 */
import { languageInfo } from './languages';

export type Script =
  | 'latin'
  | 'devanagari'
  | 'bengali'
  | 'gurmukhi'
  | 'gujarati'
  | 'tamil'
  | 'telugu'
  | 'kannada'
  | 'malayalam';

export type NonLatinScript = Exclude<Script, 'latin'>;

export const SCRIPTS: readonly Script[] = [
  'latin',
  'devanagari',
  'bengali',
  'gurmukhi',
  'gujarati',
  'tamil',
  'telugu',
  'kannada',
  'malayalam',
];

export const NON_LATIN_SCRIPTS: readonly NonLatinScript[] = SCRIPTS.filter((s): s is NonLatinScript => s !== 'latin');

/** Unicode blocks, start and end inclusive. Latin lists letters only so digits and punctuation stay neutral. */
const RANGES: readonly (readonly [Script, number, number])[] = [
  ['latin', 0x0041, 0x005a],
  ['latin', 0x0061, 0x007a],
  ['latin', 0x00c0, 0x00d6],
  ['latin', 0x00d8, 0x00f6],
  ['latin', 0x00f8, 0x024f],
  ['latin', 0x1e00, 0x1eff],
  ['devanagari', 0x0900, 0x097f],
  ['devanagari', 0xa8e0, 0xa8ff],
  ['bengali', 0x0980, 0x09ff],
  ['gurmukhi', 0x0a00, 0x0a7f],
  ['gujarati', 0x0a80, 0x0aff],
  ['tamil', 0x0b80, 0x0bff],
  ['telugu', 0x0c00, 0x0c7f],
  ['kannada', 0x0c80, 0x0cff],
  ['malayalam', 0x0d00, 0x0d7f],
];

/** The danda marks (U+0964, U+0965) are shared by every Indic script, so they never vote. */
const SHARED = (cp: number): boolean => cp === 0x0964 || cp === 0x0965;

/** Script of one code point, or null for digits, punctuation, spaces, joiners and everything else. */
export function scriptOfCodePoint(cp: number): Script | null {
  if (SHARED(cp)) return null;
  for (const [script, from, to] of RANGES) {
    if (cp >= from && cp <= to) return script;
  }
  return null;
}

/** Scripts present in `text`, most characters first. Empty when the text has no letters. */
export function detectScripts(text: string): Script[] {
  const counts = new Map<Script, number>();
  const firstSeen = new Map<Script, number>();
  let index = 0;
  for (const ch of text) {
    const script = scriptOfCodePoint(ch.codePointAt(0) ?? 0);
    if (script) {
      counts.set(script, (counts.get(script) ?? 0) + 1);
      if (!firstSeen.has(script)) firstSeen.set(script, index);
    }
    index += 1;
  }
  return [...counts.keys()].sort((a, b) => (counts.get(b)! - counts.get(a)!) || (firstSeen.get(a)! - firstSeen.get(b)!));
}

/** The script most of `text` is written in, or null when it has no letters. */
export function detectScript(text: string): Script | null {
  return detectScripts(text)[0] ?? null;
}

/** Script a language is written in. Unknown languages count as Latin. */
export function scriptForLanguage(tag: string | null | undefined): Script {
  return languageInfo(tag).script;
}

/** Scripts whose fonts must be loaded to show these languages. Latin is excluded: Inter is always loaded. */
export function fontScriptsForLanguages(tags: readonly (string | null | undefined)[]): NonLatinScript[] {
  const wanted = new Set<NonLatinScript>();
  for (const tag of tags) {
    const script = scriptForLanguage(tag);
    if (script !== 'latin') wanted.add(script);
  }
  return [...wanted];
}

// ---------------------------------------------------------------------------------------------
// Font family names
// ---------------------------------------------------------------------------------------------

export type ScriptFontWeight = 'regular' | 'medium' | 'semibold' | 'bold';

export const SCRIPT_FONT_WEIGHTS: readonly ScriptFontWeight[] = ['regular', 'medium', 'semibold', 'bold'];

/** Prefix of the `@expo-google-fonts/noto-sans-*` family names. */
const FAMILY_PREFIX: Record<NonLatinScript, string> = {
  devanagari: 'NotoSansDevanagari',
  bengali: 'NotoSansBengali',
  gurmukhi: 'NotoSansGurmukhi',
  gujarati: 'NotoSansGujarati',
  tamil: 'NotoSansTamil',
  telugu: 'NotoSansTelugu',
  kannada: 'NotoSansKannada',
  malayalam: 'NotoSansMalayalam',
};

const WEIGHT_SUFFIX: Record<ScriptFontWeight, string> = {
  regular: '400Regular',
  medium: '500Medium',
  semibold: '600SemiBold',
  bold: '700Bold',
};

/** Human family name that system fonts use, for the web fallback stack. */
const SYSTEM_NAME: Record<NonLatinScript, string> = {
  devanagari: 'Noto Sans Devanagari',
  bengali: 'Noto Sans Bengali',
  gurmukhi: 'Noto Sans Gurmukhi',
  gujarati: 'Noto Sans Gujarati',
  tamil: 'Noto Sans Tamil',
  telugu: 'Noto Sans Telugu',
  kannada: 'Noto Sans Kannada',
  malayalam: 'Noto Sans Malayalam',
};

/**
 * Registered family name for a script and weight, for example `NotoSansDevanagari_500Medium`.
 * Returns null for Latin: keep using the Inter families from `design/typography`.
 * Each weight is its own family (custom fonts cannot synthesise weights), so never also set `fontWeight`.
 */
export function scriptFontFamily(script: Script, weight: ScriptFontWeight = 'regular'): string | null {
  if (script === 'latin') return null;
  return `${FAMILY_PREFIX[script]}_${WEIGHT_SUFFIX[weight]}`;
}

/** Every family name registered for a script. */
export function scriptFontFamilies(script: Script): string[] {
  return script === 'latin' ? [] : SCRIPT_FONT_WEIGHTS.map((w) => scriptFontFamily(script, w) as string);
}

const WEB_TAIL = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * CSS `font-family` value for the web. The Latin face goes first so digits and Latin letters keep
 * Inter; the browser falls back per glyph to the script font for everything else.
 * Pass `latinFamily` (for example `Inter_500Medium`) to keep the brand face for Latin text.
 */
export function scriptFontCssStack(script: Script, weight: ScriptFontWeight = 'regular', latinFamily?: string): string {
  const parts: string[] = [];
  if (latinFamily) parts.push(`"${latinFamily}"`);
  if (script !== 'latin') {
    parts.push(`"${scriptFontFamily(script, weight)}"`, `"${SYSTEM_NAME[script]}"`);
  }
  parts.push('"Noto Sans"', WEB_TAIL);
  return parts.join(', ');
}
