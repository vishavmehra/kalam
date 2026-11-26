/**
 * Kalam shell design tokens. These style the Kalam shell only: generated apps use their own KalamSpec
 * theme. Never hardcode colours in components; read them from `useKalamTheme()` (src/design/theme.tsx).
 *
 * Direction "Charcoal and Saffron" (owner, 2026-11-26), replacing "Khata and Kalam" (royal ink, sindoor, haldi):
 * warm paper by day (Paper) and a charcoal evening by night (Ink night). Charcoal owns the large "field"
 * regions, saffron is the one brand voice (links, selection, actions, the pen mark), marigold is the
 * highlight, and stamps carry honesty about where AI ran. Every pairing below is checked in tokens.test.ts
 * against WCAG 2.2 (4.5:1 text, 3:1 non-text, High Contrast 7:1).
 *
 * Saffron comes in two strengths because white on the brand saffron #E2583E is only 3.7:1. Anything that
 * carries text (button fills, links, selected labels) uses the deep saffron `royal` (#B8432C, 5.4:1 with
 * white). The bright saffron-coral (`sindoor`, exposed as `mark`) is for marks, underlines, large fills and
 * the icon, where 3:1 is enough. Muted text is #6A645E rather than the stone-500 #78716C asked for: that
 * measures 4.49:1 on the Paper canvas and 3.9:1 on slips.
 *
 * The `KalamColors` key names and the `palette` keys below predate this direction and are kept so every
 * screen recolours without edits. Read them as: `royal` = deep saffron (primary), `sindoor` = bright saffron
 * (pen mark, focus), `haldi` = marigold (accent), `field` = charcoal, `carbon` slips = warm stone.
 */
export const palette = {
  paper: {
    canvas: '#FAF7F2', sheet: '#FFFFFF', sunk: '#F1ECE3', raised: '#FFFFFF',
    ink: '#1C1917', ink2: '#44403C', ink3: '#6A645E', rule: '#E8E1D6', ruleStrong: '#8A837B',
    royal: '#B8432C', royalPress: '#9A3622', royalWash: '#FCEEE8',
    field: '#1C1917', fieldDeep: '#0E0C0B', onField2: '#D9D2C8',
    sindoor: '#E2583E', sindoorInk: '#A63A25', sindoorWash: '#FCEBE5',
    haldi: '#F2A541', haldiInk: '#8A5200', haldiWash: '#FCEFD8',
    leaf: '#1C6E43', leafWash: '#E4EFE5', sky: '#0A6E87', skyWash: '#DEEFF3',
    violet: '#5B3BB5', violetWash: '#ECE8F6', graphite: '#57534E', graphiteWash: '#ECE8E2',
    danger: '#A5173A', dangerWash: '#FBE7EB',
  },
  ink: {
    canvas: '#121110', sheet: '#1C1A18', sunk: '#0C0B0A', raised: '#252220',
    ink: '#F5F1EA', ink2: '#CFC8BD', ink3: '#A39C92', rule: '#2E2A26',
    ruleStrong: '#7D756D',
    royal: '#F06A4F', royalPress: '#F68B73', royalWash: '#3A1E18',
    field: '#1C1A18', fieldDeep: '#0A0908', onField2: '#C9C1B5',
    sindoor: '#F06A4F', sindoorInk: '#F06A4F', sindoorWash: '#3A1E18',
    haldi: '#F2A541', haldiInk: '#F7B955', haldiWash: '#33271A',
    leaf: '#6ED6A0', leafWash: '#17291F', sky: '#5FCBE4', skyWash: '#10303A',
    violet: '#B6A3FF', violetWash: '#2A2350', graphite: '#B3ABA0', graphiteWash: '#2A2622',
    danger: '#FF7D93', dangerWash: '#3B1420',
  },
  /**
   * Colours kept apart from the shell. `brand` is the retired "Ink and Marigold" set: the Drawing Studio
   * must not draw with any of it (features/drawing/model/constants.test.ts). `pen` is the blue ballpoint of
   * the pen list, a content colour people draw with, not shell UI.
   */
  brand: {
    ink: '#283080', inkPressed: '#1C2363', inkSoft: '#E6E8F5', inkText: '#161A3D',
    marigold: '#F2AE1C', marigoldSoft: '#FCEBC2', marigoldInk: '#8A5300', paper: '#F7F7F4', rule: '#D9DDEE', margin: '#EBA3A0',
  },
  pen: { blue: '#2B3FBF', blueWash: '#E6E9F8' },
  neutral: { 0: '#FFFFFF', 50: '#FAF7F2', 100: '#F1ECE3', 200: '#E4DDD1', 300: '#8A837B', 500: '#6A645E', 700: '#44403C', 900: '#1C1917' },
  semantic: {
    success: '#1C6E43', successSoft: '#E4EFE5', warning: '#8A5200', warningSoft: '#FCEFD8',
    danger: '#A5173A', dangerSoft: '#FBE7EB', info: '#0A6E87', infoSoft: '#DEEFF3',
  },
} as const;

