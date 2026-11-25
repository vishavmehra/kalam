/**
 * Kalam product design tokens (docs/02_DESIGN_SYSTEM.md). These style the Kalam shell only —
 * generated apps use their own KalamSpec theme (docs/02 §12). Never hardcode colours in
 * components; read them from `useKalamTheme()` (src/design/theme.tsx).
 *
 * Palette "Ink & Marigold" (docs/02 §5, decision of 2026-11-18): blue-black fountain-pen ink for
 * text and actions, a marigold highlighter for creative emphasis, and ruled-notebook paper with a
 * faint blue rule and a pink margin line as the only decorative motif. Every text pairing below
 * was measured against WCAG 2.2 (AA 4.5:1 text, 3:1 non-text; High Contrast ≥ 7:1).
 */
export const palette = {
  brand: {
    /** Blue-black ink: primary actions, links, the logo. */
    ink: '#283080',
    inkPressed: '#1C2363',
    inkSoft: '#E6E8F5',
    /** Ink as body text (deeper, almost black). */
    inkText: '#161A3D',
    /** Marigold highlighter: fills, underlines, dots. Never text on paper (1.9:1). */
    marigold: '#F2AE1C',
    marigoldSoft: '#FCEBC2',
    /** Marigold dark enough for text and small icons on paper (5.9:1). */
    marigoldInk: '#8A5300',
    paper: '#F7F7F4',
    /** Ruled-notebook motif (decorative only). */
    rule: '#D9DDEE',
    margin: '#EBA3A0',
  },
  neutral: {
    0: '#FFFFFF', 50: '#F7F7F4', 100: '#EEEFF5', 200: '#DCDEEA', 300: '#858AAB',
    500: '#5E6385', 700: '#454B6E', 900: '#161A3D',
  },
  semantic: {
    success: '#1D7048', successSoft: '#E3F3EA',
    warning: '#A0460A', warningSoft: '#FDEBDD',
    danger: '#B42E25', dangerSoft: '#FBE8E6',
    info: '#1B659A', infoSoft: '#E3F0F8',
  },
} as const;

export interface KalamColors {
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceElevated: string;
  paper: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  onPrimary: string;
  /** Marigold highlighter fill. Pair with `text`/ink content; never as text on the background. */
  accent: string;
  accentSoft: string;
  /** Accent hue that passes 4.5:1 as text/icons on background and surfaces. */
  accentInk: string;
  success: string; successSoft: string;
  warning: string; warningSoft: string;
  danger: string; dangerSoft: string;
  info: string; infoSoft: string;
  /** Execution-source colours (docs/02 §2.1 G — honest visual feedback). */
  sourceOnDevice: string;
  sourceCloud: string;
  sourceDeterministic: string;
  sourceOffline: string;
  focusRing: string;
  scrim: string;
  /** Decorative notebook rule line and margin line (never carry meaning). */
  ruleLine: string;
  marginLine: string;
}

export const lightColors: KalamColors = {
  background: palette.brand.paper,
  surface: palette.neutral[0],
  surfaceAlt: palette.neutral[100],
  surfaceElevated: palette.neutral[0],
  paper: '#FCFCFA',
  text: palette.brand.inkText,
  textSecondary: palette.neutral[700],
  textMuted: palette.neutral[500],
  border: palette.neutral[200],
  borderStrong: palette.neutral[300],
  primary: palette.brand.ink,
  primaryPressed: palette.brand.inkPressed,
  primarySoft: palette.brand.inkSoft,
  onPrimary: '#FFFFFF',
  accent: palette.brand.marigold,
  accentSoft: palette.brand.marigoldSoft,
  accentInk: palette.brand.marigoldInk,
  ...palette.semantic,
  sourceOnDevice: palette.semantic.success,
  sourceCloud: palette.semantic.info,
  sourceDeterministic: '#4A4F6E',
  sourceOffline: palette.semantic.warning,
  // Amber focus ring: 4.7:1 on paper and visibly distinct from the ink-blue primary buttons.
  focusRing: '#B45309',
  scrim: 'rgba(22,26,61,0.44)',
  ruleLine: palette.brand.rule,
  marginLine: palette.brand.margin,
};

/** Dark: writing on ink. A blue-black page, paper-white text, periwinkle ink, brighter marigold. */
export const darkColors: KalamColors = {
  background: '#121428',
  surface: '#191C33',
  surfaceAlt: '#232742',
  surfaceElevated: '#2A2E4D',
  paper: '#161930',
  text: '#ECEDF8',
  textSecondary: '#B7BBD6',
  textMuted: '#9095B5',
  border: '#30355A',
  borderStrong: '#666C99',
  primary: '#AAB3FF',
  primaryPressed: '#939EFF',
  primarySoft: '#232A55',
  onPrimary: '#10132B',
  accent: '#FFC547',
  accentSoft: '#3A2F12',
  accentInk: '#FFC547',
  success: '#79D3A2', successSoft: '#16302A',
  warning: '#FFA36E', warningSoft: '#3A2414',
  danger: '#FF9B91', dangerSoft: '#3A1C1F',
  info: '#86C3F0', infoSoft: '#15283D',
  sourceOnDevice: '#79D3A2',
  sourceCloud: '#86C3F0',
  sourceDeterministic: '#B7BBD6',
  sourceOffline: '#FFA36E',
  focusRing: '#FFC547',
  scrim: 'rgba(5,6,15,0.62)',
  ruleLine: '#262A47',
  marginLine: '#5A3446',
};

