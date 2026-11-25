/**
 * Font assets + family resolution. Each weight is registered as its own family because custom
 * fonts on Android and the web cannot synthesise weights reliably (web would faux-bold a
 * SemiBold file). Never set `fontWeight` together with these families.
 */
import { Fraunces_400Regular } from '@expo-google-fonts/fraunces/400Regular';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Platform } from 'react-native';

import { scriptFontCssStack, scriptFontFamily, type Script } from '@/i18n/scripts';

import { fontFamilies } from './tokens';

/** Pass to `useFonts()` once at the root. Keys are the family names used below. */
export const fontAssets = {
  [fontFamilies.ui]: Inter_400Regular,
  [fontFamilies.uiMedium]: Inter_500Medium,
  [fontFamilies.uiSemibold]: Inter_600SemiBold,
  [fontFamilies.uiBold]: Inter_700Bold,
  [fontFamilies.display]: Fraunces_600SemiBold,
  [fontFamilies.displayRegular]: Fraunces_400Regular,
};

export type FontWeightName = 'regular' | 'medium' | 'semibold' | 'bold';

// Indic scripts are not in Inter/Fraunces: the browser falls back per glyph to Noto / system
// fonts (docs/02 §6.2). Android falls back to system fonts automatically.
const WEB_SANS = ', "Noto Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const WEB_SERIF = ', "Noto Serif", Georgia, serif';

const UI: Record<FontWeightName, string> = {
  regular: fontFamilies.ui,
  medium: fontFamilies.uiMedium,
  semibold: fontFamilies.uiSemibold,
  bold: fontFamilies.uiBold,
};

/**
 * Resolves the registered family for a weight. `display` selects Fraunces (regular or semibold).
 * `script` is the loaded script of the UI language (`theme.script`): Indic scripts use their Noto
 * family on Android and iOS, and a stack that keeps Inter or Fraunces for Latin letters on the web.
 */
export function fontFamily(weight: FontWeightName = 'regular', display = false, script: Script = 'latin'): string {
  const base = display
    ? weight === 'regular' ? fontFamilies.displayRegular : fontFamilies.display
    : UI[weight];
  if (script !== 'latin') {
    return Platform.OS === 'web' ? scriptFontCssStack(script, weight, base) : (scriptFontFamily(script, weight) ?? base);
  }
  if (Platform.OS !== 'web') return base;
  return `${base}${display ? WEB_SERIF : WEB_SANS}`;
}
