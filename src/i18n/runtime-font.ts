/**
 * Picks the Noto font for a generated app from its language (`spec.lang`). The app's font follows the
 * app's language, not the language of Kalam's screens, so a Hindi screen can show an English app in Inter
 * and a Tamil app in Noto Sans Tamil. Pure TypeScript; `useRuntimeFont` in `use-script-fonts.ts` loads the files.
 */
import { scriptFontCssStack, scriptFontFamily, scriptForLanguage, type Script, type ScriptFontWeight } from './scripts';

export interface RuntimeFont {
  /** Script the font is for. `latin` means keep the normal Inter styles. */
  script: Script;
  /** Registered family for `fontFamily` on native and web, or undefined for Latin (keep Inter). */
  family(weight?: ScriptFontWeight): string | undefined;
  /** CSS `font-family` stack for the web. Pass the Inter family for the same weight as `latinFamily`. */
  cssStack(weight?: ScriptFontWeight, latinFamily?: string): string;
}

/**
 * @param lang `spec.lang`, any BCP-47 tag or undefined (treated as Latin).
 * @param loadedScript Script whose fonts are already loaded. Defaults to the language's own script, which is
 *                     right once `loadScriptFonts` has resolved.
 */
export function runtimeFont(lang: string | null | undefined, loadedScript?: Script): RuntimeFont {
  const script = loadedScript ?? scriptForLanguage(lang);
  return {
    script,
    family: (weight = 'regular') => scriptFontFamily(script, weight) ?? undefined,
    cssStack: (weight = 'regular', latinFamily) => scriptFontCssStack(script, weight, latinFamily),
  };
}
