/**
 * Which Noto font a piece of drawing text needs (docs/08 §6.6). Pure: the loading itself is in
 * `../text-fonts.ts`. The web canvas gets a CSS font stack, the Skia canvas on Android gets the registered
 * family names for its paragraph builder. Latin-only text needs nothing and keeps the normal path.
 */
import { detectScripts, scriptFontCssStack, scriptFontFamily, type NonLatinScript, type ScriptFontWeight } from '@/i18n/scripts';

/** Quick check for the eight Indic blocks, so ordinary English text never pays for script detection. */
const INDIC = new RegExp('[\\u0900-\\u0d7f]');

export const needsScriptFont = (text: string): boolean => INDIC.test(text);

/** Non-Latin scripts in `text`, most characters first. */
export function nonLatinScripts(text: string): NonLatinScript[] {
  if (!needsScriptFont(text)) return [];
  return detectScripts(text).filter((s): s is NonLatinScript => s !== 'latin');
}

/** Registered family names to ask for, one per script in the text. Empty for Latin-only text. */
export function textFontFamilies(text: string, weight: ScriptFontWeight = 'regular'): string[] {
  return nonLatinScripts(text).map((s) => scriptFontFamily(s, weight)).filter((f): f is string => !!f);
}

/** CSS `font-family` for the web canvas, or undefined when the text is Latin only. The Latin face stays first. */
export function canvasFontStack(text: string, weight: ScriptFontWeight, latinFamily: string): string | undefined {
  const scripts = nonLatinScripts(text);
  const [primary, ...rest] = scripts;
  if (!primary) return undefined;
  const base = scriptFontCssStack(primary, weight, latinFamily);
  const extra = rest.map((s) => `"${scriptFontFamily(s, weight)}"`);
  return extra.length ? base.replace(', "Noto Sans", ', `, ${extra.join(', ')}, "Noto Sans", `) : base;
}
