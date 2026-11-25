/**
 * Generated-app theme presets (docs/02 §12.2) as concrete KalamSpec token sets.
 * These style user apps only — never the Kalam shell (src/design/tokens.ts).
 * Text/background pairs meet WCAG AA (≥ 4.5:1); primary colours carry white button text.
 */
import type { KalamTheme, ThemePreset } from '../spec/schema';

export const THEME_PRESET_TOKENS: Readonly<Record<ThemePreset, KalamTheme>> = {
  calm_green: {
    preset: 'calm_green', primary: '#315C4C', secondary: '#D69B52', background: '#F8F7F2', surface: '#FFFFFF',
    text: '#202820', radius: 14, fontScale: 1, spacing: 'comfortable', fontFamily: 'inter',
  },
  warm_paper: {
    preset: 'warm_paper', primary: '#8A4B2A', secondary: '#C99A3B', background: '#FBF6EC', surface: '#FFFDF8',
    text: '#2B2118', radius: 10, fontScale: 1, spacing: 'comfortable', fontFamily: 'serif',
  },
  ocean_blue: {
    preset: 'ocean_blue', primary: '#1F5F8B', secondary: '#2E8C88', background: '#F4F8FB', surface: '#FFFFFF',
    text: '#14212B', radius: 14, fontScale: 1, spacing: 'comfortable', fontFamily: 'inter',
  },
  soft_lavender: {
    preset: 'soft_lavender', primary: '#6A4C93', secondary: '#C2678A', background: '#F8F6FC', surface: '#FFFFFF',
    text: '#241B2F', radius: 18, fontScale: 1, spacing: 'comfortable', fontFamily: 'rounded',
  },
  minimal_neutral: {
    preset: 'minimal_neutral', primary: '#2F3437', secondary: '#6B7175', background: '#FAFAFA', surface: '#FFFFFF',
    text: '#1B1D1F', radius: 8, fontScale: 1, spacing: 'compact', fontFamily: 'system',
  },
  high_contrast: {
    preset: 'high_contrast', primary: '#002D72', secondary: '#8A1C00', background: '#FFFFFF', surface: '#FFFFFF',
    text: '#000000', radius: 6, fontScale: 1.15, spacing: 'spacious', fontFamily: 'system',
  },
};

/** Fresh copy of a preset's tokens (specs must never share mutable objects). */
export function themeFromPreset(preset: ThemePreset): KalamTheme {
  return { ...THEME_PRESET_TOKENS[preset] };
}