export interface KalamColors {
  /** Ledger paper (canvas). */
  background: string;
  /** Cards, sheets, windows. */
  surface: string;
  /** Pressed, wells, shelf plank (sunk). */
  surfaceAlt: string;
  /** Inputs, composer, dialogs (raised). */
  surfaceElevated: string;
  paper: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  /** Decorative hairlines only. */
  border: string;
  /** Input and control boundaries (3:1). */
  borderStrong: string;
  /** Royal ink: links, selection, selected states. */
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  onPrimary: string;
  /** Haldi highlight fill. Pair with `text`; never as text on the background. */
  accent: string;
  accentSoft: string;
  /** Text and icons on the haldi fill: always dark ink, in both themes. */
  onAccent: string;
  /** Accent hue that passes 4.5:1 as text/icons on background and surfaces (haldi ink). */
  accentInk: string;
  success: string; successSoft: string;
  warning: string; warningSoft: string;
  danger: string; dangerSoft: string;
  info: string; infoSoft: string;
  /** Execution-source colours (stamps): leaf, sky, graphite. Offline is graphite, never a warning. */
  sourceOnDevice: string;
  sourceCloud: string;
  sourceDeterministic: string;
  sourceOffline: string;
  /** Sindoor: 2.5 px ring with 3 px offset. */
  focusRing: string;
  scrim: string;
  /** Decorative rule. Kept for older screens; the margin rule itself is gone (owner, 2026-11-25). */
  ruleLine: string;
  marginLine: string;
  /** The royal ink field and its pooled edge, with text on it. */
  field: string;
  fieldDeep: string;
  onField: string;
  onField2: string;
  /** Sindoor pen mark: red-pen underline, ledger total rule, focus. Never a status or a fill. */
  mark: string;
  /** Sindoor dark enough for order-book numbering text on tinted slips. */
  markInk: string;
  markWash: string;
  /** Primary action: royal on paper, a paper slip on ink night. */
  actionBg: string;
  actionBgPressed: string;
  actionFg: string;
  /** Stamp-pad violet (Checked) and graphite (Template, neutral). */
  violet: string; violetSoft: string;
  graphite: string; graphiteSoft: string;
  /** rgb triplet for tinted shadows, e.g. `rgb(${shadowRgb} / .4)`. */
  shadowRgb: string;
}

/** Ink and wash of one stamp. */
export interface StampInk { ink: string; wash: string }
export type StampKind = 'template' | 'device' | 'cloud' | 'checked' | 'needs' | 'plain';
export type StampColors = Record<StampKind, StampInk>;
/** Per-role slip tints (order-book carbon copies). */
export type TintKind = 'kraft' | 'carbon' | 'leaf' | 'violet' | 'haldi';
export type TintColors = Record<TintKind, string>;
/** Register cloths: app covers. Fixed objects, the same in both themes. */
export type ClothKind = 'green' | 'lal' | 'neel' | 'kraft' | 'haldi' | 'ocean';
export interface Cloth { cloth: string; fg: string }

