import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { Text } from './Text';
import { useKalamTheme } from './theme';
import { palette } from './tokens';

/**
 * Kalam mark: a broad-nib "K" — thick stem and down-stroke, hairline up-stroke, as a reed pen
 * (qalam) writes it — closed with a marigold full stop ("own it forever"). Paths are shared with
 * assets/brand/logo.svg.
 */
export const LOGO_PATHS = {
  stem: 'M8.6 9.4C10.6 8.6 12.6 8 14.6 7.6C14.3 18 14.2 29 14.2 39.2C12.2 39.8 10.2 40.2 8.2 40.6C8.5 30 8.6 20 8.6 9.4Z',
  arm: 'M14.6 26.4C20 20.5 25.5 14.5 31.2 8.6',
  leg: 'M14.4 24.6C19.6 29.6 24.8 34.8 29.2 40.6L34.8 39.6C29.6 33.4 23.8 27.4 17.4 21.6Z',
  dot: { cx: 39, cy: 38.6, r: 2.6 },
} as const;

export interface LogoProps {
  /** Mark height in px. Default 32. */
  size?: number;
  /** Show the "Kalam" wordmark next to the mark. Default true. */
  wordmark?: boolean;
  /** `mark` = ink on transparent; `tile` = paper on an ink square (app-icon style). */
  variant?: 'mark' | 'tile';
}

/** The Kalam logo. Decorative when the wordmark is shown; otherwise labelled "Kalam". */
export function Logo({ size = 32, wordmark = true, variant = 'mark' }: LogoProps) {
  const theme = useKalamTheme();
  const tile = variant === 'tile';
  const ink = tile ? '#FFFFFF' : theme.colors.primary;
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.28 }}
      accessible={!wordmark}
      role={wordmark ? undefined : 'img'}
      accessibilityLabel={wordmark ? undefined : 'Kalam'}
    >
      <Svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
        {tile ? <Rect x={0} y={0} width={48} height={48} rx={12} fill={palette.brand.ink} /> : null}
        <Path d={LOGO_PATHS.stem} fill={ink} />
        <Path d={LOGO_PATHS.arm} stroke={ink} strokeWidth={2.4} strokeLinecap="round" fill="none" />
        <Path d={LOGO_PATHS.leg} fill={ink} />
        <Circle {...LOGO_PATHS.dot} fill={tile ? palette.brand.marigold : theme.colors.accent} />
      </Svg>
      {wordmark ? (
        <Text display weight="semibold" style={{ fontSize: Math.round(size * 0.72), lineHeight: Math.round(size * 0.9), letterSpacing: -0.4 }}>
          Kalam
        </Text>
      ) : null}
    </View>
  );
}
