import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { Text } from './Text';
import { useKalamTheme } from './theme';
import { iconColors } from './tokens';

/**
 * The broad-nib "K" of the app icon (assets/images/src/kalam-mark.svg). The icon keeps it until it is redrawn
 * as the seal; brand-assets.test.ts holds these paths to the master SVG.
 */
export const LOGO_PATHS = {
  stem: 'M8.6 9.4C10.6 8.6 12.6 8 14.6 7.6C14.3 18 14.2 29 14.2 39.2C12.2 39.8 10.2 40.2 8.2 40.6C8.5 30 8.6 20 8.6 9.4Z',
  arm: 'M14.6 26.4C20 20.5 25.5 14.5 31.2 8.6',
  leg: 'M14.4 24.6C19.6 29.6 24.8 34.8 29.2 40.6L34.8 39.6C29.6 33.4 23.8 27.4 17.4 21.6Z',
  dot: { cx: 39, cy: 38.6, r: 2.6 },
} as const;

/** The sindoor seal with a paper nib (DIRECTION §10 A4 and the comp's `#seal`), on a 48 unit box. */
export const SEAL_PATHS = {
  nib: 'M17.2 12.5h13.6l3.2 6.4c0 6.2-4 12.4-10 18.6-6-6.2-10-12.4-10-18.6z',
  slit: 'M24 24.2v13.1',
  shoulder: 'M17.6 16.6h12.8',
} as const;

export interface LogoProps {
  /** Seal height in px. Default 32. */
  size?: number;
  /** Show the "Kalam कलम" wordmark next to the seal. Default true. */
  wordmark?: boolean;
  /** Hide the small Devanagari "कलम" (phones). */
  compact?: boolean;
  /** `mark` = the seal alone; `tile` = the seal on an ink square (app-icon style). */
  variant?: 'mark' | 'tile';
}

/** The seal: a sindoor ring and disc with a paper nib. */
export function Seal({ size = 32, tile }: { size?: number; tile?: boolean }) {
  const theme = useKalamTheme();
  const red = theme.colors.mark;
  const paper = theme.colors.surface;
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      {tile ? <Rect x={0} y={0} width={48} height={48} rx={12} fill={iconColors.ink} /> : null}
      <Circle cx={24} cy={24} r={22.5} fill="none" stroke={red} strokeWidth={2} />
      <Circle cx={24} cy={24} r={19} fill={red} />
      <Path d={SEAL_PATHS.nib} fill={paper} />
      <Path d={SEAL_PATHS.slit} stroke={red} strokeWidth={1.7} strokeLinecap="round" />
      <Circle cx={24} cy={22.2} r={2.1} fill={red} />
      <Path d={SEAL_PATHS.shoulder} stroke={red} strokeWidth={1.3} />
    </Svg>
  );
}

/** The Kalam logo. Decorative when the wordmark is shown; otherwise labelled "Kalam". */
export function Logo({ size = 32, wordmark = true, compact, variant = 'mark' }: LogoProps) {
  const theme = useKalamTheme();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.32 }}
      accessible={!wordmark}
      role={wordmark ? undefined : 'img'}
      accessibilityLabel={wordmark ? undefined : 'Kalam'}
    >
      <Seal size={size} tile={variant === 'tile'} />
      {wordmark ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text display style={{ fontSize: Math.round(size * 0.76), lineHeight: Math.round(size * 0.98), letterSpacing: -0.4, color: theme.colors.text }}>
            Kalam
          </Text>
          {compact ? null : (
            <Text display {...({ lang: 'hi' } as object)} aria-hidden style={{ fontSize: Math.round(size * 0.45), lineHeight: Math.round(size * 0.7), color: theme.colors.textMuted }}>
              कलम
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}
