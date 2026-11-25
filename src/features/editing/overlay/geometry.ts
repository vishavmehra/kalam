/** Small, pure 2D helpers for edit-by-drawing (overlay coordinates: px/dp from the top-left). */

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const area = (r: Rect): number => Math.max(0, r.width) * Math.max(0, r.height);
export const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export function pathLength(pts: readonly Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1] as Point, pts[i] as Point);
  return len;
}

export function boundsOf(pts: readonly Point[]): Rect {
  if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export const diagonal = (r: Rect): number => Math.hypot(r.width, r.height);

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

export function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export const rectContains = (r: Rect, p: Point, pad = 0): boolean =>
  p.x >= r.x - pad && p.x <= r.x + r.width + pad && p.y >= r.y - pad && p.y <= r.y + r.height + pad;

/** Evenly spaced resample of a polyline (the $1-recognizer step), so angles do not depend on input rate. */
export function resample(pts: readonly Point[], n: number): Point[] {
  const src = pts.map((p) => ({ x: p.x, y: p.y }));
  if (src.length < 2 || n < 2) return src;
  const step = pathLength(src) / (n - 1);
  if (step === 0) return [src[0] as Point];
  const out: Point[] = [src[0] as Point];
  let acc = 0;
  for (let i = 1; i < src.length && out.length < n; i++) {
    const a = src[i - 1] as Point;
    const b = src[i] as Point;
    const d = dist(a, b);
    if (d > 0 && acc + d >= step) {
      const t = (step - acc) / d;
      const q = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      out.push(q);
      src.splice(i, 0, q); // continue measuring from q
      acc = 0;
    } else {
      acc += d;
    }
  }
  while (out.length < n) out.push({ ...(src[src.length - 1] as Point) });
  return out;
}

/** Signed direction change (radians, -π..π) at each point, measured over `k` samples either side. */
export function turns(pts: readonly Point[], k = 2): number[] {
  const out: number[] = [];
  for (let i = k; i < pts.length - k; i++) {
    const a = pts[i - k] as Point; const b = pts[i] as Point; const c = pts[i + k] as Point;
    const a1 = Math.atan2(b.y - a.y, b.x - a.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    out.push(d);
  }
  return out;
}

/** Sum of signed turning between consecutive segments (no window): ±2π for one loop. */
export function totalTurning(pts: readonly Point[]): { signed: number; absolute: number } {
  let signed = 0;
  let absolute = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1] as Point; const b = pts[i] as Point; const c = pts[i + 1] as Point;
    if (dist(a, b) === 0 || dist(b, c) === 0) continue;
    let d = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    signed += d;
    absolute += Math.abs(d);
  }
  return { signed, absolute };
}

/** Angle (0..π) between two direction vectors. */
export function angleBetween(u: Point, v: Point): number {
  const lu = Math.hypot(u.x, u.y);
  const lv = Math.hypot(v.x, v.y);
  if (!lu || !lv) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (lu * lv))));
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Does segment a-b touch rectangle r (grown by `pad`)? */
export function segmentHitsRect(a: Point, b: Point, r: Rect, pad = 0): boolean {
  const g = { x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad };
  if (rectContains(g, a) || rectContains(g, b)) return true;
  const c = [
    { x: g.x, y: g.y }, { x: g.x + g.width, y: g.y }, { x: g.x + g.width, y: g.y + g.height }, { x: g.x, y: g.y + g.height },
  ] as const;
  for (let i = 0; i < 4; i++) {
    const p = c[i] as Point; const q = c[(i + 1) % 4] as Point;
    if (cross(a, b, p) * cross(a, b, q) <= 0 && cross(p, q, a) * cross(p, q, b) <= 0) return true;
  }
  return false;
}

export function polylineHitsRect(pts: readonly Point[], r: Rect, pad = 0): boolean {
  if (pts.length === 1) return rectContains(r, pts[0] as Point, pad);
  for (let i = 1; i < pts.length; i++) if (segmentHitsRect(pts[i - 1] as Point, pts[i] as Point, r, pad)) return true;
  return false;
}

/** Even-odd ray casting. The polygon is closed implicitly. */
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Point; const b = poly[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Share (0..1) of a grid of sample points inside `r` that fall inside the polygon. */
export function rectCoverage(r: Rect, poly: readonly Point[], grid = 5): number {
  if (poly.length < 3 || area(r) === 0) return 0;
  let hits = 0;
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const p = { x: r.x + ((i + 0.5) / grid) * r.width, y: r.y + ((j + 0.5) / grid) * r.height };
      if (pointInPolygon(p, poly)) hits++;
    }
  }
  return hits / (grid * grid);
}
