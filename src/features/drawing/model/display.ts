/**
 * Converts drawing elements into a small, renderer-neutral display list. The web canvas
 * (Canvas 2D) and Android canvas (Skia) both draw these primitives, so a stroke or stamp looks
 * identical on every platform and in exported PNGs.
 */
import { getStroke } from 'perfect-freehand';
import type { DrawingElement, DrawingPage } from '@/core/contracts';
import { luminance } from '@/design/color';
import { palette } from '@/design/tokens';
import { DEFAULT_PAGE_COLOR, GRID_STEP, STAMP_COLORS } from './constants';
import type { StampComponent } from './document';
import { centreOf, elementBounds, normalizeBox, storesRotation, type Bounds } from './geometry';
import { arrowHeadLength, drawnRadius, propsOf, type FontChoice } from './properties';
import { getSpatialIndex, SPATIAL_MIN } from './spatial-index';

export type Primitive =
  | { t: 'path'; d: string; fill?: string; stroke?: string; width?: number; opacity?: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; r?: number; fill?: string; stroke?: string; width?: number; dash?: boolean }
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: string; stroke?: string; width?: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number; dash?: boolean }
  | { t: 'text'; x: number; y: number; text: string; size: number; color: string; bold?: boolean; align?: 'left' | 'center'; font?: FontChoice }
  /** Placed image: bitmap bytes come from the BlobRepository through the platform image cache. */
  | { t: 'image'; blobId: string; x: number; y: number; w: number; h: number }
  /** Everything until the matching `pop` is rotated `rot` degrees about (cx, cy). */
  | { t: 'push'; cx: number; cy: number; rot: number }
  | { t: 'pop' };

const INK = STAMP_COLORS.ink;
const SOFT = STAMP_COLORS.soft;
const MUTED = STAMP_COLORS.muted;
const PRIMARY = STAMP_COLORS.primary;
const ON_PRIMARY = STAMP_COLORS.onPrimary;

const avg = (a: number, b: number) => (a + b) / 2;

/** perfect-freehand outline → SVG path (quadratic smoothing between outline points). */
export function outlineToSvgPath(points: number[][]): string {
  const len = points.length;
  if (len < 4) {
    if (len === 0) return '';
    return `M${points.map((p) => `${p[0]!.toFixed(2)},${p[1]!.toFixed(2)}`).join(' L')} Z`;
  }
  let a = points[0]!; let b = points[1]!; const c = points[2]!;
  let d = `M${a[0]!.toFixed(2)},${a[1]!.toFixed(2)} Q${b[0]!.toFixed(2)},${b[1]!.toFixed(2)} ${avg(b[0]!, c[0]!).toFixed(2)},${avg(b[1]!, c[1]!).toFixed(2)} T`;
  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i]!; b = points[i + 1]!;
    d += `${avg(a[0]!, b[0]!).toFixed(2)},${avg(a[1]!, b[1]!).toFixed(2)} `;
  }
  return `${d}Z`;
}

const STROKE_STYLE = {
  pen: { thinning: 0.6, opacity: 1, scale: 1 },
  marker: { thinning: 0.05, opacity: 1, scale: 1.6 },
  highlighter: { thinning: 0, opacity: 0.32, scale: 3 },
} as const;

function strokePrimitive(el: Extract<DrawingElement, { kind: 'stroke' }>, complete: boolean): Primitive {
  const style = STROKE_STYLE[el.tool];
  const hasPressure = el.points.some((p) => p.pressure !== undefined && p.pressure !== 0.5 && p.pressure > 0);
  const outline = getStroke(
    el.points.map((p) => [p.x, p.y, p.pressure ?? 0.5]),
    {
      size: el.size * style.scale,
      thinning: style.thinning,
      smoothing: 0.5,
      streamline: 0.45,
      simulatePressure: el.tool === 'pen' && !hasPressure,
      last: complete,
    },
  );
  return { t: 'path', d: outlineToSvgPath(outline), fill: el.color, opacity: style.opacity };
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number, color: string, len: number): Primitive[] {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  return [-1, 1].map((s) => ({
    t: 'line' as const,
    x1: x2, y1: y2,
    x2: x2 - len * Math.cos(angle + (s * Math.PI) / 7),
    y2: y2 - len * Math.sin(angle + (s * Math.PI) / 7),
    stroke: color, width: size,
  }));
}

