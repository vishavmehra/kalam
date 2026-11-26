import { Asset } from 'expo-asset';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { useAmbientMotion, useKalamTheme } from '@/design';
import { localeFor } from '@/i18n/languages';
import { useT } from '@/i18n/react';
import { loadScriptFonts } from '@/i18n/use-script-fonts';

import type { HeroStageProps } from './HeroStage';
import { DONE, HeroField, type PlayState, type StoryStatus } from './HeroField';
import { HeroPoster, SKETCH, SKETCH_BLANK, STAMP_FRAME } from './HeroPoster';
import type { HeroScene } from './hero-scene.web';
import { finalApp, stageLayout, stampDate } from './story';

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

const uri = (mod: number) => Asset.fromModule(mod).uri;

/**
 * Web hero: W4's three.js and GSAP stage, restyled (owner override 4, 2026-11-25). The still final frame is
 * the first paint and stays when motion is reduced, WebGL is missing or the stage fails; three.js and GSAP are
 * code-split and load only when motion is allowed. Once the 3D stage has drawn, the still frame fades out in
 * place, so nothing shifts.
 */
export function HeroStage({ wide }: HeroStageProps) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const motion = useAmbientMotion();
  // `?still` asks for the finished frame (DIRECTION §4), like reduced motion; handy for screenshots too.
  const [still] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('still'));
  const reduced = theme.reducedMotion || still;
  const host = useRef<ComponentRef<typeof View>>(null);
  const scene = useRef<HeroScene | null>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [live, setLive] = useState(false);
  const [status, setStatus] = useState<StoryStatus>(DONE);
  const [play, setPlay] = useState<PlayState>('done');
  const measured = area.width > 0 && area.height > 0;
  const onThisPhone = t('landing.stage.onThisPhone');
  const checked = t('stamp.checked');
  const date = stampDate(localeFor(theme.uiLanguage));

  // A hidden tab at first paint never starts the stage; reduced motion never loads three.js at all.
  const allowed = !reduced && (motion || live);
  useEffect(() => {
    if (!allowed || !measured || !hasWebGL()) return undefined;
    const el = host.current as unknown as HTMLElement | null;
    if (!el) return undefined;
    let cancelled = false;
    Promise.all([import('./hero-scene.web'), loadScriptFonts(['devanagari']).catch(() => undefined)])
      .then(([{ createHeroScene }]) =>
        createHeroScene({
          container: el,
          dark: theme.scheme === 'dark',
          images: { sketch: uri(SKETCH), blank: uri(SKETCH_BLANK), stamp: uri(STAMP_FRAME) },
          labels: { onThisPhone, checked, stampDate: date },
          onStatus: (s) => { if (!cancelled) setStatus(s); },
          onPlayState: (p) => { if (!cancelled) setPlay(p); },
        }),
      )
      .then((s) => {
        if (cancelled) { s.dispose(); return; }
        scene.current = s;
        setLive(true);
      })
      .catch(() => { /* the still frame stays */ });
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
      setLive(false);
      setStatus(DONE);
      setPlay('done');
    };
    // Re-create only when what is painted into the scene changes; the scene follows resizes itself.
  }, [allowed, measured, theme.scheme, onThisPhone, checked, date]);

  const layout = measured ? stageLayout(area.width, area.height) : null;
  return (
    <HeroField
      wide={wide}
      status={live ? status : DONE}
      control={live ? { state: play, onPress: () => scene.current?.toggle() } : undefined}
      onAreaLayout={setArea}
    >
      <View role="img" aria-label={t('landing.stage.label')} style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0 }}>
        {layout ? (
          <View
            aria-hidden
            style={[
              { position: 'absolute', top: 0, start: 0, end: 0, bottom: 0, opacity: live ? 0 : 1 },
              { transitionProperty: 'opacity', transitionDuration: '240ms' } as object,
            ]}
          >
            <HeroPoster paper={layout.paper} phone={layout.phone} stamp={layout.stamp} app={finalApp(onThisPhone)} stampLabel={checked} stampDate={date} />
          </View>
        ) : null}
        <View ref={host} aria-hidden style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0 }} />
      </View>
    </HeroField>
  );
}