function colors(p: typeof palette.paper | typeof palette.ink, dark: boolean): KalamColors {
  return {
    background: p.canvas,
    surface: p.sheet,
    surfaceAlt: p.sunk,
    surfaceElevated: p.raised,
    paper: p.sheet,
    text: p.ink,
    textSecondary: p.ink2,
    textMuted: p.ink3,
    border: p.rule,
    borderStrong: p.ruleStrong,
    primary: p.royal,
    primaryPressed: p.royalPress,
    primarySoft: p.royalWash,
    onPrimary: dark ? '#1C1917' : '#FFFFFF',
    accent: p.haldi,
    accentSoft: p.haldiWash,
    onAccent: '#1C1917',
    accentInk: p.haldiInk,
    success: p.leaf, successSoft: p.leafWash,
    warning: p.haldiInk, warningSoft: p.haldiWash,
    danger: p.danger, dangerSoft: p.dangerWash,
    info: p.sky, infoSoft: p.skyWash,
    sourceOnDevice: p.leaf,
    sourceCloud: p.sky,
    sourceDeterministic: p.graphite,
    sourceOffline: p.graphite,
    focusRing: p.royal,
    scrim: dark ? 'rgba(0,0,0,0.66)' : 'rgba(28,25,23,0.44)',
    ruleLine: p.rule,
    marginLine: p.sindoor,
    field: p.field,
    fieldDeep: p.fieldDeep,
    onField: dark ? '#F5F1EA' : '#FAF7F2',
    onField2: p.onField2,
    mark: p.sindoor,
    markInk: p.sindoorInk,
    markWash: p.sindoorWash,
    // Deep saffron with white text on Paper; bright saffron with charcoal text on Ink night (white would be 3:1).
    actionBg: p.royal,
    actionBgPressed: p.royalPress,
    actionFg: dark ? '#1C1917' : '#FFFFFF',
    violet: p.violet, violetSoft: p.violetWash,
    graphite: p.graphite, graphiteSoft: p.graphiteWash,
    shadowRgb: dark ? '0 0 0' : '28 25 23',
  };
}

/** Paper: warm paper at noon, charcoal ink, saffron for the one thing to press. */
export const lightColors: KalamColors = colors(palette.paper, false);

/** Ink night: warm charcoal, never blue and never pure black; saffron lifts to a lighter coral. */
export const darkColors: KalamColors = colors(palette.ink, true);

/** High Contrast access mode (docs/10 §4.2), re-derived from the same hues and measured at 7:1 or more. */
export const highContrastLightColors: KalamColors = {
  ...lightColors,
  background: '#FFFFFF', surface: '#FFFFFF', surfaceAlt: '#F5F1EA', surfaceElevated: '#FFFFFF', paper: '#FFFFFF',
  text: '#000000', textSecondary: '#1C1917', textMuted: '#292524',
  border: '#1C1917', borderStrong: '#1C1917',
  primary: '#8A2C1A', primaryPressed: '#6E2012', primarySoft: '#FCEEE8', onPrimary: '#FFFFFF',
  accentInk: '#5E3B00',
  success: '#0E5232', warning: '#5E3B00', danger: '#7F1034', info: '#064A5C',
  sourceOnDevice: '#0E5232', sourceCloud: '#064A5C', sourceDeterministic: '#292524', sourceOffline: '#292524',
  focusRing: '#8A2C1A', ruleLine: '#BDB6AD', marginLine: '#8A2C1A',
  field: '#1C1917', fieldDeep: '#000000', onField: '#FFFFFF', onField2: '#EDE8E0',
  mark: '#8A2C1A', markInk: '#8A2C1A',
  actionBg: '#8A2C1A', actionBgPressed: '#6E2012', actionFg: '#FFFFFF',
  violet: '#3F2390', graphite: '#292524',
};

