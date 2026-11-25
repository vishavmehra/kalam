/**
 * Deterministic reading of a drawing (docs/08 §15.4, §15.7): what a freehand stroke most likely is,
 * and the spatial cues a model would otherwise have to guess from a picture: arrows between objects,
 * repeated rows that look like a list, a title at the top, a bar along the bottom. Cues are plain
 * sentences, labelled as suggestions, and the person's own hints always win.
 */
import type { DrawingDocument, DrawingElement, DrawingPage, DrawingPoint } from '@/core/contracts';
import { boundsOfPoints, elementAABB, type Bounds } from './geometry';

export type StrokeShape = 'line' | 'box' | 'circle' | 'scribble';

const MIN_SHAPE_SIZE = 24;
const cache = new WeakMap<readonly DrawingPoint[], StrokeShape>();

/** Guesses whether a stroke is a straight line, a box, a circle or just a scribble. */
export function classifyStroke(points: readonly DrawingPoint[]): StrokeShape {
  const hit = cache.get(points);
  if (hit) return hit;
  const out = classify(points);
  cache.set(points, out);
  return out;
}

function classify(points: readonly DrawingPoint[]): StrokeShape {
  if (points.length < 2) return 'scribble';
  const b = boundsOfPoints(points);
  if (Math.hypot(b.w, b.h) < MIN_SHAPE_SIZE) return 'scribble';
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  const first = points[0]!; const last = points[points.length - 1]!;
  const gap = Math.hypot(last.x - first.x, last.y - first.y);
  if (gap / len > 0.9) return 'line';
  if (points.length < 8 || gap > 0.25 * len || b.w < 12 || b.h < 12) return 'scribble';

  const cx = b.x + b.w / 2; const cy = b.y + b.h / 2; const rx = b.w / 2; const ry = b.h / 2;
  const minSide = Math.min(b.w, b.h);
  const edgeReach = minSide * 0.12;
  const onEdge = [0, 0, 0, 0]; // left, right, top, bottom
  const sectors = new Set<number>();
  let box = 0; let circle = 0;
  for (const p of points) {
    circle += Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1);
    const dl = Math.abs(p.x - b.x); const dr = Math.abs(p.x - b.x - b.w);
    const dt = Math.abs(p.y - b.y); const db = Math.abs(p.y - b.y - b.h);
    box += Math.min(dl, dr, dt, db) / minSide;
    if (dl <= edgeReach) onEdge[0]! += 1;
    if (dr <= edgeReach) onEdge[1]! += 1;
    if (dt <= edgeReach) onEdge[2]! += 1;
    if (db <= edgeReach) onEdge[3]! += 1;
    sectors.add(Math.floor(((Math.atan2(p.y - cy, p.x - cx) + Math.PI) / (2 * Math.PI)) * 8) % 8);
  }
  box /= points.length; circle /= points.length;
  // A real box touches all four sides; a real circle goes all the way round.
  const allSides = onEdge.every((n) => n / points.length >= 0.1);
  if (box < 0.08 && box <= circle && allSides) return 'box';
  if (circle < 0.12 && sectors.size >= 7) return 'circle';
  return 'scribble';
}

// ── Layout cues ─────────────────────────────────────────────────────────────────────────────────

const NEAR_PX = 60;
const MAX_NOTES = 24;

interface Item { el: DrawingElement; b: Bounds; label: string }

