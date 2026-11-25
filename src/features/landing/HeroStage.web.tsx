import { RotateCcw } from 'lucide-react-native';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { IconButton, useKalamTheme } from '@/design';

import type { HeroScene } from './hero-scene.web';
import { SketchStatic } from './SketchStatic';

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

const LABEL = 'Animation: a typed note, a voice note, video frames and a photo of a paper sketch join a pen drawing on a notebook page. Together they become one finished expense app on a phone.';

/**
 * Web hero. three.js + GSAP are code-split (dynamic import) and only loaded when motion is
 * allowed and WebGL exists; otherwise a static SVG tells the same story.
 */
export function HeroStage({ height }: { height: number }) {
  const theme = useKalamTheme();
  const reduced = theme.reducedMotion;
  const host = useRef<ComponentRef<typeof View>>(null);
  const scene = useRef<HeroScene | null>(null);
  const [mode, setMode] = useState<'loading' | 'webgl' | 'static'>(reduced ? 'static' : 'loading');

  useEffect(() => {
    if (reduced || !hasWebGL()) { setMode('static'); return; }
    setMode('loading');
    let cancelled = false;
    const el = host.current as unknown as HTMLElement | null;
    if (!el) return;
    import('./hero-scene.web')
      .then(({ createHeroScene }) => createHeroScene({ container: el, dark: theme.scheme === 'dark' }))
      .then((s) => {
        if (cancelled) { s.dispose(); return; }
        scene.current = s;
        setMode('webgl');
      })
      .catch(() => { if (!cancelled) setMode('static'); });
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, [reduced, theme.scheme]);

  if (mode === 'static') {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <SketchStatic height={height * 0.94} />
      </View>
    );
  }
  return (
    <View style={{ height, position: 'relative' }}>
      <View ref={host} role="img" aria-label={LABEL} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      {mode === 'webgl' ? (
        <View style={{ position: 'absolute', right: 4, bottom: 4 }}>
          <IconButton icon={RotateCcw} label="Replay animation" variant="ghost" onPress={() => scene.current?.replay()} />
        </View>
      ) : null}
    </View>
  );
}