export const highContrastDarkColors: KalamColors = {
  ...darkColors,
  background: '#000000', surface: '#000000', surfaceAlt: '#1C1917', surfaceElevated: '#1C1917', paper: '#000000',
  text: '#FFFFFF', textSecondary: '#F5F1EA', textMuted: '#E0D9CE',
  border: '#FFFFFF', borderStrong: '#FFFFFF',
  primary: '#FF9A85', primaryPressed: '#FFC0B3', primarySoft: '#2E1710', onPrimary: '#000000',
  accent: '#FFC15A', accentSoft: '#2A200C', accentInk: '#FFC15A', onAccent: '#000000',
  success: '#9FEBC2', successSoft: '#0C2A1A', warning: '#FFC15A', warningSoft: '#2A200C',
  danger: '#FFB3C0', dangerSoft: '#2E1018', info: '#A6E6F5', infoSoft: '#0A2630',
  sourceOnDevice: '#9FEBC2', sourceCloud: '#A6E6F5', sourceDeterministic: '#F5F1EA', sourceOffline: '#F5F1EA',
  focusRing: '#FFB09E', ruleLine: '#44403C', marginLine: '#FFB09E',
  onField: '#FFFFFF', onField2: '#F0EAE0',
  mark: '#FF9A85', markInk: '#FF9A85', markWash: '#2E1710',
  actionBg: '#FFFFFF', actionBgPressed: '#E7E2DA', actionFg: '#000000',
  violet: '#D3C8FF', violetSoft: '#1E1850', graphite: '#E0D9CE', graphiteSoft: '#26221F',
};

/** Stamps from a colour set: Template graphite, On device leaf, Cloud sky, Checked violet, Needs check haldi ink. */
export function stampColors(c: KalamColors): StampColors {
  return {
    template: { ink: c.graphite, wash: c.graphiteSoft },
    device: { ink: c.sourceOnDevice, wash: c.successSoft },
    cloud: { ink: c.sourceCloud, wash: c.infoSoft },
    checked: { ink: c.violet, wash: c.violetSoft },
    needs: { ink: c.warning, wash: c.warningSoft },
    plain: { ink: c.textSecondary, wash: c.surface },
  };
}

export const lightTints: TintColors = { kraft: '#F1E8D8', carbon: '#EDE9E3', leaf: '#E4EEE5', violet: '#ECE8F4', haldi: '#FBEDD2' };
export const darkTints: TintColors = { kraft: '#2B241B', carbon: '#262220', leaf: '#17291F', violet: '#241F38', haldi: '#30271A' };

/** Register cloths match the KalamSpec theme hues. Names always sit on the white label (`clothLabel`). */
export const cloths: Record<ClothKind, Cloth> = {
  green: { cloth: '#2F6B4F', fg: '#EBEBEB' },
  lal: { cloth: '#A3231E', fg: '#EBEBEB' },
  neel: { cloth: '#283A8F', fg: '#EBEBEB' },
  kraft: { cloth: '#A87B4A', fg: '#1A1406' },
  haldi: { cloth: '#C9901A', fg: '#1A1406' },
  ocean: { cloth: '#246C8C', fg: '#EBEBEB' },
};
export const clothLabel = { bg: '#FFFDF9', fg: '#1C1917', muted: '#57534E' } as const;

/**
 * Chart mark colours per execution source, validated with the dataviz palette validator (lightness
 * band, CVD ΔE ≥ 12, normal-vision ΔE ≥ 15, ≥3:1 vs surface) in both modes. Kept from the previous
 * direction: green and teal stamps would be too close for a chart, and a red-orange mark would collide with
 * green under red-green colour blindness, so cloud stays blue. Deterministic is warm neutral ("no AI").
 */
export const chartColors = {
  light: { on_device: '#178A4F', cloud: '#3672D6', deterministic: '#8A837B' },
  dark: { on_device: '#2A9A63', cloud: '#4A84DE', deterministic: '#7D756D' },
} as const;

/**
 * App icon, splash and install colours (assets/images, app.json, the PWA manifest). The tile is charcoal
 * (`ink`), the K is white and the full stop is the bright saffron-coral (`marigold` keeps its old key name);
 * brand-assets.test.ts holds the rasters to these values. `paper` and `dark.splash` are what shows before the
 * shell paints (splash, install screen, theme colour), so they are the Paper canvas and the Ink night canvas.
 * `dark.background` is the dark iOS icon tile; `dark.primary` is the K and `dark.accent` the full stop on it.
 * Never use them for shell UI.
 */
export const iconColors = {
  ink: '#1C1917', inkText: '#1C1917', marigold: '#E2583E', paper: '#FAF7F2',
  dark: { background: '#1C1A18', splash: '#121110', primary: '#F5F1EA', accent: '#F06A4F' },
} as const;

