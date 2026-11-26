import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useKalamTheme } from './theme';

/**
 * The red-pen underline a teacher draws while checking (DIRECTION §1). Marks the current destination in the
 * navigation and the field Kalam read. Sindoor by default; it never carries status. Decorative.
 */
export function InkUnderline({ width = 40, color, thickness = 2.4 }: { width?: number; color?: string; thickness?: number }) {
  const theme = useKalamTheme();
  return (
    <Svg width={width} height={8} viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden>
      <Path
        d="M3 8.6C22 5.4 46 4.4 68 5.6S106 7.9 117 4.2"
        stroke={color ?? theme.colors.mark}
        strokeWidth={thickness}
        strokeLinecap="round"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </Svg>
  );
}

/** Alias with the direction's name for it. */
export const RedPenUnderline = InkUnderline;

/**
 * The ledger total rule: a 72 px sindoor double underline under a section heading, the way accounts mark a
 * total. The only decoration headings get (DIRECTION §7).
 */
export function LedgerRule({ width = 72 }: { width?: number }) {
  const theme = useKalamTheme();
  return (
    <View
      aria-hidden
      pointerEvents="none"
      style={{ width, height: 5, borderTopWidth: 1.5, borderBottomWidth: 1.5, borderColor: theme.colors.mark, marginTop: 10 }}
    />
  );
}
