/**
 * Marker ink for edit-by-drawing. Strokes become the Drawing Studio's display-list primitives
 * (perfect-freehand outlines), so the web canvas and Android Skia renderers draw them as-is.
 * Each stroke is drawn twice: a wider halo first, then the marker, so a mark stays visible on any
 * generated app's colours.
 */
import { getStroke } from 'perfect-freehand';
import { outlineToSvgPath, type Primitive } from '@/features/drawing/model/display';
import type { InkPoint } from './gestures';

export interface InkStroke { id: string; points: InkPoint[] }
export interface InkStyle { ink: string; halo: string; size: number }

export interface InkCanvasProps {
  /** Finished strokes of the current mark. */
  strokes: readonly InkStroke[];
  style: InkStyle;
  /** False: ignore input and let touches reach the app (scroll tool, busy, previewing). */
  enabled: boolean;
  /** Pen draws live ink; note only reports where the person tapped. */
  tool: 'pen' | 'note';
  /** A finger or pointer went down (lets the overlay wait for a second stroke of an X or arrow). */
  onStrokeStart?(): void;
  onStrokeEnd(points: InkPoint[]): void;
}

const OPTIONS = { thinning: 0.3, smoothing: 0.55, streamline: 0.4, simulatePressure: true } as const;
const cache = new WeakMap<InkStroke, { key: string; prims: Primitive[] }>();

function outline(points: readonly InkPoint[], size: number, last: boolean): string {
  return outlineToSvgPath(getStroke(points.map((p) => [p.x, p.y]), { ...OPTIONS, size, last }));
}

/** Halo + marker primitives for one stroke. Finished strokes are cached per object and style. */
export function strokePrimitives(stroke: InkStroke, style: InkStyle, complete = true): Primitive[] {
  const key = `${style.ink}|${style.halo}|${style.size}`;
  const hit = complete ? cache.get(stroke) : undefined;
  if (hit?.key === key) return hit.prims;
  if (!stroke.points.length) return [];
  const prims: Primitive[] = [
    { t: 'path', d: outline(stroke.points, style.size + 5, complete), fill: style.halo, opacity: 0.85 },
    { t: 'path', d: outline(stroke.points, style.size, complete), fill: style.ink },
  ];
  if (complete) cache.set(stroke, { key, prims });
  return prims;
}

let seq = 0;
export const newStroke = (points: InkPoint[]): InkStroke => ({ id: `ink_${Date.now().toString(36)}_${(seq++).toString(36)}`, points });
