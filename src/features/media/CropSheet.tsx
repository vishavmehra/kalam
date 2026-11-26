/**
 * Web cropper (docs/06 §7.3): the chosen picture with a box to drag. Corners and edges resize it, the inside
 * moves it, and with a keyboard the arrow keys move it and Shift with the arrows resizes it. Android and iOS use
 * the system crop screen when the picture is picked, so this is the web's version of the same step.
 */
import { RotateCcw } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, type PanResponderInstance, Platform, View } from 'react-native';

import { dragCrop, isWholePicture, nudgeCrop, WHOLE_PICTURE, type CropHandle, type CropKey, type CropRect } from '@/core/media/crop';
import { Button, Sheet, Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';
import type { MediaSource } from '@/infrastructure/media/source';

import { cropSource } from './web-crop';

const HANDLES: readonly CropHandle[] = ['move', 'n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
/** Hit size of a handle, in px (a comfortable thumb or pointer target). */
const HIT = 32;
const MAX_FRAME_H = 360;
const ARROWS: ReadonlySet<string> = new Set<CropKey>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

interface KeyEvent { key: string; shiftKey?: boolean; preventDefault(): void }

/** Where each handle sits on the box and what it looks like. Edges are thin strips, corners are squares. */
function handleStyle(h: CropHandle, w: number, hgt: number): object | undefined {
  const mid = (len: number) => (len - HIT) / 2;
  switch (h) {
    case 'move': return undefined;
    case 'n': return { top: -HIT / 2, left: mid(w), width: HIT, height: HIT };
    case 's': return { bottom: -HIT / 2, left: mid(w), width: HIT, height: HIT };
    case 'w': return { left: -HIT / 2, top: mid(hgt), width: HIT, height: HIT };
    case 'e': return { right: -HIT / 2, top: mid(hgt), width: HIT, height: HIT };
    case 'nw': return { top: -HIT / 2, left: -HIT / 2, width: HIT, height: HIT };
    case 'ne': return { top: -HIT / 2, right: -HIT / 2, width: HIT, height: HIT };
    case 'sw': return { bottom: -HIT / 2, left: -HIT / 2, width: HIT, height: HIT };
    case 'se': return { bottom: -HIT / 2, right: -HIT / 2, width: HIT, height: HIT };
  }
}

export interface CropSheetProps {
  /** The picture to crop; the sheet is open while there is one. */
  source?: MediaSource;
  /** The cropped picture (or the picture itself when nothing was cropped), or undefined when the person closed the sheet. */
  onDone(source: MediaSource | undefined): void;
}

export function CropSheet({ source, onDone }: CropSheetProps) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { colors, space } = theme;
  const [natural, setNatural] = useState<{ w: number; h: number }>();
  const [avail, setAvail] = useState(300);
  const [rect, setRect] = useState<CropRect>(WHOLE_PICTURE);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setRect(WHOLE_PICTURE);
    setNatural(undefined);
    setFailed(false);
    if (!source) return;
    // The browser reports the size as it shows the picture, so a phone photo that is stored turned comes out upright.
    Image.getSize(source.uri, (w, h) => setNatural({ w, h }), () => setNatural({ w: 4, h: 3 }));
  }, [source]);

  // Frame: as large as fits, in the picture's own proportions.
  const ratio = natural ? natural.w / Math.max(1, natural.h) : 4 / 3;
  const width = Math.max(120, Math.min(avail, MAX_FRAME_H * ratio));
  const height = width / ratio;

  const frame = useRef({ w: width, h: height });
  frame.current = { w: width, h: height };
  const current = useRef(rect);
  current.current = rect;
  const from = useRef(rect);
  const responders = useMemo(() => {
    const made = {} as Record<CropHandle, PanResponderInstance>;
    for (const h of HANDLES) {
      made[h] = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => { from.current = current.current; },
        onPanResponderMove: (_, g) => setRect(dragCrop(from.current, h, g.dx / frame.current.w, g.dy / frame.current.h)),
      });
    }
    return made;
  }, []);

  const whole = isWholePicture(rect);
  const apply = async () => {
    if (!source) return;
    if (whole) { onDone(source); return; }
    setBusy(true);
    setFailed(false);
    try {
      onDone(await cropSource(source, rect));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  // Typed as a bare object, like the roving-focus props in src/design: the web key events are not in React Native's types.
  const keys: object = Platform.OS === 'web'
    ? {
      tabIndex: 0,
      onKeyDown: (e: KeyEvent) => {
        if (!ARROWS.has(e.key)) return;
        e.preventDefault();
        setRect((r) => nudgeCrop(r, e.key as CropKey, !!e.shiftKey));
      },
    }
    : {};

  const left = rect.x * width;
  const top = rect.y * height;
  const boxW = rect.w * width;
  const boxH = rect.h * height;
  const dim = { position: 'absolute', backgroundColor: colors.scrim } as const;
  const noSelect = { userSelect: 'none', touchAction: 'none' } as object;

  return (
    <Sheet
      visible={!!source}
      onClose={() => onDone(undefined)}
      title={t('create.crop.title')}
      description={t('create.crop.description')}
      maxWidth={520}
      dismissible={!busy}
      footer={[
        <Button key="reset" label={t('create.crop.reset')} icon={RotateCcw} variant="ghost" onPress={() => setRect(WHOLE_PICTURE)} disabled={whole || busy} />,
        <Button key="use" label={t(whole ? 'create.crop.useWhole' : 'create.crop.use')} onPress={() => void apply()} loading={busy} />,
      ]}
    >
      <View onLayout={(e) => setAvail(Math.floor(e.nativeEvent.layout.width))} style={{ gap: space[3], alignItems: 'center' }}>
        {source ? (
          <View style={{ width, height, backgroundColor: colors.surfaceAlt, ...noSelect }}>
            <Image source={{ uri: source.uri }} accessibilityIgnoresInvertColors accessibilityLabel={t('create.crop.pictureLabel')} resizeMode="stretch" style={{ width, height }} />
            <View aria-hidden pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width, height }}>
              <View style={{ ...dim, top: 0, left: 0, width, height: top }} />
              <View style={{ ...dim, top: top + boxH, left: 0, width, height: Math.max(0, height - top - boxH) }} />
              <View style={{ ...dim, top, left: 0, width: left, height: boxH }} />
              <View style={{ ...dim, top, left: left + boxW, width: Math.max(0, width - left - boxW), height: boxH }} />
            </View>
            <View
              accessible
              role="group"
              accessibilityLabel={t('create.crop.boxLabel')}
              accessibilityHint={t('create.crop.keys')}
              {...keys}
              {...responders.move.panHandlers}
              style={{ position: 'absolute', left, top, width: boxW, height: boxH, borderWidth: 2, borderColor: colors.accent, ...noSelect }}
            >
              {HANDLES.filter((h) => h !== 'move').map((h) => (
                <View
                  key={h}
                  aria-hidden
                  {...responders[h].panHandlers}
                  style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center', ...handleStyle(h, boxW, boxH), ...noSelect }}
                >
                  <View style={{ width: h.length === 2 ? 14 : 10, height: h.length === 2 ? 14 : 10, borderRadius: 2, backgroundColor: colors.accent, borderWidth: 1.5, borderColor: colors.text }} />
                </View>
              ))}
            </View>
          </View>
        ) : null}
        <Text variant="caption" tone="muted" numeric>{t('create.crop.size', { w: Math.round(rect.w * 100), h: Math.round(rect.h * 100) })}</Text>
        {failed ? <Text tone="danger" accessibilityRole="alert">{t('create.crop.failed')}</Text> : null}
      </View>
    </Sheet>
  );
}
