/**
 * Pure geometry for drawing elements: bounds, rotation, scaling, hit testing (docs/08 §9.2, §9.5).
 * Strokes, lines and arrows bake rotation into their points; every other kind stores `rotation`
 * (degrees, about the centre of its box) so boxes stay editable.
 */
import type { DrawingElement, DrawingPage, DrawingPoint } from '@/core/contracts';
import { graphemeCount } from '@/i18n/graphemes';
import { needsScriptFont } from './text-script';
import { propsOf, type FontChoice } from './properties';

export interface Bounds { x: number; y: number; w: number; h: number }
/** Kinds that carry x, y, w, h (everything except strokes and text). */
export type RectElement = Exclude<DrawingElement, { kind: 'stroke' | 'text' }>;
export type StrokeElement = Extract<DrawingElement, { kind: 'stroke' }>;
export type TextElement = Extract<DrawingElement, { kind: 'text' }>;

/** Kinds whose rotation is stored on the element rather than baked into points. */
export function storesRotation(el: DrawingElement): boolean {
  return el.kind === 'rect' || el.kind === 'ellipse' || el.kind === 'text' || el.kind === 'stamp' || el.kind === 'image';
}

export const MIN_FONT = 8;
export const MAX_FONT = 160;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Rect/ellipse/stamp boxes are stored normalised (non-negative w/h); lines keep direction. */
export function normalizeBox<T extends { x: number; y: number; w: number; h: number }>(el: T): T {
  return {
    ...el,
    x: el.w < 0 ? el.x + el.w : el.x,
    y: el.h < 0 ? el.y + el.h : el.y,
    w: Math.abs(el.w),
    h: Math.abs(el.h),
  };
}

/** Average glyph width as a share of the font size. Indic scripts run wider; mono is fixed width. */
const WIDTH_FACTOR: Record<FontChoice, number> = { sans: 0.56, serif: 0.54, mono: 0.6 };

/** Box of a text object. Counts user-perceived characters, so a Hindi conjunct is one, not four. */
export function textSize(text: string, fontSize: number, font: FontChoice = 'sans', bold = false): { w: number; h: number } {
  const lines = text.split('\n');
  const wide = needsScriptFont(text) ? 1.14 : 1;
  const factor = WIDTH_FACTOR[font] * wide + (bold ? 0.04 : 0);
  const longest = lines.reduce((m, l) => Math.max(m, graphemeCount(l)), 0);
  return { w: Math.max(fontSize, longest * fontSize * factor), h: lines.length * fontSize * 1.25 };
}

/** Unrotated bounds. */
export function elementBounds(el: DrawingElement): Bounds {
  switch (el.kind) {
    case 'stroke': {
      if (el.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      for (const p of el.points) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      const pad = el.size / 2;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + el.size, h: maxY - minY + el.size };
    }
    case 'text': {
      const p = propsOf(el);
      const s = textSize(el.text, el.fontSize, p.font, p.bold);
      return { x: el.x, y: el.y, w: s.w, h: s.h };
    }
    default: {
      const n = normalizeBox(el);
      return { x: n.x, y: n.y, w: n.w, h: n.h };
    }
  }
}

export const centreOf = (b: Bounds): DrawingPoint => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

export function rotatePoint(p: DrawingPoint, c: DrawingPoint, deg: number): DrawingPoint {
  if (!deg) return { x: p.x, y: p.y };
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad); const sin = Math.sin(rad);
  const dx = p.x - c.x; const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Degrees in [0, 360), rounded to 2 decimals so repeated turns do not drift. */
export function normalizeAngle(deg: number): number {
  const r = Math.round((((deg % 360) + 360) % 360) * 100) / 100;
  return r >= 360 ? 0 : r;
}

export function cornersOf(b: Bounds, rot = 0): DrawingPoint[] {
  const c = centreOf(b);
  return [
    { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h },
  ].map((p) => rotatePoint(p, c, rot));
}

/** Corners of the element's (possibly rotated) box, clockwise from top-left. */
export function elementCorners(el: DrawingElement): DrawingPoint[] {
  return cornersOf(elementBounds(el), storesRotation(el) ? el.rotation ?? 0 : 0);
}

/** Axis-aligned box that contains the element after rotation. */
export function elementAABB(el: DrawingElement): Bounds {
  const rot = storesRotation(el) ? el.rotation ?? 0 : 0;
  const b = elementBounds(el);
  if (!rot) return b;
  return boundsOfPoints(cornersOf(b, rot));
}