/** Wireframe for each component stamp: recognisable to people and to vision models. */
function stampPrimitives(el: Extract<DrawingElement, { kind: 'stamp' }>): Primitive[] {
  const { x, y, w, h } = normalizeBox(el);
  const label = el.label ?? '';
  const component = el.component as StampComponent;
  switch (component) {
    case 'heading':
      return [{ t: 'text', x, y: y + h / 2 - 13, text: label || 'Heading', size: 24, color: INK, bold: true }];
    case 'textInput':
      return [
        { t: 'text', x, y, text: label || 'Field', size: 14, color: MUTED },
        { t: 'rect', x, y: y + 22, w, h: Math.max(28, h - 22), r: 8, fill: STAMP_COLORS.field, stroke: INK, width: 1.5 },
      ];
    case 'bigButton':
      return [
        { t: 'rect', x, y, w, h, r: 12, fill: PRIMARY },
        { t: 'text', x: x + w / 2, y: y + h / 2 - 9, text: label || 'Button', size: 17, color: ON_PRIMARY, bold: true, align: 'center' },
      ];
    case 'list': {
      const rows = Math.max(1, Math.min(6, Math.floor((h - 28) / 40)));
      const out: Primitive[] = [{ t: 'text', x, y, text: label || 'List', size: 14, color: MUTED }];
      for (let i = 0; i < rows; i++) {
        const ry = y + 24 + i * 40;
        out.push({ t: 'rect', x, y: ry, w, h: 34, r: 8, fill: SOFT, stroke: INK, width: 1 });
        out.push({ t: 'line', x1: x + 12, y1: ry + 17, x2: x + w * 0.55, y2: ry + 17, stroke: INK, width: 2 });
      }
      return out;
    }
    case 'stat':
      return [
        { t: 'rect', x, y, w, h, r: 12, fill: SOFT, stroke: INK, width: 1.5 },
        { t: 'text', x: x + 12, y: y + 10, text: label || 'Total', size: 13, color: MUTED },
        { t: 'text', x: x + 12, y: y + h - 44, text: '123', size: 30, color: INK, bold: true },
      ];
    case 'photo':
      return [
        { t: 'rect', x, y, w, h, r: 10, fill: STAMP_COLORS.placeholder, stroke: INK, width: 1.5, dash: true },
        { t: 'ellipse', cx: x + w * 0.3, cy: y + h * 0.35, rx: Math.min(w, h) * 0.08, ry: Math.min(w, h) * 0.08, stroke: INK, width: 1.5 },
        { t: 'line', x1: x + w * 0.15, y1: y + h * 0.8, x2: x + w * 0.45, y2: y + h * 0.5, stroke: INK, width: 1.5 },
        { t: 'line', x1: x + w * 0.45, y1: y + h * 0.5, x2: x + w * 0.85, y2: y + h * 0.8, stroke: INK, width: 1.5 },
        { t: 'text', x: x + w / 2, y: y + h - 22, text: label || 'Photo', size: 13, color: MUTED, align: 'center' },
      ];
    case 'toggle': {
      const tw = 48; const th = 28;
      return [
        { t: 'text', x, y: y + h / 2 - 9, text: label || 'Toggle', size: 16, color: INK },
        { t: 'rect', x: x + w - tw, y: y + h / 2 - th / 2, w: tw, h: th, r: th / 2, fill: PRIMARY },
        { t: 'ellipse', cx: x + w - th / 2, cy: y + h / 2, rx: th / 2 - 4, ry: th / 2 - 4, fill: ON_PRIMARY },
      ];
    }
    default:
      return [{ t: 'rect', x, y, w, h, r: 8, stroke: INK, width: 1.5, dash: true }];
  }
}

const cache = new WeakMap<DrawingElement, Primitive[]>();

function basePrimitives(el: DrawingElement, complete: boolean): Primitive[] {
  switch (el.kind) {
    case 'stroke':
      return el.points.length ? [strokePrimitive(el, complete)] : [];
    case 'rect': {
      const n = normalizeBox(el);
      const fill = propsOf(el).fill;
      return [{ t: 'rect', x: n.x, y: n.y, w: n.w, h: n.h, r: drawnRadius(el, n.w, n.h), ...(fill ? { fill } : {}), stroke: el.color, width: el.size }];
    }
    case 'ellipse': {
      const n = normalizeBox(el);
      const fill = propsOf(el).fill;
      return [{ t: 'ellipse', cx: n.x + n.w / 2, cy: n.y + n.h / 2, rx: n.w / 2, ry: n.h / 2, ...(fill ? { fill } : {}), stroke: el.color, width: el.size }];
    }
    case 'line':
      return [{ t: 'line', x1: el.x, y1: el.y, x2: el.x + el.w, y2: el.y + el.h, stroke: el.color, width: el.size }];
    case 'arrow':
      return [
        { t: 'line', x1: el.x, y1: el.y, x2: el.x + el.w, y2: el.y + el.h, stroke: el.color, width: el.size },
        ...arrowHead(el.x, el.y, el.x + el.w, el.y + el.h, el.size, el.color, arrowHeadLength(el, el.size)),
      ];
    case 'text': {
      const { font, bold } = propsOf(el);
      return el.text.split('\n').map((line, i) => ({
        t: 'text' as const, x: el.x, y: el.y + i * el.fontSize * 1.25, text: line, size: el.fontSize, color: el.color,
        ...(font && font !== 'sans' ? { font } : {}), ...(bold ? { bold: true } : {}),
      }));
    }
    case 'stamp':
      return stampPrimitives(el);
    case 'image': {
      const n = normalizeBox(el);
      return [{ t: 'image', blobId: el.blobId, x: n.x, y: n.y, w: n.w, h: n.h }];
    }
  }
}

