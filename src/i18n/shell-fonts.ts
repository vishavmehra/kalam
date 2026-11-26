/**
 * Kalam's own screens use Anek for body text and Tiro for display, one real face per script (DIRECTION §3,
 * "Khata and Kalam"). Generated apps keep the Noto faces in `scripts.ts`: an app's KalamSpec theme names its
 * own font, so the shell and an app never share a family. Pure TypeScript; the files are in
 * `shell-font-assets.ts` and load through `useShellFonts()` in `use-script-fonts.ts`.
 *
 * Anek Latin and Tiro Devanagari Hindi (which also carries Kalam's Latin display) load at the root; the
 * other scripts load only when they are the language of Kalam's screens.
 */
import { SCRIPT_FONT_WEIGHTS, type NonLatinScript, type Script, type ScriptFontWeight } from './scripts';

const ANEK: Record<Script, string> = {
  latin: 'AnekLatin',
  devanagari: 'AnekDevanagari',
  bengali: 'AnekBangla',
  gurmukhi: 'AnekGurmukhi',
  gujarati: 'AnekGujarati',
  tamil: 'AnekTamil',
  telugu: 'AnekTelugu',
  kannada: 'AnekKannada',
  malayalam: 'AnekMalayalam',
};

/** Tiro for Latin and seven Indic scripts; Gujarati and Malayalam display use Noto Serif 500 (DIRECTION §3). */
const DISPLAY: Record<Script, string> = {
  latin: 'TiroDevanagariHindi_400Regular',
  devanagari: 'TiroDevanagariHindi_400Regular',
  bengali: 'TiroBangla_400Regular',
  gurmukhi: 'TiroGurmukhi_400Regular',
  gujarati: 'NotoSerifGujarati_500Medium',
  tamil: 'TiroTamil_400Regular',
  telugu: 'TiroTelugu_400Regular',
  kannada: 'TiroKannada_400Regular',
  malayalam: 'NotoSerifMalayalam_500Medium',
};

const SUFFIX: Record<ScriptFontWeight, string> = { regular: '400Regular', medium: '500Medium', semibold: '600SemiBold', bold: '700Bold' };

/** Registered Anek family for a script and weight, e.g. `AnekTamil_600SemiBold`. Never also set `fontWeight`. */
export function shellFamily(script: Script, weight: ScriptFontWeight = 'regular'): string {
  return `${ANEK[script]}_${SUFFIX[weight]}`;
}

/** Registered display family for a script (one weight). */
export function shellDisplayFamily(script: Script): string {
  return DISPLAY[script];
}

/** Families one script's screens need beyond the root fonts. Latin needs none. */
export function shellFontFamilies(script: Script): string[] {
  if (script === 'latin') return [];
  const body = SCRIPT_FONT_WEIGHTS.map((w) => shellFamily(script, w));
  return script === 'devanagari' ? body : [...body, shellDisplayFamily(script)];
}

const WEB_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const WEB_SERIF = 'Georgia, serif';

/**
 * CSS `font-family` for the web. The Latin face goes first so digits and Latin words keep Anek Latin or
 * Tiro; the browser falls back per glyph to the script face for everything else.
 */
export function shellFontCssStack(script: Script, weight: ScriptFontWeight = 'regular', display = false): string {
  const parts = [`"${display ? DISPLAY.latin : shellFamily('latin', weight)}"`];
  if (script !== 'latin') {
    const own = display ? shellDisplayFamily(script) : shellFamily(script, weight);
    if (!parts.includes(`"${own}"`)) parts.push(`"${own}"`);
  }
  parts.push(display ? WEB_SERIF : WEB_SANS);
  return parts.join(', ');
}

/** Folder and file stem of each family's TTF under `assets/fonts/` (for the asset map and its test). */
export function shellFontFile(family: string): string {
  const [name, weight] = family.split('_');
  const stem = { '400Regular': 'Regular', '500Medium': 'Medium', '600SemiBold': 'SemiBold', '700Bold': 'Bold', '700Wide': 'Wide' }[weight] ?? weight;
  return `${name.toLowerCase()}/${name}-${stem}.ttf`;
}

export type { NonLatinScript };
