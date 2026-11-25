/**
 * Android ink layer: Skia paths over the running app; gesture-handler routes one-finger input to
 * the marker. Two fingers are ignored, and a cancelled gesture drops the stroke.
 */
import { Canvas, Path } from '@shopify/react-native-skia';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import type { InkPoint } from './gestures';
import { strokePrimitives, type InkCanvasProps } from './ink';

export function InkCanvas({ strokes, style, enabled, tool, onStrokeStart, onStrokeEnd }: InkCanvasProps) {
  const [live, setLive] = useState<InkPoint[] | null>(null);
  const liveRef = useRef<InkPoint[] | null>(null);
  const endRef = useRef(onStrokeEnd);
  endRef.current = onStrokeEnd;
  const startRef = useRef(onStrokeStart);
  startRef.current = onStrokeStart;

  const pan = usePanGesture({
    enabled,
    maxPointers: 1,
    minDistance: 0,
    runOnJS: true,
    onBegin: (e) => {
      liveRef.current = [{ x: e.x, y: e.y, t: Date.now() }];
      setLive(liveRef.current);
      startRef.current?.();
    },
    onUpdate: (e) => {
      if (!liveRef.current) return;
      liveRef.current = [...liveRef.current, { x: e.x, y: e.y, t: Date.now() }];
      setLive(liveRef.current);
    },
    onFinalize: (e) => {
      const pts = liveRef.current;
      liveRef.current = null;
      setLive(null);
      if (!e.canceled && pts?.length) endRef.current(pts);
    },
  });

  const done = useMemo(() => strokes.flatMap((s) => strokePrimitives(s, style)), [strokes, style]);
  const drawing = live && tool === 'pen' ? strokePrimitives({ id: 'live', points: live }, style, false) : [];

  return (
    <GestureDetector gesture={pan}>
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents={enabled ? 'auto' : 'none'}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Canvas style={StyleSheet.absoluteFill}>
          {[...done, ...drawing].map((p, i) => (p.t === 'path' && p.d ? <Path key={i} path={p.d} color={p.fill} opacity={p.opacity ?? 1} /> : null))}
        </Canvas>
      </View>
    </GestureDetector>
  );
}