/** 4px spacing scale. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96 } as const;

/**
 * Shape: paper objects 4 to 8 px, things you press 10 to 12 px, stamps 6 px. Nothing is a pill except
 * switches (`pill`). `sm`/`md`/`lg`/`xl` are the older names every screen already uses.
 */
export const radius = { sm: 6, md: 12, lg: 8, xl: 16, pill: 999, paper: 6, press: 12, stamp: 6 } as const;

/**
 * Families registered by `design/typography.ts` (each weight is its own family). Display is Tiro, body
 * Anek, handwriting Kalam (only for things that really are handwritten), numbering Courier Prime.
 */
export const fontFamilies = {
  ui: 'AnekLatin_400Regular',
  uiMedium: 'AnekLatin_500Medium',
  uiSemibold: 'AnekLatin_600SemiBold',
  uiBold: 'AnekLatin_700Bold',
  /** Money and big numbers: Anek at semi-expanded width, bold, tabular. */
  money: 'AnekLatin_700Wide',
  display: 'TiroDevanagariHindi_400Regular',
  displayRegular: 'TiroDevanagariHindi_400Regular',
  hand: 'Kalam_400Regular',
  handBold: 'Kalam_700Bold',
  mono: 'CourierPrime_700Bold',
} as const;

/** Type scale in px (DIRECTION §3, desktop). `typeScalePhone` overrides the display steps below 640 px. */
export const typeScale = {
  hero: { size: 66, line: 68, weight: '400' },
  display: { size: 52, line: 54, weight: '400' },
  h1: { size: 36, line: 40, weight: '400' },
  h2: { size: 31, line: 34, weight: '400' },
  h3: { size: 24, line: 29, weight: '400' },
  h4: { size: 18, line: 24, weight: '600' },
  bodyLarge: { size: 19.5, line: 30, weight: '400' },
  body: { size: 16, line: 25, weight: '400' },
  bodySmall: { size: 14, line: 20, weight: '400' },
  caption: { size: 13, line: 17, weight: '500' },
} as const;
export type TypeVariant = keyof typeof typeScale;

export const typeScalePhone: Partial<Record<TypeVariant, { size: number; line: number }>> = {
  hero: { size: 43, line: 45 },
  display: { size: 36, line: 38 },
  h1: { size: 30, line: 33 },
  h2: { size: 27, line: 30 },
  h3: { size: 22, line: 27 },
  bodyLarge: { size: 17.5, line: 27 },
  body: { size: 15.5, line: 24 },
};

/** Motion (DIRECTION §5), ms. Always gate on reduced motion. Writing is linear; a stamp lands with an ease-in. */
export const motion = {
  hover: 120,
  press: 120,
  small: 150,
  dialog: 260,
  page: 240,
  bloom: 800,
  stamp: 260,
  easing: { standard: [0.23, 1, 0.32, 1], emphasized: [0.77, 0, 0.175, 1], exit: [0.4, 0, 1, 1] },
  /** Entering UI. */
  easeOutCss: 'cubic-bezier(0.23, 1, 0.32, 1)',
  /** Moving on screen. */
  inOutCss: 'cubic-bezier(0.77, 0, 0.175, 1)',
  /** Bottom-sheet curve. */
  drawerCss: 'cubic-bezier(0.32, 0.72, 0, 1)',
  /** A stamp landing (followed by an 80 ms settle). */
  stampCss: 'cubic-bezier(0.55, 0.055, 0.675, 0.19)',
} as const;

export const breakpoints = { tablet: 640, desktop: 1024, wide: 1440 } as const;

export const layout = { workspaceMax: 1440, readingMax: 900, formMax: 720, dialogMax: 480, touchTarget: 48 } as const;

const SHADOW = '#1C1917';
/** Shadows are tinted to the charcoal and always have a y-offset. No glows. */
export const elevation = {
  0: { shadowOpacity: 0 },
  1: { shadowColor: SHADOW, shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  2: { shadowColor: SHADOW, shadowOpacity: 0.14, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  3: { shadowColor: SHADOW, shadowOpacity: 0.22, shadowRadius: 34, shadowOffset: { width: 0, height: 20 }, elevation: 8 },
} as const;