/** Primitives for one element, rotation included. Elements are immutable, so results are memoised per object. */
export function elementPrimitives(el: DrawingElement, complete = true): Primitive[] {
  const hit = complete ? cache.get(el) : undefined;
  if (hit) return hit;
  let out = basePrimitives(el, complete);
  if (out.length && storesRotation(el) && el.rotation) {
    const c = centreOf(elementBounds(el));
    out = [{ t: 'push', cx: c.x, cy: c.y, rot: el.rotation }, ...out, { t: 'pop' }];
  }
  if (complete) cache.set(el, out);
  return out;
}

// ── Page background ───────────────────────────────────────────────────────────────────────────

function gridPath(w: number, h: number, step: number): string {
  let d = '';
  for (let x = step; x < w; x += step) d += `M${x} 0V${h}`;
  for (let y = step; y < h; y += step) d += `M0 ${y}H${w}`;
  return d;
}

function dotsPath(w: number, h: number, step: number, r: number): string {
  let d = '';
  for (let y = step; y < h; y += step) {
    for (let x = step; x < w; x += step) d += `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  }
  return d;
}

/** Light paper gets the soft notebook rule; a dark custom colour gets a mid grey so the pattern still shows. */
export function patternColor(paper: string): string {
  return luminance(paper) < 0.35 ? palette.neutral[500] : palette.brand.rule;
}

const backdropCache = new Map<string, Primitive[]>();

/** Paper fill plus the optional grid or dots (docs/08 §11.2). Shared by the canvas, thumbnails and exports. */
export function backdrop(page: Pick<DrawingPage, 'width' | 'height' | 'background' | 'backgroundColor'>): Primitive[] {
  const paper = page.backgroundColor ?? DEFAULT_PAGE_COLOR;
  const pattern = page.background ?? 'plain';
  const key = `${page.width}x${page.height}|${paper}|${pattern}`;
  const hit = backdropCache.get(key);
  if (hit) return hit;
  const out: Primitive[] = [{ t: 'rect', x: 0, y: 0, w: page.width, h: page.height, fill: paper }];
  if (pattern === 'grid') out.push({ t: 'path', d: gridPath(page.width, page.height, GRID_STEP), stroke: patternColor(paper), width: 1 });
  if (pattern === 'dots') out.push({ t: 'path', d: dotsPath(page.width, page.height, GRID_STEP, 1.2), fill: patternColor(paper) });
  if (backdropCache.size > 64) backdropCache.clear();
  backdropCache.set(key, out);
  return out;
}

/** Background plus every visible element in stacking order. `skip` leaves out elements drawn elsewhere. */
export function pagePrimitives(page: DrawingPage, skip?: ReadonlyMap<string, unknown>): Primitive[] {
  const out: Primitive[] = [...backdrop(page)];
  for (const el of page.elements) {
    if (el.hidden || skip?.has(el.id)) continue;
    out.push(...elementPrimitives(el));
  }
  return out;
}

/**
 * Like `pagePrimitives`, but only the elements that touch `view` (document space). On a page with many
 * objects zoomed in, most of them are off screen; the spatial index finds the few that are not
 * (docs/08 §17.2). Small pages skip the index, since drawing everything is as cheap as looking up.
 */
export function pagePrimitivesIn(page: DrawingPage, view: Bounds, skip?: ReadonlyMap<string, unknown>): Primitive[] {
  if (page.elements.length < SPATIAL_MIN) return pagePrimitives(page, skip);
  const out: Primitive[] = [...backdrop(page)];
  const index = getSpatialIndex(page.elements);
  for (const i of index.query(view)) {
    const el = page.elements[i]!;
    if (el.hidden || skip?.has(el.id)) continue;
    out.push(...elementPrimitives(el));
  }
  return out;
}
