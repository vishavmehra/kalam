/**
 * Noto Sans font files for the eight Indic scripts, four weights each (the weights `design/typography`
 * uses: regular, medium, semibold, bold). Importing this file registers nothing and downloads nothing:
 * fonts load only when `use-script-fonts.ts` asks for a script.
 */
import { NotoSansBengali_400Regular } from '@expo-google-fonts/noto-sans-bengali/400Regular';
import { NotoSansBengali_500Medium } from '@expo-google-fonts/noto-sans-bengali/500Medium';
import { NotoSansBengali_600SemiBold } from '@expo-google-fonts/noto-sans-bengali/600SemiBold';
import { NotoSansBengali_700Bold } from '@expo-google-fonts/noto-sans-bengali/700Bold';
import { NotoSansDevanagari_400Regular } from '@expo-google-fonts/noto-sans-devanagari/400Regular';
import { NotoSansDevanagari_500Medium } from '@expo-google-fonts/noto-sans-devanagari/500Medium';
import { NotoSansDevanagari_600SemiBold } from '@expo-google-fonts/noto-sans-devanagari/600SemiBold';
import { NotoSansDevanagari_700Bold } from '@expo-google-fonts/noto-sans-devanagari/700Bold';
import { NotoSansGujarati_400Regular } from '@expo-google-fonts/noto-sans-gujarati/400Regular';
import { NotoSansGujarati_500Medium } from '@expo-google-fonts/noto-sans-gujarati/500Medium';
import { NotoSansGujarati_600SemiBold } from '@expo-google-fonts/noto-sans-gujarati/600SemiBold';
import { NotoSansGujarati_700Bold } from '@expo-google-fonts/noto-sans-gujarati/700Bold';
import { NotoSansGurmukhi_400Regular } from '@expo-google-fonts/noto-sans-gurmukhi/400Regular';
import { NotoSansGurmukhi_500Medium } from '@expo-google-fonts/noto-sans-gurmukhi/500Medium';
import { NotoSansGurmukhi_600SemiBold } from '@expo-google-fonts/noto-sans-gurmukhi/600SemiBold';
import { NotoSansGurmukhi_700Bold } from '@expo-google-fonts/noto-sans-gurmukhi/700Bold';
import { NotoSansKannada_400Regular } from '@expo-google-fonts/noto-sans-kannada/400Regular';
import { NotoSansKannada_500Medium } from '@expo-google-fonts/noto-sans-kannada/500Medium';
import { NotoSansKannada_600SemiBold } from '@expo-google-fonts/noto-sans-kannada/600SemiBold';
import { NotoSansKannada_700Bold } from '@expo-google-fonts/noto-sans-kannada/700Bold';
import { NotoSansMalayalam_400Regular } from '@expo-google-fonts/noto-sans-malayalam/400Regular';
import { NotoSansMalayalam_500Medium } from '@expo-google-fonts/noto-sans-malayalam/500Medium';
import { NotoSansMalayalam_600SemiBold } from '@expo-google-fonts/noto-sans-malayalam/600SemiBold';
import { NotoSansMalayalam_700Bold } from '@expo-google-fonts/noto-sans-malayalam/700Bold';
import { NotoSansTamil_400Regular } from '@expo-google-fonts/noto-sans-tamil/400Regular';
import { NotoSansTamil_500Medium } from '@expo-google-fonts/noto-sans-tamil/500Medium';
import { NotoSansTamil_600SemiBold } from '@expo-google-fonts/noto-sans-tamil/600SemiBold';
import { NotoSansTamil_700Bold } from '@expo-google-fonts/noto-sans-tamil/700Bold';
import { NotoSansTelugu_400Regular } from '@expo-google-fonts/noto-sans-telugu/400Regular';
import { NotoSansTelugu_500Medium } from '@expo-google-fonts/noto-sans-telugu/500Medium';
import { NotoSansTelugu_600SemiBold } from '@expo-google-fonts/noto-sans-telugu/600SemiBold';
import { NotoSansTelugu_700Bold } from '@expo-google-fonts/noto-sans-telugu/700Bold';

import type { FontMap } from './font-loader';
import type { NonLatinScript } from './scripts';

/** Keys are the family names from `scriptFontFamily()`. */
export const scriptFontAssets: Record<NonLatinScript, FontMap> = {
  devanagari: {
    NotoSansDevanagari_400Regular,
    NotoSansDevanagari_500Medium,
    NotoSansDevanagari_600SemiBold,
    NotoSansDevanagari_700Bold,
  },
  bengali: {
    NotoSansBengali_400Regular,
    NotoSansBengali_500Medium,
    NotoSansBengali_600SemiBold,
    NotoSansBengali_700Bold,
  },
  gurmukhi: {
    NotoSansGurmukhi_400Regular,
    NotoSansGurmukhi_500Medium,
    NotoSansGurmukhi_600SemiBold,
    NotoSansGurmukhi_700Bold,
  },
  gujarati: {
    NotoSansGujarati_400Regular,
    NotoSansGujarati_500Medium,
    NotoSansGujarati_600SemiBold,
    NotoSansGujarati_700Bold,
  },
  tamil: {
    NotoSansTamil_400Regular,
    NotoSansTamil_500Medium,
    NotoSansTamil_600SemiBold,
    NotoSansTamil_700Bold,
  },
  telugu: {
    NotoSansTelugu_400Regular,
    NotoSansTelugu_500Medium,
    NotoSansTelugu_600SemiBold,
    NotoSansTelugu_700Bold,
  },
  kannada: {
    NotoSansKannada_400Regular,
    NotoSansKannada_500Medium,
    NotoSansKannada_600SemiBold,
    NotoSansKannada_700Bold,
  },
  malayalam: {
    NotoSansMalayalam_400Regular,
    NotoSansMalayalam_500Medium,
    NotoSansMalayalam_600SemiBold,
    NotoSansMalayalam_700Bold,
  },
};
