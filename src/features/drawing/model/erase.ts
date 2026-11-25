/**
 * Partial eraser (docs/08 §7.4). Dragging the eraser over a stroke cuts out the part under the
 * eraser and keeps the rest as separate strokes with the original style. Other objects are erased
 * whole. Pure: the studio runs it on a working copy during the drag and commits one history step.
 */
import type { DrawingElement, DrawingPage, DrawingPoint } from '@/core/contracts';
import { distToSegment, elementBounds, hitsElement, type StrokeElement } from './geometry';
import { newId } from './document';

/** Strokes cut to fewer points than this are dropped as specks. */
const MIN_FRAGMENT_POINTS = 2;

function lerpPoint(a: DrawingPoint, b: DrawingPoint, t: number): DrawingPoint {
  const p: DrawingPoint = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  if (a.pressure !== undefined && b.pressure !== undefined) p.pressure = a.pressure + (b.pressure - a.pressure) * t;
  return p;
}

/**
 * Cuts the part of `stroke` within `radius` of `p`. Returns undefined when the eraser misses,
 * otherwise the surviving fragments (possibly none). The first fragment keeps the stroke id.
 */
export function splitStroke(stroke: StrokeElement, p: DrawingPoint, radius: number): StrokeElement[] | undefined {
  const reach = radius + stroke.size / 2;
  const b = elementBounds(stroke);
  if (p.x < b.x - radius || p.x > b.x + b.w + radius || p.y < b.y - radius || p.y > b.y + b.h + radius) return undefined;
  const pts = stroke.points;
  if (pts.length === 0) return undefined;

  // Add points along segments that pass near the eraser so the cut lands where the eraser is.
  const step = Math.max(reach / 3, 1);
  const dense: DrawingPoint[] = [];
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]!;
    dense.push(cur);
    const next = pts[i + 1];
    if (!next) break;
    const len = Math.hypot(next.x - cur.x, next.y - cur.y);
    if (len > step && distToSegment(p, cur, next) <= reach + step) {
      const n = Math.ceil(len / step);
      for (let k = 1; k < n; k++) dense.push(lerpPoint(cur, next, k / n));
    }
  }

  const inside = dense.map((q) => Math.hypot(q.x - p.x, q.y - p.y) <= reach);
  if (!inside.some(Boolean)) return undefined;

  const fragments: DrawingPoint[][] = [];
  let run: DrawingPoint[] = [];
  dense.forEach((q, i) => {
    if (inside[i]) {
      if (run.length) fragments.push(run);
      run = [];
    } else {
      run.push(q);
    }
  });
  if (run.length) fragments.push(run);

  return fragments
    .filter((f) => f.length >= MIN_FRAGMENT_POINTS)
    .map((points, i) => ({ ...stroke, id: i === 0 ? stroke.id : newId('el'), points }));
}

/** Erases at one point. Returns the same page when nothing was touched. Locked and hidden objects are skipped. */
export function eraseAt(page: DrawingPage, p: DrawingPoint, radius: number): DrawingPage {
  let changed = false;
  const out: DrawingElement[] = [];
  for (const el of page.elements) {
    if (el.locked || el.hidden) { out.push(el); continue; }
    if (el.kind === 'stroke') {
      const parts = splitStroke(el, p, radius);
      if (!parts) { out.push(el); continue; }
      changed = true;
      out.push(...parts);
    } else if (hitsElement(el, p, radius)) {
      changed = true;
    } else {
      out.push(el);
    }
  }
  return changed ? { ...page, elements: out } : page;
}

/** Erases along the segment a → b so a fast drag cannot skip over thin strokes. */
export function eraseSweep(page: DrawingPage, a: DrawingPoint, b: DrawingPoint, radius: number): DrawingPage {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(len / Math.max(radius * 0.6, 1)));
  let cur = page;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    cur = eraseAt(cur, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, radius);
  }
  return cur;
}
