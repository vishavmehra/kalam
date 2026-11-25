/**
 * Maps a classified mark onto the measured parts of the running app (docs/08 §16.5, docs/04 §12.5).
 * Geometry only: selection never depends on an AI model. `parts` must be in screen order and hold
 * only parts that are on screen.
 */
import type { MarkGesture } from './gestures';
import {
  area, center, dist, intersectionArea, midpoint, polylineHitsRect, rectContains, rectCoverage, segmentHitsRect,
  type Point, type Rect,
} from './geometry';

export interface Part { id: string; rect: Rect }

export type MarkIntent =
  | { kind: 'select'; targets: string[] }
  | { kind: 'remove'; targets: string[] }
  /** Place `target` just before `before` (null = at the end). */
  | { kind: 'move'; target: string; before: string | null }
  | { kind: 'relabel'; target: string }
  | { kind: 'none'; reason: 'empty' | 'no_source' | 'same_place' };

const ids = (parts: readonly Part[]) => parts.map((p) => p.id);
const none = (reason: Extract<MarkIntent, { kind: 'none' }>['reason']): MarkIntent => ({ kind: 'none', reason });

/** Smallest part under the point (grown by `pad`), so a button wins over a card around it. */
export function partAt(p: Point, parts: readonly Part[], pad = 0): Part | undefined {
  let best: Part | undefined;
  for (const part of parts) {
    if (rectContains(part.rect, p, pad) && (!best || area(part.rect) < area(best.rect))) best = part;
  }
  return best;
}

/** Is `at` before this part in reading order (above it, or left of it on the same row)? */
export function isBefore(at: Point, r: Rect): boolean {
  if (at.y < r.y) return true;
  if (at.y > r.y + r.height) return false;
  if (at.x < r.x) return true;
  if (at.x > r.x + r.width) return false;
  return at.y < r.y + r.height / 2;
}

/** The part a drop at `at` would land in front of; null means after the last part. */
export function dropSlot(at: Point, parts: readonly Part[], exclude?: string): string | null {
  for (const p of parts) if (p.id !== exclude && isBefore(at, p.rect)) return p.id;
  return null;
}

function circled(loop: readonly Point[], bounds: Rect, parts: readonly Part[], min = 0.5): MarkIntent {
  const scored = parts.map((p) => ({ p, c: rectCoverage(p.rect, loop) }));
  const inside = scored.filter((s) => s.c >= min);
  if (inside.length) return { kind: 'select', targets: inside.map((s) => s.p.id) };
  const best = scored.reduce<(typeof scored)[number] | undefined>((b, s) => (!b || s.c > b.c ? s : b), undefined);
  if (best && best.c >= 0.2) return { kind: 'select', targets: [best.p.id] };
  const mid = partAt(center(bounds), parts);
  return mid ? { kind: 'select', targets: [mid.id] } : none('empty');
}

function moved(from: Point, to: Point, parts: readonly Part[]): MarkIntent {
  const source = partAt(from, parts, 12);
  if (!source) return none('no_source');
  const before = dropSlot(to, parts, source.id);
  const order = ids(parts);
  const next = order[order.indexOf(source.id) + 1] ?? null;
  return before === next ? none('same_place') : { kind: 'move', target: source.id, before };
}

const overlapX = (a: Point, b: Point, r: Rect) =>
  Math.min(Math.max(a.x, b.x), r.x + r.width) - Math.max(Math.min(a.x, b.x), r.x);

function lined(from: Point, to: Point, parts: readonly Part[]): MarkIntent {
  const horizontal = Math.abs(to.y - from.y) <= Math.abs(to.x - from.x) * 0.58; // within ~30°
  const mid = midpoint(from, to);
  if (horizontal) {
    // Strike-through: across the middle band of a part, covering a good share of its width.
    const struck = parts.filter((p) => {
      const r = p.rect;
      return mid.y >= r.y + r.height * 0.15 && mid.y <= r.y + r.height * 0.85 && overlapX(from, to, r) >= 0.4 * r.width;
    });
    const smallest = struck.reduce<Part | undefined>((b, p) => (!b || area(p.rect) < area(b.rect) ? p : b), undefined);
    if (smallest) return { kind: 'remove', targets: [smallest.id] };
    // Underline: just below a part.
    const under = parts.find((p) => {
      const bottom = p.rect.y + p.rect.height;
      return mid.y >= bottom - 6 && mid.y <= bottom + 18 && overlapX(from, to, p.rect) >= 0.4 * p.rect.width;
    });
    if (under) return { kind: 'select', targets: [under.id] };
  }
  // A line from a part to somewhere else reads as an arrow without a head.
  const source = partAt(from, parts, 8);
  if (source && !rectContains(source.rect, to, 12) && dist(from, to) >= 32) return moved(from, to, parts);
  const crossedParts = parts.filter((p) => segmentHitsRect(from, to, p.rect));
  return crossedParts.length ? { kind: 'select', targets: ids(crossedParts) } : none('empty');
}

export function resolveMark(g: MarkGesture, parts: readonly Part[]): MarkIntent {
  switch (g.kind) {
    case 'tap': {
      const p = partAt(g.at, parts, 4);
      return p ? { kind: 'select', targets: [p.id] } : none('empty');
    }
    case 'circle':
      return circled(g.loop, g.bounds, parts);
    case 'cross': {
      const p = partAt(g.at, parts);
      if (p) return { kind: 'remove', targets: [p.id] };
      const both = parts.filter((q) => segmentHitsRect(g.lines[0][0], g.lines[0][1], q.rect) && segmentHitsRect(g.lines[1][0], g.lines[1][1], q.rect));
      return both.length ? { kind: 'remove', targets: ids(both) } : none('empty');
    }
    case 'line':
      return lined(g.from, g.to, parts);
    case 'arrow':
      return moved(g.from, g.to, parts);
    case 'scribble': {
      let best: Part | undefined;
      let score = 0;
      for (const p of parts) {
        const s = intersectionArea(p.rect, g.bounds) / Math.max(1, Math.min(area(g.bounds), area(p.rect)));
        if (s > score) {
          score = s;
          best = p;
        }
      }
      return best && score >= 0.35 ? { kind: 'relabel', target: best.id } : none('empty');
    }
    case 'free': {
      // A loose loop that never closed still circles things; otherwise pick what the stroke touches.
      const loop = circled(g.points, g.bounds, parts, 0.6);
      if (loop.kind === 'select' && parts.some((p) => rectCoverage(p.rect, g.points) >= 0.6)) return loop;
      const touched = parts.filter((p) => polylineHitsRect(g.points, p.rect, 2));
      return touched.length ? { kind: 'select', targets: ids(touched) } : none('empty');
    }
  }
}

/** A text note dropped at `at`: on a part it is about that part, otherwise it marks a spot. */
export function resolveNote(at: Point, parts: readonly Part[]): { target: string } | { before: string | null } {
  const p = partAt(at, parts);
  return p ? { target: p.id } : { before: dropSlot(at, parts) };
}
