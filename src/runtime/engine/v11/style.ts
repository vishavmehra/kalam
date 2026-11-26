/**
 * Per-component style (KalamSpec 1.1). A style never carries a colour or CSS: it picks a size, an
 * emphasis and a tone, and this file turns those into a theme for that one component. Tones come
 * from the app's resolved palette and are contrast-guarded the same way resolveAppTheme does it.
 */
import type { KalamComponentStyle, StyleTone } from '@/core/spec/schema';
import { contrastRatio, ensureContrast, mix, type RuntimeTheme } from '../theme';

const SIZE_SCALE = { small: 0.875, medium: 1, large: 1.2 } as const;
/** Fixed warning hue, guarded like resolveAppTheme's danger and success. */
const WARNING = '#8A5A00';

function toneColor(t: RuntimeTheme, tone: StyleTone): string {
  switch (tone) {
    case 'primary': return t.colors.primary;
    case 'secondary': return t.colors.secondary;
    case 'success': return t.colors.success;
    case 'danger': return t.colors.danger;
    case 'warning': return ensureContrast(WARNING, t.colors.surface);
    case 'neutral': return t.colors.text;
  }
}

const onColor = (bg: string) => (contrastRatio('#FFFFFF', bg) >= contrastRatio('#111111', bg) ? '#FFFFFF' : '#111111');

/** Components that are only words: a tone colours their text (others keep body text and colour their accents). */
const TEXT_ONLY: ReadonlySet<string> = new Set(['text', 'heading']);

/**
 * Theme for one component. Returns `t` itself when there is nothing to change, so memoised
 * children do not re-render. Size never shrinks touch targets; High Contrast keeps 7:1.
 * Pass the component `kind` so a tone on a text or heading colours the words themselves.
 */
export function componentTheme<T extends RuntimeTheme>(t: T, style: KalamComponentStyle | undefined, kind?: string): T {
  if (!style || (!style.size && !style.tone && !style.emphasis)) return t;
  let colors = t.colors;
  if (style.tone && style.tone !== 'primary') {
    const min = t.highContrast ? 7 : 4.5;
    const fill = ensureContrast(toneColor(t, style.tone), '#FFFFFF', t.highContrast ? 7 : 3);
    const onFill = onColor(fill);
    colors = {
      ...colors,
      primary: contrastRatio(onFill, fill) >= 4.5 ? fill : ensureContrast(fill, '#FFFFFF'),
      onPrimary: contrastRatio(onFill, fill) >= 4.5 ? onFill : '#FFFFFF',
      primaryText: ensureContrast(ensureContrast(fill, colors.background, min), colors.surface, min),
      primarySoft: t.highContrast ? colors.primarySoft : mix(colors.surface, fill, 0.12),
      focus: ensureContrast(fill, colors.background, 3),
    };
  }
  // primaryText is already guarded against background and surface (4.5:1, 7:1 in High Contrast).
  if (style.tone && style.tone !== 'neutral' && kind && TEXT_ONLY.has(kind)) colors = { ...colors, text: colors.primaryText };
  if (style.emphasis === 'subtle') colors = { ...colors, text: colors.textMuted };
  const strong = style.emphasis === 'strong';
  if (strong) colors = { ...colors, border: colors.primaryText };
  const scale = (style.size ? SIZE_SCALE[style.size] : 1) * (strong ? 1.06 : 1);
  return {
    ...t,
    colors,
    fontScale: t.fontScale * scale,
    borderWidth: strong ? t.borderWidth + 1 : t.borderWidth,
  };
}

/** Where the component sits in its row: plain values for a wrapper's style, or undefined for none. */
export function frameLayout(style: KalamComponentStyle | undefined): { alignSelf: 'flex-start' | 'center' | 'flex-end' | 'stretch'; width?: '100%' } | undefined {
  if (!style) return undefined;
  if (style.fullWidth) return { alignSelf: 'stretch', width: '100%' };
  switch (style.align) {
    case 'start': return { alignSelf: 'flex-start' };
    case 'center': return { alignSelf: 'center' };
    case 'end': return { alignSelf: 'flex-end' };
    default: return undefined;
  }
}