function distanceToBounds(p: DrawingPoint, b: Bounds): number {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

function nameOf(el: DrawingElement): string {
  switch (el.kind) {
    case 'stamp': return el.label?.trim() || el.component;
    case 'text': return el.text.trim().split('\n')[0]!.slice(0, 40);
    case 'image': return el.alt?.trim() || 'photo';
    case 'stroke': return 'sketch';
    case 'ellipse': return 'circle';
    case 'rect': return 'box';
    default: return el.kind;
  }
}

function itemsOf(page: DrawingPage): Item[] {
  const raw = page.elements.filter((el) => !el.hidden && el.kind !== 'arrow' && el.kind !== 'line' && (el.kind !== 'stroke' || classifyStroke(el.points) !== 'scribble'));
  const texts = raw.filter((el): el is Extract<DrawingElement, { kind: 'text' }> => el.kind === 'text');
  return raw.map((el) => {
    const b = elementAABB(el);
    let label = nameOf(el);
    if (el.kind === 'rect' || el.kind === 'ellipse' || el.kind === 'stroke') {
      const inside = texts.find((t) => { const tb = elementAABB(t); const cx = tb.x + tb.w / 2; const cy = tb.y + tb.h / 2; return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h; });
      if (inside) label = nameOf(inside);
    }
    return { el, b, label };
  });
}

const similar = (a: number, b: number, tol = 0.12) => Math.abs(a - b) <= Math.max(a, b) * tol + 2;

/** Groups of three or more same-sized objects sharing a left edge (a column) or a top edge (a row). */
function repeats(items: Item[], axis: 'column' | 'row'): Item[][] {
  const used = new Set<Item>();
  const groups: Item[][] = [];
  const boxes = items.filter((i) => i.el.kind !== 'text' && i.b.w >= 20 && i.b.h >= 12);
  for (const seed of boxes) {
    if (used.has(seed)) continue;
    const group = boxes.filter((o) => !used.has(o) && similar(o.b.w, seed.b.w) && similar(o.b.h, seed.b.h)
      && (axis === 'column' ? Math.abs(o.b.x - seed.b.x) <= 8 : Math.abs(o.b.y - seed.b.y) <= 8));
    if (group.length >= 3) { group.forEach((g) => used.add(g)); groups.push(group); }
  }
  return groups;
}

function pageNotes(page: DrawingPage, no: number): string[] {
  const notes: string[] = [];
  const items = itemsOf(page);
  const at = (p: DrawingPoint) => {
    let best: { item: Item; d: number } | undefined;
    for (const item of items) {
      const d = distanceToBounds(p, item.b);
      if (d <= NEAR_PX && (!best || d < best.d)) best = { item, d };
    }
    return best?.item;
  };

  for (const el of page.elements) {
    if (el.hidden || el.kind !== 'arrow') continue;
    const from = at({ x: el.x, y: el.y }); const to = at({ x: el.x + el.w, y: el.y + el.h });
    if (from && to && from !== to) notes.push(`Page ${no}: an arrow points from "${from.label}" to "${to.label}".`);
    else if (to && !from) notes.push(`Page ${no}: an arrow points to "${to.label}".`);
  }

  for (const g of repeats(items, 'column')) notes.push(`Page ${no}: ${g.length} similar items are stacked in a column, which looks like a list.`);
  for (const g of repeats(items, 'row')) notes.push(`Page ${no}: ${g.length} similar items sit side by side in a row, like tabs or buttons.`);

  const top = items.filter((i) => i.b.y + i.b.h <= 110 && i.label).sort((a, b) => a.b.y - b.b.y)[0];
  if (top && (top.el.kind === 'text' || top.el.kind === 'stamp')) notes.push(`Page ${no}: "${top.label}" sits at the top, like a screen title.`);

  const bottom = items.filter((i) => i.b.y >= page.height - 130 && i.el.kind !== 'text');
  if (bottom.length >= 3 && bottom.every((i) => Math.abs(i.b.y - bottom[0]!.b.y) <= 16)) {
    notes.push(`Page ${no}: ${bottom.length} items run along the bottom edge, like a navigation bar.`);
  }
  return notes;
}

/** Plain-language spatial cues for the compiler. Suggestions only; empty when the drawing has none. */
export function describeLayout(doc: DrawingDocument): string[] {
  return doc.pages.flatMap((page, i) => pageNotes(page, i + 1)).slice(0, MAX_NOTES);
}
