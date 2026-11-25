/**
 * Generated-app theme → concrete style tokens, with a contrast guard and the Access Mode overlay
 * (docs/02 §12, docs/10 §4). The KalamSpec theme is never modified: modes are applied on top.
 */
import type { AccessModes } from '@/core/contracts';
import type { KalamComponent, KalamScreen, KalamTheme } from '@/core/spec/schema';
import { THEME_PRESET_TOKENS } from '@/core/templates/themes';

// ─── Colour maths (WCAG 2.x relative luminance) ──────────────────────────────
function rgb(hex: string): [number, number, number] {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '000000';
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function hex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
export function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Linear blend: amount 0 → a, 1 → b. */
export function mix(a: string, b: string, amount: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex([x[0] + (y[0] - x[0]) * amount, x[1] + (y[1] - x[1]) * amount, x[2] + (y[2] - x[2]) * amount]);
}

/**
 * Returns `fg`, or `fg` moved toward black/white (whichever separates it from `bg`) until the
 * contrast ratio reaches `min`. Keeps the hue as long as possible; falls back to pure black/white.
 */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (contrastRatio(fg, bg) >= min) return fg.toUpperCase();
  const target = contrastRatio('#000000', bg) >= contrastRatio('#FFFFFF', bg) ? '#000000' : '#FFFFFF';
  for (let t = 0.05; t < 1; t += 0.05) {
    const c = mix(fg, target, t);
    if (contrastRatio(c, bg) >= min) return c;
  }
  return target;
}

// ─── Resolved runtime theme ──────────────────────────────────────────────────
export interface RuntimeColors {
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  border: string;
  /** Fill colour for primary buttons (may be darkened so `onPrimary` stays legible). */
  primary: string;
  onPrimary: string;
  /** Primary used as text / icons on the background. */
  primaryText: string;
  primarySoft: string;
  secondary: string;
  danger: string;
  onDanger: string;
  success: string;
  focus: string;
  scrim: string;
}

export interface RuntimeTheme {
  colors: RuntimeColors;
  radius: number;
  /** Multiplier for every font size (theme fontScale × Large Mode). */
  fontScale: number;
  /** Base spacing unit in px. */
  space: number;
  /** Minimum touch target in px. */
  target: number;
  borderWidth: number;
  fontFamily: KalamTheme['fontFamily'];
  /** Left-handed: primary controls move to the leading edge. Never mirrors text or data order. */
  mirror: boolean;
  highContrast: boolean;
}

const SPACING = { compact: 12, comfortable: 16, spacious: 20 } as const;

function onColor(bg: string): string {
  return contrastRatio('#FFFFFF', bg) >= contrastRatio('#111111', bg) ? '#FFFFFF' : '#111111';
}

export function resolveAppTheme(theme: KalamTheme, modes: AccessModes): RuntimeTheme {
  const preset = THEME_PRESET_TOKENS[theme.preset ?? 'calm_green'];
  const large = modes.large;
  const base = {
    radius: theme.radius,
    // Large Mode (docs/10 §4.1, lead decision 4): body text is never below 24 px (1.5x of a 16 px
    // body), even when the app's own theme is set smaller. A bigger app theme grows from there, to 2.2x.
    fontScale: large ? Math.min(2.2, Math.max(1.5, theme.fontScale * 1.5)) : theme.fontScale,
    space: SPACING[theme.spacing ?? 'comfortable'] * (large ? 1.25 : 1),
    // Large Mode targets are 64 px. Voice-only Mode keeps the few controls that remain (microphone,
    // confirm, cancel) at 56 px or more, because the person may have limited fine motor control.
    // With both on, the larger value wins, so Large Mode decides.
    target: Math.max(large ? 64 : 48, modes.voiceOnly === true ? 56 : 0),
    fontFamily: theme.fontFamily,
    mirror: modes.leftHanded,
  };

  if (modes.highContrast) {
    const primary = ensureContrast(theme.primary, '#FFFFFF', 7);
    return {
      ...base,
      borderWidth: 2,
      highContrast: true,
      colors: {
        background: '#FFFFFF', surface: '#FFFFFF', surfaceAlt: '#F2F2F2', text: '#000000', textMuted: '#1F1F1F',
        border: '#000000', primary, onPrimary: '#FFFFFF', primaryText: primary, primarySoft: '#E6E6E6',
        secondary: '#000000', danger: '#8A0000', onDanger: '#FFFFFF', success: '#004D1A', focus: '#000000',
        scrim: 'rgba(0,0,0,0.7)',
      },
    };
  }

  const background = theme.background ?? preset.background ?? '#FFFFFF';
  const surface = theme.surface ?? preset.surface ?? '#FFFFFF';
  // Contrast guard: body text must reach 4.5:1 on both background and surface.
  const text = ensureContrast(ensureContrast(theme.text ?? preset.text ?? '#1B1D1F', background), surface);
  const textMuted = ensureContrast(mix(text, surface, 0.35), surface);

  let primary = theme.primary.toUpperCase();
  let onPrimary = onColor(primary);
  if (contrastRatio(onPrimary, primary) < 4.5) {
    primary = ensureContrast(primary, '#FFFFFF');
    onPrimary = '#FFFFFF';
  }
  const danger = ensureContrast('#B3261E', surface);
  return {
    ...base,
    borderWidth: 1,
    highContrast: false,
    colors: {
      background,
      surface,
      surfaceAlt: mix(surface, text, 0.05),
      text,
      textMuted,
      // Non-text contrast (WCAG 1.4.11): input borders need 3:1 against the surface.
      border: ensureContrast(mix(surface, text, 0.25), surface, 3),
      primary,
      onPrimary,
      primaryText: ensureContrast(ensureContrast(theme.primary, background), surface),
      primarySoft: mix(surface, theme.primary, 0.12),
      secondary: theme.secondary ?? preset.secondary ?? theme.primary,
      danger,
      onDanger: onColor(danger),
      success: ensureContrast('#1E6B3F', surface),
      focus: ensureContrast(theme.primary, background, 3),
      scrim: 'rgba(0,0,0,0.45)',
    },
  };
}

// ─── Access overlay on components ────────────────────────────────────────────
/**
 * Components rendered for this screen: hidden (`visible:false`) never; `secondary: true` hidden in
 * Simple Mode. Strict `=== true`: on lists `secondary` is the second-line *field id*, not this flag.
 */
export function visibleChildren(screen: KalamScreen, modes: AccessModes): KalamComponent[] {
  return screen.children.filter((c) => c.visible !== false && !(modes.simple && c.secondary === true));
}

/** What Read-aloud Mode speaks when a component is focused or tapped. */
export function readAloudText(c: KalamComponent): string | undefined {
  if (c.readAloud) return c.readAloud;
  if (c.a11yLabel) return c.a11yLabel;
  return 'label' in c && c.label ? c.label : undefined;
}
