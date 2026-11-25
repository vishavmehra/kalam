/**
 * A uniform-grid index over element boxes (docs/08 §17.2). Hit tests, marquee selection and off-screen
 * culling ask "which objects are near here" instead of walking all 500. Elements are immutable, so an
 * index is built once per `elements` array and reused until the page changes.
 *
 * ponytail: a fixed 80 px grid. A page is 400 x 800 and objects are small, so cells hold a handful each.
 * Move to an R-tree only if pages grow far beyond the 500 object cap.
 */
import type { DrawingElement, DrawingPage, DrawingPoint } from '@/core/contracts';
import { boundsIntersect, elementAABB, hitsElement, hitTest, type Bounds } from './geometry';
import { MAX_HEAD } from './properties';

/** Below this many objects a straight loop is as fast as a lookup, so the index is skipped. */
export const SPATIAL_MIN = 48;
const CELL = 80;
/** An element covering more cells than this is kept in a short list that every query checks. */
const MAX_CELLS_PER_ELEMENT = 400;
const MAX_QUERY_CELLS = 4096;
const LIMIT = 1_048_576;

export interface SpatialIndex {
  readonly size: number;
  /** Indices into the element array (ascending, so bottom to top) of objects whose padded box touches `rect`. */
  query(rect: Bounds): number[];
}

/** Room around a box for stroke width and arrow heads, so a query never misses a visible edge. */
function reach(el: DrawingElement): number {
  const size = 'size' in el ? el.size : 0;
  return size / 2 + 2 + (el.kind === 'arrow' ? MAX_HEAD : 0);
}

const cellOf = (v: number): number => Math.max(-LIMIT, Math.min(LIMIT - 1, Math.floor(v / CELL)));
const keyOf = (cx: number, cy: number): number => (cx + LIMIT) * (2 * LIMIT) + (cy + LIMIT);

export function buildSpatialIndex(elements: readonly DrawingElement[]): SpatialIndex {
  const cells = new Map<number, number[]>();
  const oversized: number[] = [];
  const boxes: Bounds[] = [];
  elements.forEach((el, i) => {
    const b = elementAABB(el);
    const r = reach(el);
    const box: Bounds = { x: b.x - r, y: b.y - r, w: b.w + 2 * r, h: b.h + 2 * r };
    boxes.push(box);
    const x0 = cellOf(box.x); const x1 = cellOf(box.x + box.w);
    const y0 = cellOf(box.y); const y1 = cellOf(box.y + box.h);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS_PER_ELEMENT) { oversized.push(i); return; }
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = keyOf(cx, cy);
        const list = cells.get(key);
        if (list) list.push(i); else cells.set(key, [i]);
      }
    }
  });

  return {
    size: elements.length,
    query(rect) {
      const x0 = cellOf(rect.x); const x1 = cellOf(rect.x + rect.w);
      const y0 = cellOf(rect.y); const y1 = cellOf(rect.y + rect.h);
      const out: number[] = [];
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_QUERY_CELLS) {
        boxes.forEach((box, i) => { if (boundsIntersect(box, rect)) out.push(i); });
        return out;
      }
      const seen = new Set<number>();
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const list = cells.get(keyOf(cx, cy));
          if (!list) continue;
          for (const i of list) {
            if (seen.has(i)) continue;
            seen.add(i);
            if (boundsIntersect(boxes[i]!, rect)) out.push(i);
          }
        }
      }
      for (const i of oversized) if (boundsIntersect(boxes[i]!, rect)) out.push(i);
      return out.sort((a, b) => a - b);
    },
  };
}

const cache = new WeakMap<readonly DrawingElement[], SpatialIndex>();

/** The index for this exact array of elements, built on first use. */
export function getSpatialIndex(elements: readonly DrawingElement[]): SpatialIndex {
  let index = cache.get(elements);
  if (!index) {
    index = buildSpatialIndex(elements);
    cache.set(elements, index);
  }
  return index;
}

/** Same answer as `hitTest`, found through the index on busy pages. */
export function hitTestFast(page: DrawingPage, p: DrawingPoint, tolerance = 6): string | undefined {
  const els = page.elements;
  if (els.length < SPATIAL_MIN) return hitTest(page, p, tolerance);
  const near = getSpatialIndex(els).query({ x: p.x - tolerance, y: p.y - tolerance, w: tolerance * 2, h: tolerance * 2 });
  for (let k = near.length - 1; k >= 0; k--) {
    const el = els[near[k]!]!;
    if (el.hidden) continue;
    if (hitsElement(el, p, tolerance)) return el.id;
  }
  return undefined;
}

/** Same answer as `elementsInRect`, found through the index on busy pages. */
export function elementsInRectFast(page: DrawingPage, rect: Bounds): string[] {
  const els = page.elements;
  const out: string[] = [];
  const candidates = els.length < SPATIAL_MIN ? els.map((_, i) => i) : getSpatialIndex(els).query(rect);
  for (const i of candidates) {
    const el = els[i]!;
    if (el.hidden || el.locked) continue;
    if (boundsIntersect(elementAABB(el), rect)) out.push(el.id);
  }
  return out;
}
