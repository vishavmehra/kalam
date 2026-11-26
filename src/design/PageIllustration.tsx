import Svg, { Line, Path, Rect } from 'react-native-svg';

import { useKalamTheme } from './theme';

/**
 * A blank ledger page with a folded corner and a pen loop (no margin rule: owner, 2026-11-25): Kalam's illustration for "nothing
 * here" states (404, empty lists). Decorative; pair it with a heading that says what happened.
 */
export function PageIllustration({ width = 132 }: { width?: number }) {
  const { colors } = useKalamTheme();
  const h = width * 1.24;
  return (
    <Svg width={width} height={h} viewBox="0 0 132 164" aria-hidden>
      <Path d="M10 6h88l26 26v124a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V12a6 6 0 0 1 6-6Z" fill={colors.paper} stroke={colors.border} strokeWidth={1.5} />
      {[40, 56, 72, 88, 104, 120, 136].map((y) => (
        <Line key={y} x1={8} x2={120} y1={y} y2={y} stroke={colors.ruleLine} strokeWidth={1.2} />
      ))}
      <Path d="M98 6v20a6 6 0 0 0 6 6h20" fill={colors.surfaceAlt} stroke={colors.border} strokeWidth={1.5} />
      <Path
        d="M46 78c4-12 22-14 26-3 3 9-9 13-11 21-1 4 0 7 2 9"
        fill="none"
        stroke={colors.primary}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Rect x={60} y={113} width={6} height={6} rx={3} fill={colors.accent} />
    </Svg>
  );
}
