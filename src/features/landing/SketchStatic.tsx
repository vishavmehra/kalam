import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { G, Path, Rect } from 'react-native-svg';

import { useKalamTheme } from '@/design';

import { AppScreenSvg } from './AppScreenSvg';
import { buildSketch, INK, strokeOutlinePath } from './sketch-data';

/**
 * Static composition of the onboarding story: the ink sketch on paper with the finished app
 * resting on top. Used for reduced motion, no-WebGL browsers, and the empty App Shelf.
 */
export function SketchStatic({ height = 420, label }: { height?: number; label?: string }) {
  const theme = useKalamTheme();
  const paths = useMemo(() => buildSketch().map((s) => ({ d: strokeOutlinePath(s), color: s.color })), []);
  const inkColor = theme.scheme === 'dark' ? theme.colors.textSecondary : INK.ink;
  const width = (height * 600) / 860;
  return (
    <View
      accessible
      role="img"
      accessibilityLabel={label ?? 'A pen sketch of an expense app on paper, and the finished app it became on a phone.'}
      style={{ width, height }}
    >
      <Svg width={width} height={height} viewBox="-70 -50 600 860">
        <G transform="translate(-40 36) rotate(-5 180 370) scale(0.9)" opacity={0.9}>
          {paths.map((p, i) => <Path key={i} d={p.d} fill={p.color === 'accent' ? INK.accent : inkColor} />)}
        </G>
        <G transform="translate(196 34) rotate(3 180 370) scale(0.82)">
          <Rect x={8} y={20} width={388} height={772} rx={58} fill={theme.colors.text} opacity={0.12} />
          <Rect x={-14} y={-14} width={388} height={768} rx={54} fill="#1B211C" />
          <AppScreenSvg id="k-static-screen" />
        </G>
      </Svg>
    </View>
  );
}
