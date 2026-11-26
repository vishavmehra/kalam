/**
 * Shell font assets and family resolution (DIRECTION §3): Tiro for display, Anek for body and UI, Kalam for
 * things that really are handwritten, Courier Prime for order-book numbering. Every weight is registered as
 * its own family because Android and the web cannot synthesise weights from a custom file, so never set
 * `fontWeight` together with these families.
 *
 * The root loads Anek Latin, its wide money cut, Tiro Devanagari Hindi (Kalam's Latin and Devanagari display)
 * and Courier Prime Bold. Other scripts load with the language (`useShellFonts`), Kalam only on demand.
 */
import * as Font from 'expo-font';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import type { Script } from '@/i18n/scripts';
import { shellDisplayFamily, shellFamily, shellFontCssStack } from '@/i18n/shell-fonts';

import { fontFamilies } from './tokens';

/** Pass to `useFonts()` once at the root. Keys are the family names used below. */
export const fontAssets = {
  AnekLatin_400Regular: require('../../assets/fonts/aneklatin/AnekLatin-Regular.ttf'),
  AnekLatin_500Medium: require('../../assets/fonts/aneklatin/AnekLatin-Medium.ttf'),
  AnekLatin_600SemiBold: require('../../assets/fonts/aneklatin/AnekLatin-SemiBold.ttf'),
  AnekLatin_700Bold: require('../../assets/fonts/aneklatin/AnekLatin-Bold.ttf'),
  AnekLatin_700Wide: require('../../assets/fonts/aneklatin/AnekLatin-Wide.ttf'),
  TiroDevanagariHindi_400Regular: require('../../assets/fonts/tirodevanagarihindi/TiroDevanagariHindi-Regular.ttf'),
  CourierPrime_700Bold: require('../../assets/fonts/courierprime/CourierPrime-Bold.ttf'),
};

/** Handwriting (Kalam, Latin and Devanagari): about 450 KB each, so it loads only where a screen asks. */
const handAssets = {
  Kalam_400Regular: require('../../assets/fonts/kalam/Kalam-Regular.ttf'),
  Kalam_700Bold: require('../../assets/fonts/kalam/Kalam-Bold.ttf'),
};

export type FontWeightName = 'regular' | 'medium' | 'semibold' | 'bold';

/**
 * Registered family for a weight. `display` selects Tiro (one weight; `weight` is ignored). `script` is the
 * loaded script of the UI language (`theme.script`): native gets that script's Anek or Tiro family, which
 * also carries Latin letters; the web gets a stack that keeps the Latin face first.
 */
export function fontFamily(weight: FontWeightName = 'regular', display = false, script: Script = 'latin'): string {
  if (Platform.OS === 'web') return shellFontCssStack(script, weight, display);
  return display ? shellDisplayFamily(script) : shellFamily(script, weight);
}

const webStack = (family: string, tail: string) => (Platform.OS === 'web' ? `"${family}", ${tail}` : family);

/** Courier Prime Bold: "No. 0417", step numerals, stamp dates, register stats. Never paragraphs. */
export function monoFamily(): string {
  return webStack(fontFamilies.mono, '"Courier New", ui-monospace, monospace');
}

/** Money and big numbers: Anek Latin at semi-expanded width, bold. Pair with tabular figures. */
export function moneyFamily(): string {
  return webStack(fontFamilies.money, '"AnekLatin_700Bold", system-ui, sans-serif');
}

/** Kalam handwriting. Call `useHandwritingFont()` in the screen that shows it. */
export function handFamily(bold = false): string {
  return webStack(bold ? fontFamilies.handBold : fontFamilies.hand, `"${shellDisplayFamily('devanagari')}", cursive`);
}

let handLoad: Promise<void> | null = null;

/**
 * Loads Kalam once, on first use. Returns true when it is ready; until then `handFamily()` falls back to
 * Tiro on the web and to the system face on native. Failing to load is not an error: the text still shows.
 */
export function useHandwritingFont(): boolean {
  const [ready, setReady] = useState(() => Font.isLoaded(fontFamilies.hand));
  useEffect(() => {
    if (ready) return undefined;
    let alive = true;
    handLoad ??= Font.loadAsync(handAssets).catch(() => {
      handLoad = null;
    });
    void handLoad.then(() => alive && setReady(Font.isLoaded(fontFamilies.hand)));
    return () => {
      alive = false;
    };
  }, [ready]);
  return ready;
}
