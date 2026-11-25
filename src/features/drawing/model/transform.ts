/**
 * Selection frame, handles, resize and rotate (docs/08 §9.3, §9.5). Pure functions: the studio
 * store calls them on every pointer move and commits the final result as one history step.
 *
 * A frame is the box the handles sit on. One rotated box-like element gets its own rotated frame;
 * anything else (strokes, lines, several objects) gets the axis-aligned box around the selection.
 */
import type { DrawingElement, DrawingPoint } from '@/core/contracts';
import {
  boundsOfPoints, centreOf, elementAABB, elementBounds, MAX_FONT, MIN_FONT, rotateElement, rotatePoint,
  scaleElement, storesRotation, textSize, unionBounds,
} from './geometry';
import { propsOf } from './properties';

export interface Frame { cx: number; cy: number; w: number; h: number; rot: number }
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type HandleId = ResizeHandle | 'rotate';

export const MIN_SIZE = 8;
/** Distance of the rotate handle from the top edge, in screen pixels. */
export const ROTATE_OFFSET_PX = 30;
/** Pointer reach of a handle, in screen pixels. Large enough for a fingertip. */
export const HANDLE_REACH_PX = 24;
export const ROTATE_SNAP_DEG = 15;
const ROTATE_SNAP_TOLERANCE_DEG = 4;

/** Direction of each handle from the frame centre, in local (unrotated) axes. */
export const HANDLE_VECTORS: Record<ResizeHandle, readonly [number, number]> = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};
export const RESIZE_HANDLES = Object.keys(HANDLE_VECTORS) as ResizeHandle[];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function selectionFrame(els: readonly DrawingElement[]): Frame | undefined {
  if (els.length === 0) return undefined;
  const single = els.length === 1 ? els[0]! : undefined;
  if (single && storesRotation(single) && single.rotation) {
    const b = elementBounds(single);
    const c = centreOf(b);
    return { cx: c.x, cy: c.y, w: Math.max(b.w, MIN_SIZE), h: Math.max(b.h, MIN_SIZE), rot: single.rotation };
  }
  const u = unionBounds(els.map(elementAABB));
  return { cx: u.x + u.w / 2, cy: u.y + u.h / 2, w: Math.max(u.w, MIN_SIZE), h: Math.max(u.h, MIN_SIZE), rot: 0 };
}

/** Frame corners clockwise from top-left, in document space. */
export function frameCorners(f: Frame): DrawingPoint[] {
  const c = { x: f.cx, y: f.cy };
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) =>
    rotatePoint({ x: f.cx + (sx * f.w) / 2, y: f.cy + (sy * f.h) / 2 }, c, f.rot));
}

export function handlePositions(f: Frame, scale: number): Array<{ id: HandleId; x: number; y: number }> {
  const c = { x: f.cx, y: f.cy };
  const at = (lx: number, ly: number) => rotatePoint({ x: f.cx + lx, y: f.cy + ly }, c, f.rot);
  const out: Array<{ id: HandleId; x: number; y: number }> = RESIZE_HANDLES.map((id) => {
    const [hx, hy] = HANDLE_VECTORS[id];
    const p = at((hx * f.w) / 2, (hy * f.h) / 2);
    return { id, x: p.x, y: p.y };
  });
  const r = at(0, -f.h / 2 - ROTATE_OFFSET_PX / scale);
  out.push({ id: 'rotate', x: r.x, y: r.y });
  return out;
}

/** Handle under the pointer, preferring the nearest. Corners and rotate win ties over edges. */
export function hitHandle(f: Frame, p: DrawingPoint, scale: number): HandleId | undefined {
  const reach = HANDLE_REACH_PX / scale;
  let best: { id: HandleId; d: number } | undefined;
  for (const h of handlePositions(f, scale)) {
    const d = Math.hypot(p.x - h.x, p.y - h.y);
    const bias = h.id === 'rotate' || h.id.length === 2 ? 0 : reach * 0.25;
    if (d <= reach && (!best || d + bias < best.d)) best = { id: h.id, d: d + bias };
  }
  return best?.id;
}

/** Corner handles keep proportions for images and text (docs/08 §6.7); edges stretch freely. */
export function lockAspect(els: readonly DrawingElement[]): boolean {
  return els.some((el) => el.kind === 'image' || el.kind === 'text');
}

/** New frame after dragging `handle` to `p`, with the opposite side (or corner) pinned. */
export function resizeFrame(f: Frame, handle: ResizeHandle, p: DrawingPoint, keepAspect: boolean): Frame {
  const [hx, hy] = HANDLE_VECTORS[handle];
  const c = { x: f.cx, y: f.cy };
  const q = rotatePoint(p, c, -f.rot);
  const lx = q.x - f.cx; const ly = q.y - f.cy;
  let w = f.w; let h = f.h;
  let ox = 0; let oy = 0;
  if (hx !== 0) { const fixed = -hx * (f.w / 2); w = Math.max(MIN_SIZE, hx * (lx - fixed)); ox = fixed + (hx * w) / 2; }
  if (hy !== 0) { const fixed = -hy * (f.h / 2); h = Math.max(MIN_SIZE, hy * (ly - fixed)); oy = fixed + (hy * h) / 2; }
  if (keepAspect && hx !== 0 && hy !== 0) {
    const k = Math.max(w / f.w, h / f.h);
    w = Math.max(MIN_SIZE, f.w * k); h = Math.max(MIN_SIZE, f.h * k);
    ox = -hx * (f.w / 2) + (hx * w) / 2;
    oy = -hy * (f.h / 2) + (hy * h) / 2;
  }
  const centre = rotatePoint({ x: f.cx + ox, y: f.cy + oy }, c, f.rot);
  return { cx: centre.x, cy: centre.y, w, h, rot: f.rot };
}

