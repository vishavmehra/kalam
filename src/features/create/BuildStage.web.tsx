/**
 * Web creation stage: three.js is code-split and loaded only when motion is allowed and WebGL
 * exists. The inked outline shows while it loads and stays as the fallback.
 */
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { useKalamTheme } from '@/design';
import type { FragmentKind } from '@/features/landing/scene/kinds';

import { InkOutline } from './InkOutline';
import type { ProgressScene } from './progress-scene.web';

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function BuildStage({ size, kinds }: { size: number; kinds: FragmentKind[] }) {
  const theme = useKalamTheme();
  const reduced = theme.reducedMotion;
  const host = useRef<ComponentRef<typeof View>>(null);
  const [mode, setMode] = useState<'loading' | 'webgl' | 'static'>(reduced ? 'static' : 'loading');
  const key = kinds.join(',');

  useEffect(() => {
    if (reduced || !hasWebGL()) { setMode('static'); return undefined; }
    const el = host.current as unknown as HTMLElement | null;
    if (!el) return undefined;
    setMode('loading');
    let cancelled = false;
    let scene: ProgressScene | null = null;
    import('./progress-scene.web')
      .then(({ createProgressScene }) => createProgressScene({ container: el, dark: theme.scheme === 'dark', kinds: key.split(',') as FragmentKind[] }))
      .then((s) => {
        if (cancelled) { s.dispose(); return; }
        scene = s;
        setMode('webgl');
      })
      .catch(() => { if (!cancelled) setMode('static'); });
    return () => { cancelled = true; scene?.dispose(); };
  }, [reduced, theme.scheme, key]);

  const box = size * 1.7;
  return (
    <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
      {mode !== 'webgl' ? <InkOutline size={size * 0.62} /> : null}
      {mode === 'static' ? null : (
        <View
          ref={host}
          role="img"
          aria-label="Your inputs being turned into an app screen"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: mode === 'webgl' ? 1 : 0 }}
        />
      )}
    </View>
  );
}
