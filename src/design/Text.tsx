import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useKalamTheme } from './theme';
import type { KalamColors, TypeVariant } from './tokens';
import { typeScale, typeScalePhone } from './tokens';
import { type FontWeightName, fontFamily, moneyFamily, monoFamily } from './typography';

export type TextTone =
  | 'default' | 'secondary' | 'muted' | 'primary' | 'accent' | 'danger' | 'success' | 'warning' | 'info' | 'onPrimary' | 'mark';

export interface TextProps extends RNTextProps {
  /** Type-scale step (DIRECTION §3). Default `body`. `hero` to `h3` use Tiro. */
  variant?: TypeVariant;
  /** Weight; defaults to the variant's weight. Tiro has one weight, so display text ignores it. */
  weight?: FontWeightName;
  /** Semantic colour. Default `default` (ink). `mark` is sindoor, for numbering only. */
  tone?: TextTone;
  /** Override the display face choice (Tiro). */
  display?: boolean;
  align?: TextStyle['textAlign'];
  /** Tabular numerals for figures that update or align in columns. */
  numeric?: boolean;
  /** Courier Prime Bold: order-book numbers, step numerals, stamp dates. */
  mono?: boolean;
  /** Money and big numbers: Anek at semi-expanded width, tabular. */
  money?: boolean;
  /**
   * Heading level for assistive tech when it differs from the visual step, for example a section title drawn as
   * `h3` under the page's `h1` is `level={2}` so the outline never skips. `0` means not a heading.
   */
  level?: number;
}

const DISPLAY_VARIANTS: ReadonlySet<TypeVariant> = new Set(['hero', 'display', 'h1', 'h2', 'h3']);
const HEADING_LEVEL: Partial<Record<TypeVariant, number>> = { hero: 1, display: 1, h1: 1, h2: 2, h3: 3, h4: 4 };

const TONE: Record<TextTone, keyof KalamColors> = {
  default: 'text', secondary: 'textSecondary', muted: 'textMuted', primary: 'primary', accent: 'accentInk',
  danger: 'danger', success: 'success', warning: 'warning', info: 'info', onPrimary: 'onPrimary', mark: 'markInk',
};

/**
 * Kalam text. Headings (`hero` to `h4`) are exposed to assistive tech as headings with a level.
 * Sizes follow the phone scale below 640 px and grow with the Large access mode. Indic display gets more
 * line height and less negative tracking than Latin (never past -0.01em).
 */
export function Text({ variant = 'body', weight, tone = 'default', display, align, numeric, mono, money, level: levelProp, style, ...rest }: TextProps) {
  const theme = useKalamTheme();
  const step = (theme.compact && typeScalePhone[variant]) || typeScale[variant];
  const useDisplay = !mono && !money && (display ?? DISPLAY_VARIANTS.has(variant));
  const w: FontWeightName = weight ?? (typeScale[variant].weight === '600' ? 'semibold' : variant === 'caption' ? 'medium' : 'regular');
  const size = Math.round(step.size * theme.fontScale);
  const indic = theme.script !== 'latin';
  const line = Math.round(step.line * theme.fontScale);
  const level = levelProp === undefined ? HEADING_LEVEL[variant] : levelProp || undefined;
  const family = mono ? monoFamily() : money ? moneyFamily() : fontFamily(w, useDisplay, theme.script);
  return (
    <RNText
      role={level ? 'heading' : undefined}
      aria-level={level}
      style={[
        {
          fontFamily: family,
          fontSize: size,
          lineHeight: useDisplay && indic ? Math.max(line, Math.round(size * 1.22)) : line,
          color: theme.colors[TONE[tone]],
          letterSpacing: useDisplay ? (indic ? -0.005 : -0.018) * size : mono ? 0.03 * size : variant === 'caption' ? 0.01 * size : 0,
          textAlign: align,
          fontVariant: numeric || money ? ['tabular-nums'] : undefined,
        },
        style,
      ]}
      {...rest}
    />
  );
}
