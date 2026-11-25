import { useEffect, useState } from 'react';
import { Easing, type SharedValue, useSharedValue, withTiming } from 'react-native-reanimated';

/**
 * Mount/unmount with an enter/exit transition. `progress` goes 0→1 on enter and 1→0 on exit;
 * the component stays mounted until the exit finishes. Exit is faster than enter (system responding).
 */
export function usePresence(visible: boolean, enterMs: number, exitMs: number): { mounted: boolean; progress: SharedValue<number> } {
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, { duration: enterMs, easing: Easing.bezier(0.32, 0.72, 0, 1) });
      return;
    }
    progress.value = withTiming(0, { duration: exitMs, easing: Easing.out(Easing.quad) });
    const t = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(t);
  }, [visible, enterMs, exitMs, progress]);
  return { mounted, progress };
}