/** Rewrites elements so the frame `from` becomes the frame `to`. `handle` names the dragged handle (anchor side). */
export function applyFrame(
  els: readonly DrawingElement[], from: Frame, to: Frame, handle: ResizeHandle | 'centre',
): DrawingElement[] {
  const sx = to.w / from.w; const sy = to.h / from.h;
  if (from.rot !== 0 && els.length === 1) {
    const el = els[0]!;
    if (el.kind === 'text') {
      const fontSize = clamp(el.fontSize * ((sx + sy) / 2), MIN_FONT, MAX_FONT);
      const t = textSize(el.text, fontSize, propsOf(el).font, propsOf(el).bold);
      return [{ ...el, fontSize, x: to.cx - t.w / 2, y: to.cy - t.h / 2 }];
    }
    if (el.kind === 'stroke') return [el];
    return [{ ...el, x: to.cx - to.w / 2, y: to.cy - to.h / 2, w: to.w, h: to.h }];
  }
  const [hx, hy] = handle === 'centre' ? [0, 0] : HANDLE_VECTORS[handle];
  const ox = handle === 'centre' ? from.cx : from.cx - (hx * from.w) / 2;
  const oy = handle === 'centre' ? from.cy : from.cy - (hy * from.h) / 2;
  return els.map((el) => scaleElement(el, sx, sy, hx === 0 ? from.cx : ox, hy === 0 ? from.cy : oy));
}

export function resizeElements(
  start: readonly DrawingElement[], from: Frame, handle: ResizeHandle, p: DrawingPoint, keepAspect: boolean,
): DrawingElement[] {
  return applyFrame(start, from, resizeFrame(from, handle, p, keepAspect), handle);
}

/** Scales the selection about its centre (the "Smaller" and "Larger" buttons). */
export function scaleSelection(els: readonly DrawingElement[], factor: number): DrawingElement[] {
  const from = selectionFrame(els);
  if (!from || !(factor > 0)) return [...els];
  const to: Frame = { ...from, w: Math.max(MIN_SIZE, from.w * factor), h: Math.max(MIN_SIZE, from.h * factor) };
  return applyFrame(els, from, to, 'centre');
}

/** Angle of the pointer around the frame centre, in degrees (0 = right, clockwise positive on screen). */
export function pointerAngle(f: Frame, p: DrawingPoint): number {
  return (Math.atan2(p.y - f.cy, p.x - f.cx) * 180) / Math.PI;
}

/** Snaps near-multiples of 15° so objects square up easily, but leaves in-between angles alone. */
export function snapAngle(deg: number): number {
  const nearest = Math.round(deg / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG;
  return Math.abs(deg - nearest) <= ROTATE_SNAP_TOLERANCE_DEG ? nearest : deg;
}

/** Turns the selection by `deg` about the frame centre. */
export function rotateElements(els: readonly DrawingElement[], frame: Frame, deg: number): DrawingElement[] {
  const pivot = { x: frame.cx, y: frame.cy };
  return els.map((el) => rotateElement(el, deg, pivot));
}

/**
 * Rotation while dragging the rotate handle. `startAngle` is the pointer angle at pointer-down.
 * A single rotated box snaps its absolute angle; anything else snaps the turn.
 */
export function rotateDrag(
  start: readonly DrawingElement[], frame: Frame, startAngle: number, p: DrawingPoint,
): DrawingElement[] {
  const raw = pointerAngle(frame, p) - startAngle;
  const base = frame.rot;
  const snapped = snapAngle(base + raw) - base;
  return rotateElements(start, frame, snapped);
}

/** Bounds of the points that make up the frame (for tests and hit areas). */
export function frameBounds(f: Frame) {
  return boundsOfPoints(frameCorners(f));
}

/**
 * Shift-drag constraint (docs/08 §7.5-7.8): boxes and ellipses become squares and circles, lines
 * and arrows snap to the nearest 45 degrees. Returns the constrained width and height of the drag.
 */
export function constrainDrag(kind: 'rect' | 'ellipse' | 'line' | 'arrow', dx: number, dy: number): { w: number; h: number } {
  if (kind === 'rect' || kind === 'ellipse') {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    return { w: (dx < 0 ? -1 : 1) * m, h: (dy < 0 ? -1 : 1) * m };
  }
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return { w: len * Math.cos(a), h: len * Math.sin(a) };
}
