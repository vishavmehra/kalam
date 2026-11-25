import { Canvas, Group, Path } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing, type SharedValue, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';
import Svg, { G, Rect } from 'react-native-svg';

import { useBreakpoint, useKalamTheme } from '@/design';

import { AppScreenSvg } from './AppScreenSvg';
import { buildSketch, DRAW_SECONDS, INK, type InkStroke, SCREEN, strokeCenterPath } from './sketch-data';
import { SketchStatic } from './SketchStatic';

/** One ink stroke whose trim end follows the shared drawing clock (seconds). */
function InkPath({ stroke, d, color, clock }: { stroke: InkStroke; d: string; color: string; clock: SharedValue<number> }) {
  const end = useDerivedValue(() => Math.min(1, Math.max(0, (clock.value - stroke.start) / stroke.duration)));
  return <Path path={d} color={color} style="stroke" strokeWidth={stroke.width} strokeCap="round" strokeJoin="round" start={0} end={end} />;
}

/**
 * Android hero: Skia path-drawing of the same sketch used on the web, then the rendered app
 * fades in over it and lifts away (Reanimated). Reduced motion → static illustration.
 */
export function HeroStage({ height }: { height: number }) {
  const theme = useKalamTheme();
  const { width: winW } = useBreakpoint();
  const width = Math.min(winW - 32, 640);
  const strokes = useMemo(() => buildSketch().map((s) => ({ s, d: strokeCenterPath(s) })), []);
  const clock = useSharedValue(0);
  const shown = useSharedValue(0);
  const lifted = useSharedValue(0);

  useEffect(() => {
    if (theme.reducedMotion) return;
    clock.value = withTiming(DRAW_SECONDS + 0.1, { duration: DRAW_SECONDS * 1000, easing: Easing.linear });
    shown.value = withDelay(DRAW_SECONDS * 1000 + 250, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
    lifted.value = withDelay(DRAW_SECONDS * 1000 + 1100, withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.cubic) }));
  }, [theme.reducedMotion, clock, shown, lifted]);

  const s = Math.min(width / 420, height / 800);
  const ox = (width - SCREEN.w * s) / 2;
  const oy = (height - SCREEN.h * s) / 2;

  const sketchStyle = useAnimatedStyle(() => ({
    opacity: 1 - lifted.value * 0.15,
    transform: [
      { translateX: -lifted.value * width * 0.12 },
      { rotate: `${-5 * lifted.value}deg` },
      { scale: 1 - lifted.value * 0.1 },
    ],
  }));
  const appStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [
      { translateX: lifted.value * width * 0.16 },
      { translateY: -lifted.value * 10 },
      { rotate: `${3 * lifted.value}deg` },
      { scale: 1 - lifted.value * 0.12 },
    ],
  }));

  if (theme.reducedMotion) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <SketchStatic height={height * 0.94} />
      </View>
    );
  }

  const inkColor = theme.scheme === 'dark' ? theme.colors.textSecondary : INK.ink;
  return (
    <View
      accessible
      role="img"
      accessibilityLabel="Animation: a pen sketches an expense app, the finished app appears over the sketch and lifts away."
      style={{ height, width, alignSelf: 'center' }}
    >
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, width, height }, sketchStyle]}>
        <Canvas style={{ width, height }}>
          <Group transform={[{ translateX: ox }, { translateY: oy }, { scale: s }]}>
            {strokes.map(({ s: st, d }, i) => (
              <InkPath key={i} stroke={st} d={d} color={st.color === 'accent' ? INK.accent : inkColor} clock={clock} />
            ))}
          </Group>
        </Canvas>
      </Animated.View>
      <Animated.View
        style={[{ position: 'absolute', left: ox - 14 * s, top: oy - 14 * s, width: 388 * s, height: 768 * s }, appStyle]}
      >
        <Svg width={388 * s} height={768 * s} viewBox="-14 -14 388 768">
          <Rect x={-14} y={-14} width={388} height={768} rx={54} fill="#1B211C" />
          <G>
            <AppScreenSvg id="k-native-screen" />
          </G>
        </Svg>
      </Animated.View>
    </View>
  );
}