/** High Contrast access mode palettes (docs/10 §4.2) — measured ≥7:1 for text. */
export const highContrastLightColors: KalamColors = {
  ...lightColors,
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F2F2',
  surfaceElevated: '#FFFFFF',
  paper: '#FFFFFF',
  text: '#000000',
  textSecondary: '#1F1F1F',
  textMuted: '#2E2E2E',
  border: '#000000',
  borderStrong: '#000000',
  primary: '#141A5C',
  primaryPressed: '#0A0E3A',
  primarySoft: '#DDE0F7',
  accent: '#F2AE1C',
  accentInk: '#6B3F00',
  success: '#0E5232', warning: '#7A3300', danger: '#8A1C1C', info: '#123F66',
  sourceOnDevice: '#0E5232',
  sourceCloud: '#123F66',
  sourceDeterministic: '#1F1F1F',
  sourceOffline: '#7A3300',
  focusRing: '#7A3300',
  ruleLine: '#BFC3D9',
  marginLine: '#C2453F',
};

export const highContrastDarkColors: KalamColors = {
  ...darkColors,
  background: '#000000',
  surface: '#000000',
  surfaceAlt: '#141414',
  surfaceElevated: '#1A1A1A',
  paper: '#000000',
  text: '#FFFFFF',
  textSecondary: '#F0F0F0',
  textMuted: '#DADADA',
  border: '#FFFFFF',
  borderStrong: '#FFFFFF',
  primary: '#D3D8FF',
  primaryPressed: '#B9C0FF',
  primarySoft: '#161B45',
  onPrimary: '#000000',
  accent: '#FFD36B',
  accentInk: '#FFD36B',
  success: '#B9F0CF', warning: '#FFC79E', danger: '#FFB3B3', info: '#B8DCFF',
  sourceOnDevice: '#B9F0CF',
  sourceCloud: '#B8DCFF',
  sourceDeterministic: '#F0F0F0',
  sourceOffline: '#FFC79E',
  focusRing: '#FFD36B',
  ruleLine: '#3A3A3A',
  marginLine: '#8A4A4A',
};

/**
 * Chart mark colours per execution source — validated with the dataviz palette validator
 * (lightness band, CVD ΔE ≥ 12, normal-vision ΔE ≥ 15, ≥3:1 vs surface) in both modes.
 * Deterministic is deliberately neutral ("no AI"), so it is always paired with labels.
 */
export const chartColors = {
  light: { on_device: '#178A4F', cloud: '#3672D6', deterministic: '#8C948E' },
  dark: { on_device: '#2A9A63', cloud: '#4A84DE', deterministic: '#737D75' },
} as const;

/** 4px spacing scale (docs/02 §7.1). */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96 } as const;

export const radius = { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 } as const;

/** Type scale (docs/02 §6.3). `display` font is for expressive headlines only. */
export const fontFamilies = {
  ui: 'Inter',
  uiMedium: 'Inter_500Medium',
  uiSemibold: 'Inter_600SemiBold',
  uiBold: 'Inter_700Bold',
  display: 'Fraunces',
  displayRegular: 'Fraunces_400Regular',
  mono: 'monospace',
} as const;

export const typeScale = {
  hero: { size: 64, line: 68, weight: '600' },
  display: { size: 40, line: 46, weight: '600' },
  h1: { size: 32, line: 38, weight: '600' },
  h2: { size: 26, line: 32, weight: '600' },
  h3: { size: 22, line: 28, weight: '600' },
  h4: { size: 18, line: 24, weight: '600' },
  bodyLarge: { size: 17, line: 26, weight: '400' },
  body: { size: 15, line: 22, weight: '400' },
  bodySmall: { size: 13, line: 19, weight: '400' },
  caption: { size: 12, line: 16, weight: '500' },
} as const;
export type TypeVariant = keyof typeof typeScale;

/** Motion (docs/02 §13.2) — ms. Always gate on reduced motion. */
export const motion = {
  hover: 120,
  press: 100,
  small: 180,
  dialog: 220,
  page: 240,
  easing: { standard: [0.2, 0, 0, 1], emphasized: [0.3, 0, 0, 1], exit: [0.4, 0, 1, 1] },
  /** Strong ease-out for entering UI (CSS / GSAP-compatible string). */
  easeOutCss: 'cubic-bezier(0.23, 1, 0.32, 1)',
  /** Bottom-sheet curve. */
  drawerCss: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const;

export const breakpoints = { tablet: 640, desktop: 1024, wide: 1440 } as const;

export const layout = { workspaceMax: 1440, readingMax: 900, formMax: 720, dialogMax: 480, touchTarget: 48 } as const;

const SHADOW = '#161A3D';
export const elevation = {
  0: { shadowOpacity: 0 },
  1: { shadowColor: SHADOW, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  2: { shadowColor: SHADOW, shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  3: { shadowColor: SHADOW, shadowOpacity: 0.16, shadowRadius: 32, shadowOffset: { width: 0, height: 16 }, elevation: 8 },
} as const;
