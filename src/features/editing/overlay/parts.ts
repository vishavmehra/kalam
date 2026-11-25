/** Joins measured rects with the spec: which screen is showing and which of its parts can be marked. */
import type { KalamScreen, KalamSpec } from '@/core/spec/schema';
import type { Rect } from './geometry';
import type { Part } from './hit-test';

/** The runtime renders one screen at a time: the screen with the most measured parts is it. */
export function shownScreen(spec: KalamSpec, rects: ReadonlyMap<string, Rect>): KalamScreen | undefined {
  let best: KalamScreen | undefined;
  let count = 0;
  for (const s of spec.screens) {
    const n = s.children.reduce((sum, c) => sum + (rects.has(c.id) ? 1 : 0), 0);
    if (n > count) {
      best = s;
      count = n;
    }
  }
  return best;
}

/** Measured parts of `screen` that are at least partly inside the overlay, in screen order. */
export function visibleParts(screen: KalamScreen | undefined, rects: ReadonlyMap<string, Rect>, height: number): Part[] {
  if (!screen) return [];
  const out: Part[] = [];
  for (const c of screen.children) {
    const rect = rects.get(c.id);
    if (rect && rect.y + rect.height > 0 && (height <= 0 || rect.y < height)) out.push({ id: c.id, rect });
  }
  return out;
}
