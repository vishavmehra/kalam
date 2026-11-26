/**
 * Reduced-motion helpers (DIRECTION §5). Motion explains or confirms; under reduced motion a surface shows
 * its final state and keeps only colour and opacity fades of 150 ms or less.
 */
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { useKalamTheme } from './theme';

/** True while the app or tab is in front: hidden tabs and backgrounded apps pause ambient motion. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return undefined;
      const sync = () => setVisible(document.visibilityState !== 'hidden');
      sync();
      document.addEventListener('visibilitychange', sync);
      return () => document.removeEventListener('visibilitychange', sync);
    }
    const sub = AppState.addEventListener('change', (s) => setVisible(s === 'active'));
    return () => sub.remove();
  }, []);
  return visible;
}

/**
 * Whether ambient motion (the 3D hero, the nib, looping stories) may run right now: motion is not reduced
 * and the page is visible. When false, render the still final frame.
 */
export function useAmbientMotion(): boolean {
  const { reducedMotion } = useKalamTheme();
  const visible = usePageVisible();
  return !reducedMotion && visible;
}

/** A duration that collapses under reduced motion: `full` ms normally, `reduced` ms (default 0) otherwise. */
export function motionMs(reducedMotion: boolean, full: number, reduced = 0): number {
  return reducedMotion ? reduced : full;
}
