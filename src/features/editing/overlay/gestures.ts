/**
 * Edit-by-drawing gesture classification (pure, no AI; docs/04 §12.5, docs/00 §9.4).
 *
 * One stroke becomes a tap, circle, line, arrow, scribble or free stroke. A follow-up stroke can
 * complete it: two crossing lines make a cross, and a short stroke at one end of a line makes an
 * arrow head. Thresholds are in overlay pixels and tuned for finger and mouse drawing.
 */
import {
  angleBetween, boundsOf, diagonal, dist, pathLength, resample, totalTurning, turns, unionRect,
  type Point, type Rect,
} from './geometry';

export interface InkPoint extends Point {
  /** Milliseconds (any clock); only differences matter. */
  t?: number;
}

export type StrokeShape =
  | { kind: 'tap'; at: Point }
  | { kind: 'circle'; loop: Point[]; bounds: Rect }
  | { kind: 'line'; from: Point; to: Point }
  /** Head at `to`. */
  | { kind: 'arrow'; from: Point; to: Point }
  | { kind: 'scribble'; points: Point[]; bounds: Rect }
  | { kind: 'free'; points: Point[]; bounds: Rect };

export type MarkGesture =
  | StrokeShape
  | { kind: 'cross'; at: Point; lines: [[Point, Point], [Point, Point]]; bounds: Rect };

const SAMPLES = 64;
const DEG = Math.PI / 180;

function dedupe(input: readonly InkPoint[]): Point[] {
  const out: Point[] = [];
  for (const p of input) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** A straight shaft followed by a short hook that turns back on itself: "→" drawn in one go. */
function looksLikeArrow(pts: readonly Point[], total: number): boolean {
  const first = pts[0] as Point;
  for (let j = pts.length - 2; j >= Math.floor(pts.length / 2); j--) {
    const shaftLen = pathLength(pts.slice(0, j + 1));
    if (shaftLen < 40) return false;
    const tip = pts[j] as Point;
    if (dist(first, tip) / shaftLen < 0.92) continue;
    // Longest straight start found: the rest must be a small barb pointing back.
    const tail = pts.slice(j);
    const tailLen = pathLength(tail);
    if (tailLen < 0.05 * total || tailLen > 0.6 * shaftLen) return false;
    let far = tip;
    for (const p of tail) if (dist(p, tip) > dist(far, tip)) far = p;
    if (dist(far, tip) < 6) return false;
    return angleBetween({ x: tip.x - first.x, y: tip.y - first.y }, { x: far.x - tip.x, y: far.y - tip.y }) >= 110 * DEG;
  }
  return false;
}

/** Number of separate sharp reversals (runs of samples turning more than ~115°). */
function reversals(pts: readonly Point[]): number {
  let runs = 0;
  let inRun = false;
  for (const t of turns(pts, 2)) {
    const sharp = Math.abs(t) > 2.0;
    if (sharp && !inRun) runs++;
    inRun = sharp;
  }
  return runs;
}

export function classifyStroke(input: readonly InkPoint[]): StrokeShape {
  const raw = dedupe(input);
  const start = raw[0];
  if (!start) return { kind: 'tap', at: { x: 0, y: 0 } };
  const end = raw[raw.length - 1] as Point;
  const length = pathLength(raw);
  const box = boundsOf(raw);
  const size = diagonal(box);
  if (length < 10 && size < 14) {
    return { kind: 'tap', at: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
  }
  const pts = resample(raw, SAMPLES);
  if (looksLikeArrow(pts, length)) {
    // Barbs point back toward the start, so the tip is the drawn point farthest from it.
    let tip = start;
    for (const p of raw) if (dist(p, start) > dist(tip, start)) tip = p;
    return { kind: 'arrow', from: start, to: tip };
  }
  if (length >= 24 && dist(start, end) / length >= 0.9) return { kind: 'line', from: start, to: end };

  const { signed, absolute } = totalTurning(pts);
  const flatness = Math.min(box.width, box.height) / Math.max(box.width, box.height, 1);
  if (Math.abs(signed) >= 1.45 * Math.PI && dist(start, end) <= Math.max(36, 0.45 * size) && flatness >= 0.1 && length >= 40) {
    return { kind: 'circle', loop: pts, bounds: box };
  }
  if (absolute >= 5 * Math.PI && Math.abs(signed) <= 0.6 * absolute && reversals(pts) >= 3) {
    return { kind: 'scribble', points: pts, bounds: box };
  }
  return { kind: 'free', points: pts, bounds: box };
}

/** Points that describe a mark, for proximity checks. */
export function markPoints(g: MarkGesture): Point[] {
  switch (g.kind) {
    case 'tap': return [g.at];
    case 'line': case 'arrow': return [g.from, g.to];
    case 'circle': return g.loop;
    case 'cross': return [...g.lines[0], ...g.lines[1]];
    case 'scribble': case 'free': return g.points;
  }
}

/** Where two segments cross, with the position along each (0..1). */
function crossing(a1: Point, a2: Point, b1: Point, b2: Point): { at: Point; t: number; u: number } | undefined {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (d === 0) return undefined;
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return undefined;
  return { at: { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) }, t, u };
}

const nearest = (pts: readonly Point[], target: Point) => Math.min(...pts.map((p) => dist(p, target)));

/**
 * Joins a follow-up stroke to the previous mark when together they mean one thing. Returns
 * undefined when `next` starts a new mark. The caller only asks for strokes drawn close in time.
 */
export function combineStrokes(prev: MarkGesture, next: StrokeShape): MarkGesture | undefined {
  if (prev.kind === 'line' && next.kind === 'line') {
    const c = crossing(prev.from, prev.to, next.from, next.to);
    const angle = angleBetween({ x: prev.to.x - prev.from.x, y: prev.to.y - prev.from.y }, { x: next.to.x - next.from.x, y: next.to.y - next.from.y });
    const interior = c && c.t > 0.15 && c.t < 0.85 && c.u > 0.15 && c.u < 0.85;
    if (c && interior && Math.min(angle, Math.PI - angle) >= 30 * DEG) {
      return {
        kind: 'cross', at: c.at, lines: [[prev.from, prev.to], [next.from, next.to]],
        bounds: unionRect(boundsOf([prev.from, prev.to]), boundsOf([next.from, next.to])),
      };
    }
  }
  if (prev.kind === 'line' || prev.kind === 'arrow') {
    const len = dist(prev.from, prev.to);
    const pts = markPoints(next);
    const small = diagonal(boundsOf(pts)) <= Math.max(60, 0.5 * len);
    const tol = Math.max(20, 0.2 * len);
    if (small && prev.kind === 'arrow') return nearest(pts, prev.to) <= tol ? prev : undefined; // second barb
    if (small && prev.kind === 'line') {
      const toEnd = nearest(pts, prev.to);
      const toStart = nearest(pts, prev.from);
      if (toEnd <= tol && toEnd <= toStart) return { kind: 'arrow', from: prev.from, to: prev.to };
      if (toStart <= tol) return { kind: 'arrow', from: prev.to, to: prev.from };
    }
  }
  return undefined;
}