export function boundsOfPoints(pts: readonly DrawingPoint[]): Bounds {
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionBounds(list: readonly Bounds[]): Bounds {
  if (list.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const b of list) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function translateElement(el: DrawingElement, dx: number, dy: number): DrawingElement {
  if (dx === 0 && dy === 0) return el;
  if (el.kind === 'stroke') return { ...el, points: el.points.map((pt) => ({ ...pt, x: pt.x + dx, y: pt.y + dy })) };
  return { ...el, x: el.x + dx, y: el.y + dy };
}

/** Rotates `el` by `deg` degrees about `pivot`. Rotation of boxes is stored; strokes and lines are rewritten. */
export function rotateElement(el: DrawingElement, deg: number, pivot: DrawingPoint): DrawingElement {
  if (!deg) return el;
  switch (el.kind) {
    case 'stroke':
      return { ...el, points: el.points.map((pt) => ({ ...pt, ...rotatePoint(pt, pivot, deg) })) };
    case 'line':
    case 'arrow': {
      const a = rotatePoint({ x: el.x, y: el.y }, pivot, deg);
      const b = rotatePoint({ x: el.x + el.w, y: el.y + el.h }, pivot, deg);
      return { ...el, x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    }
    default: {
      const b = elementBounds(el);
      const c = rotatePoint(centreOf(b), pivot, deg);
      const rotation = normalizeAngle((el.rotation ?? 0) + deg);
      return { ...el, x: c.x - b.w / 2, y: c.y - b.h / 2, rotation: rotation === 0 ? undefined : rotation };
    }
  }
}

/** Scales `el` by (sx, sy) about the anchor (ox, oy). Scale factors must be positive. */
export function scaleElement(el: DrawingElement, sx: number, sy: number, ox: number, oy: number): DrawingElement {
  if (sx === 1 && sy === 1) return el;
  const fx = (x: number) => ox + (x - ox) * sx;
  const fy = (y: number) => oy + (y - oy) * sy;
  switch (el.kind) {
    case 'stroke':
      return { ...el, points: el.points.map((pt) => ({ ...pt, x: fx(pt.x), y: fy(pt.y) })) };
    case 'text': {
      const fontSize = clamp(el.fontSize * ((sx + sy) / 2), MIN_FONT, MAX_FONT);
      return { ...el, x: fx(el.x), y: fy(el.y), fontSize };
    }
    default:
      return { ...el, x: fx(el.x), y: fy(el.y), w: el.w * sx, h: el.h * sy };
  }
}

export function distToSegment(p: DrawingPoint, a: DrawingPoint, b: DrawingPoint): number {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function inBounds(p: DrawingPoint, b: Bounds, pad: number): boolean {
  return p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
}

/** Geometric hit test (docs/08 §9.2): strokes and lines by distance, boxes by area, honouring rotation. */
export function hitsElement(el: DrawingElement, point: DrawingPoint, tolerance: number): boolean {
  const p = storesRotation(el) && el.rotation ? rotatePoint(point, centreOf(elementBounds(el)), -el.rotation) : point;
  switch (el.kind) {
    case 'stroke': {
      const reach = el.size / 2 + tolerance;
      if (!inBounds(p, elementBounds(el), tolerance)) return false;
      if (el.points.length === 1) return Math.hypot(p.x - el.points[0]!.x, p.y - el.points[0]!.y) <= reach;
      for (let i = 1; i < el.points.length; i++) {
        if (distToSegment(p, el.points[i - 1]!, el.points[i]!) <= reach) return true;
      }
      return false;
    }
    case 'line':
    case 'arrow':
      return distToSegment(p, { x: el.x, y: el.y }, { x: el.x + el.w, y: el.y + el.h }) <= el.size / 2 + tolerance;
    default:
      return inBounds(p, elementBounds(el), tolerance);
  }
}

/** Topmost visible element under the point, or undefined. Locked elements can still be picked. */
export function hitTest(page: DrawingPage, p: DrawingPoint, tolerance = 6): string | undefined {
  for (let i = page.elements.length - 1; i >= 0; i--) {
    const el = page.elements[i]!;
    if (el.hidden) continue;
    if (hitsElement(el, p, tolerance)) return el.id;
  }
  return undefined;
}

/** Ids of visible, unlocked elements whose rotated box touches `rect` (marquee selection, docs/08 §9.4). */
export function elementsInRect(page: DrawingPage, rect: Bounds): string[] {
  const out: string[] = [];
  for (const el of page.elements) {
    if (el.hidden || el.locked) continue;
    if (boundsIntersect(elementAABB(el), rect)) out.push(el.id);
  }
  return out;
}
