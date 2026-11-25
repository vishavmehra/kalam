/**
 * Theme preset token sets (docs/02 §12.2) and colour vocabulary for deterministic small edits.
 * Presets are token sets, not component variants: applying one rewrites the colour tokens.
 */
import type { ThemePreset } from '../spec/schema';

export interface PresetTokens { primary: string; secondary: string; background: string; surface: string; text: string }

export const THEME_PRESET_TOKENS: Record<ThemePreset, PresetTokens> = {
  calm_green: { primary: '#2F6B4F', secondary: '#D9A441', background: '#F4F7F2', surface: '#FFFFFF', text: '#1C2B22' },
  warm_paper: { primary: '#8A4B14', secondary: '#C9772B', background: '#FBF6EC', surface: '#FFFDF8', text: '#2B2118' },
  ocean_blue: { primary: '#1F5FA8', secondary: '#2BB3C0', background: '#F2F7FC', surface: '#FFFFFF', text: '#10233A' },
  soft_lavender: { primary: '#5B4B9A', secondary: '#E58FB0', background: '#F7F5FC', surface: '#FFFFFF', text: '#241F3A' },
  minimal_neutral: { primary: '#2E2E2E', secondary: '#8A8A8A', background: '#FAFAFA', surface: '#FFFFFF', text: '#1A1A1A' },
  high_contrast: { primary: '#000000', secondary: '#FFD400', background: '#FFFFFF', surface: '#FFFFFF', text: '#000000' },
};

export const DARK_TOKENS = { background: '#121417', surface: '#1E2228', text: '#F2F4F5' } as const;
export const LIGHT_TOKENS = { background: '#FAFAF7', surface: '#FFFFFF', text: '#1A1A1A' } as const;

const GREEN = '#2E7D32';
const BLUE = '#1E63C6';
const RED = '#D32F2F';
const YELLOW = '#F2C200';
const BLACK = '#111111';
const WHITE = '#FFFFFF';
const PINK = '#D81B60';
const ORANGE = '#EF6C00';
const PURPLE = '#6A3FB5';
const BROWN = '#6D4C41';
const SKY = '#4FA3E0';
const GOLD = '#C9A227';
const SAFFRON = '#F4A431';

/** English + romanised Hindi colour words → hex. Multi-word names are matched first. */
export const COLOUR_WORDS: Record<string, string> = {
  'dark blue': '#0D3B7A', 'light blue': '#8EC5F5', 'sky blue': SKY, 'navy blue': '#1A2A6C',
  'dark green': '#1B5E20', 'light green': '#A5D6A7', 'dark red': '#8E1B1B', 'light pink': '#F8BBD0',
  'dark grey': '#424242', 'dark gray': '#424242', 'light grey': '#E0E0E0', 'light gray': '#E0E0E0',
  red: RED, green: GREEN, blue: BLUE, yellow: YELLOW, orange: ORANGE, purple: PURPLE, violet: '#7B4FD6',
  pink: PINK, brown: BROWN, black: BLACK, white: WHITE, grey: '#757575', gray: '#757575', teal: '#00897B',
  navy: '#1A2A6C', maroon: '#7B1E2B', gold: GOLD, golden: GOLD, cream: '#FFF8E7', beige: '#F5EBDC',
  lavender: '#B9A6E8', indigo: '#3F51B5', cyan: '#00ACC1', olive: '#6B7B2A', mint: '#9ED9C3',
  peach: '#FFCBA4', saffron: SAFFRON, sky: SKY, turquoise: '#1ABC9C', magenta: '#C2185B',
  hara: GREEN, hari: GREEN, hare: GREEN, neela: BLUE, neeli: BLUE, neele: BLUE, nila: BLUE, nili: BLUE,
  laal: RED, lal: RED, peela: YELLOW, peeli: YELLOW, peele: YELLOW, pila: YELLOW, kaala: BLACK, kaali: BLACK,
  kala: BLACK, safed: WHITE, safaid: WHITE, gulabi: PINK, narangi: ORANGE, santri: ORANGE, baingani: PURPLE,
  jamuni: PURPLE, bhura: BROWN, bhuri: BROWN, aasmani: SKY, asmani: SKY, sunehra: GOLD, sunehri: GOLD,
  kesari: SAFFRON, kesariya: SAFFRON,
};
