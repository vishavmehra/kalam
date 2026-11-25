/**
 * Android creation animation: Reanimated drives each stroke's dash offset so the app outline is
 * inked one stroke after another on the UI thread. Reduced motion → static outline.
 */
import { useEffect } from 'react';
import Animated, {
  cancelAnimation, Easing, useAnimatedProps, useSharedValue, withRepeat, withTiming, type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { useKalamTheme, useReducedMotion } from '@/design';
import { INK_PATHS, INK_VIEWBOX, type InkPath } from './ink-paths';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const STEPS = INK_PATHS.length;

function Stroke({ path, index, progress, color }: { path: InkPath; index: number; progress: SharedValue<number>; color: string }) {
  const animatedProps = useAnimatedProps(() => {
    const local = Math.min(1, Math.max(0, progress.value - index));
    return { strokeDashoffset: path.len * (1 - local) };
  });
  return (
    <AnimatedPath
      d={path.d}
      fill="none"
      stroke={color}
      strokeWidth={path.width}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={[path.len, path.len]}
      animatedProps={animatedProps}
    />
  );
}

export function InkOutline({ size = 120, active = true }: { size?: number; active?: boolean }) {
  const reduced = useReducedMotion();
  const { colors } = useKalamTheme();
  // +2 steps of "hold" so the finished sketch is visible before it restarts.
  const progress = useSharedValue(reduced ? STEPS : 0);

  useEffect(() => {
    if (reduced || !active) { progress.value = STEPS; return; }
    progress.value = 0;
    progress.value = withRepeat(withTiming(STEPS + 2, { duration: (STEPS + 2) * 260, easing: Easing.inOut(Easing.quad) }), -1, false);
    return () => cancelAnimation(progress);
  }, [reduced, active, progress]);

  return (
    <Svg viewBox={INK_VIEWBOX} width={size} height={size * 1.5} accessibilityRole="image" accessibilityLabel="Kalam is sketching your app">
      {INK_PATHS.map((p, i) => (
        <Stroke key={i} path={p} index={i} progress={progress} color={i === STEPS - 1 ? colors.accent : colors.primary} />
      ))}
    </Svg>
  );
}
