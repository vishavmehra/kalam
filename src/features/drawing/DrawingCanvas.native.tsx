/**
 * Android canvas (docs/08 §4.1, §8): Skia renders two recorded pictures. The base picture (paper and
 * every committed object) is re-recorded only when the page changes; the top picture (stroke in
 * progress, objects being moved, selection handles) is small and re-recorded each frame. Drawing a
 * stroke therefore never replays the whole page (docs/08 §17). gesture-handler routes one-finger
 * input (with stylus pressure) to the active tool and two-finger pinch/pan to the view; two fingers
 * always cancel an in-progress stroke (docs/08 §8.6).
 */
import { Canvas, ClipOp, Group, Picture, Skia, type SkPicture } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useCompetingGestures } from 'react-native-gesture-handler';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { useKalamTheme } from '@/design';
import { images } from './image-cache.native';
import { PAGE_HEIGHT, PAGE_WIDTH, type Primitive } from './model';
import { drawPrimitivesSkia } from './render-skia';
import { canvasLabel, selectBase, selectChrome, selectLive, toDocPoint, type StudioState } from './studio-store';
import { TextEditOverlay } from './TextEditOverlay';

/** Room around the page for selection handles, which may sit outside it. */
const CHROME_PAD = 600;

function recordBase(base: readonly Primitive[]): SkPicture {
  const recorder = Skia.PictureRecorder();
  // The cull rectangle is the page, so anything outside it is not drawn.
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT));
  drawPrimitivesSkia(canvas, base);
  return recorder.finishRecordingAsPicture();
}

function recordTop(s: StudioState, border: string): SkPicture {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(-CHROME_PAD, -CHROME_PAD, PAGE_WIDTH + CHROME_PAD * 2, PAGE_HEIGHT + CHROME_PAD * 2));
  canvas.save();
  canvas.clipRect(Skia.XYWHRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT), ClipOp.Intersect, true);
  drawPrimitivesSkia(canvas, selectLive(s));
  canvas.restore();
  drawPrimitivesSkia(canvas, [{ t: 'rect', x: 0, y: 0, w: PAGE_WIDTH, h: PAGE_HEIGHT, stroke: border, width: 1 / s.view.scale }]);
  drawPrimitivesSkia(canvas, selectChrome(s));
  return recorder.finishRecordingAsPicture();
}

interface Pictures { base: SkPicture; top: SkPicture }

export function DrawingCanvas({ store }: { store: StoreApi<StudioState> }) {
  const { colors } = useKalamTheme();
  const border = colors.borderStrong;
  const view = useStore(store, (s) => s.view);
  const label = useStore(store, canvasLabel);
  const [pictures, setPictures] = useState<Pictures>(() => ({
    base: recordBase(selectBase(store.getState())),
    top: recordTop(store.getState(), border),
  }));

  useEffect(() => {
    let frame = 0;
    let lastBase: readonly Primitive[] | undefined;
    let basePicture: SkPicture | undefined;
    let imageVersion = images.version();
    const render = () => {
      frame = 0;
      const s = store.getState();
      const base = selectBase(s);
      if (!basePicture || base !== lastBase || imageVersion !== images.version()) {
        imageVersion = images.version();
        lastBase = base;
        basePicture = recordBase(base);
      }
      setPictures({ base: basePicture, top: recordTop(s, border) });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
    const unsub = store.subscribe(schedule);
    const unsubImages = images.subscribe(schedule);
    render();
    return () => { unsub(); unsubImages(); if (frame) cancelAnimationFrame(frame); };
  }, [store, border]);

  const point = (x: number, y: number, pressure?: number) =>
    toDocPoint(store.getState().view, x, y, pressure && pressure > 0 && pressure !== 1 ? pressure : undefined);

  const draw = usePanGesture({
    maxPointers: 1,
    minDistance: 0,
    runOnJS: true,
    onBegin: (e) => store.getState().pointerDown(point(e.x, e.y, e.stylusData?.pressure)),
    onUpdate: (e) => store.getState().pointerMove(point(e.x, e.y, e.stylusData?.pressure)),
    onFinalize: (e) => (e.canceled ? store.getState().cancelPointer() : store.getState().pointerUp()),
  });
  const pinch = usePinchGesture({
    runOnJS: true,
    onActivate: () => store.getState().cancelPointer(),
    onUpdate: (e) => store.getState().zoomBy(e.scaleChange, e.focalX, e.focalY),
  });
  const twoFingerPan = usePanGesture({
    minPointers: 2,
    runOnJS: true,
    onUpdate: (e) => store.getState().panBy(e.changeX, e.changeY),
  });
  const viewGestures = useSimultaneousGestures(pinch, twoFingerPan);
  const gesture = useCompetingGestures(viewGestures, draw);

  return (
    <View
      style={{ flex: 1, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}
      onLayout={(e) => store.getState().setViewport(e.nativeEvent.layout.width, e.nativeEvent.layout.height)}
      accessibilityLabel={label}
    >
      <GestureDetector gesture={gesture}>
        <View style={{ flex: 1 }}>
          <Canvas style={{ flex: 1 }}>
            <Group transform={[{ translateX: view.tx }, { translateY: view.ty }, { scale: view.scale }]}>
              <Picture picture={pictures.base} />
              <Picture picture={pictures.top} />
            </Group>
          </Canvas>
        </View>
      </GestureDetector>
      <TextEditOverlay store={store} />
    </View>
  );
}
