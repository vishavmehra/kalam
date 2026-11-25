import Svg, { Path } from 'react-native-svg';

import { useKalamTheme } from './theme';

/**
 * Hand-drawn ink underline — Kalam's one decorative device. Use it only where it carries
 * meaning (the current destination in navigation). Purely decorative for assistive tech.
 */
export function InkUnderline({ width = 40, color, thickness = 3 }: { width?: number; color?: string; thickness?: number }) {
  const theme = useKalamTheme();
  return (
    <Svg width={width} height={8} viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden>
      <Path
        d="M3 8.6C22 5.4 46 4.4 68 5.6S106 7.9 117 4.2"
        stroke={color ?? theme.colors.accent}
        strokeWidth={thickness}
        strokeLinecap="round"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </Svg>
  );
}
