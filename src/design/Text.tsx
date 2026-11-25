import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useKalamTheme } from './theme';
import type { KalamColors, TypeVariant } from './tokens';
import { typeScale } from './tokens';
import { type FontWeightName, fontFamily } from './typography';

export type TextTone =
  | 'default' | 'secondary' | 'muted' | 'primary' | 'accent' | 'danger' | 'success' | 'warning' | 'info' | 'onPrimary';

export interface TextProps extends RNTextProps {
  /** Type-scale step (docs/02 §6.3). Default `body`. `hero`/`display`/`h1` use Fraunces. */
  variant?: TypeVariant;
  /** Weight; defaults to the variant's weight. */
  weight?: FontWeightName;
  /** Semantic colour. Default `default` (ink). */
  tone?: TextTone;
  /** Override the display face choice (Fraunces). */
  display?: boolean;
  align?: TextStyle['textAlign'];
  /** Tabular numerals for figures that update or align in columns. */
  numeric?: boolean;
}

const DISPLAY_VARIANTS: ReadonlySet<TypeVariant> = new Set(['hero', 'display', 'h1']);
const HEADING_LEVEL: Partial<Record<TypeVariant, number>> = { hero: 1, display: 1, h1: 1, h2: 2, h3: 3, h4: 4 };

const TONE: Record<TextTone, keyof KalamColors> = {
  default: 'text', secondary: 'textSecondary', muted: 'textMuted', primary: 'primary', accent: 'accentInk',
  danger: 'danger', success: 'success', warning: 'warning', info: 'info', onPrimary: 'onPrimary',
};

/**
 * Kalam text. Headings (`hero`–`h4`) are exposed to assistive tech as headings with a level.
 * Sizes scale with the Large access mode.
 */
export function Text({ variant = 'body', weight, tone = 'default', display, align, numeric, style, ...rest }: TextProps) {
  const theme = useKalamTheme();
  const step = typeScale[variant];
  const useDisplay = display ?? DISPLAY_VARIANTS.has(variant);
  const w: FontWeightName = weight ?? (step.weight === '600' ? 'semibold' : variant === 'caption' ? 'medium' : 'regular');
  const size = Math.round(step.size * theme.fontScale);
  const level = HEADING_LEVEL[variant];
  return (
    <RNText
      role={level ? 'heading' : undefined}
      aria-level={level}
      style={[
        {
          fontFamily: fontFamily(w, useDisplay, theme.script),
          fontSize: size,
          lineHeight: Math.round(step.line * theme.fontScale),
          color: theme.colors[TONE[tone]],
          letterSpacing: useDisplay ? -0.02 * size : variant === 'caption' ? 0.1 : 0,
          textAlign: align,
          fontVariant: numeric ? ['tabular-nums'] : undefined,
        },
        style,
      ]}
      {...rest}
    />
  );
}
