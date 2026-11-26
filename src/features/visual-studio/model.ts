/**
 * Pure rules for arranging parts on the running app: when a drag starts, where a drop lands, what a
 * resize drag means, and the plain noun for a part. No React, so Vitest runs it. Geometry comes from
 * the edit-by-drawing helpers (same bounds, same reading order).
 */
import { sizeOf, type StyleSize } from '@/core/edit/direct';
import type { KalamComponent } from '@/core/spec/schema';
import { STYLE_SIZES } from '@/core/spec/schema';
import { rectContains, type Point, type Rect } from '@/features/editing/overlay/geometry';
import { dropSlot, type Part } from '@/features/editing/overlay/hit-test';

/** A press that moves less than this is a tap, not a drag. */
export const DRAG_SLOP = 6;
/** Pixels of drag per size step. */
export const SIZE_STEP = 28;

export const exceedsSlop = (dx: number, dy: number): boolean => Math.hypot(dx, dy) >= DRAG_SLOP;

/** The size a resize drag of `delta` px (outward is positive) lands on, one step per SIZE_STEP, clamped. */
export function sizeFromDrag(start: StyleSize, delta: number): StyleSize {
  const i = STYLE_SIZES.indexOf(start) + Math.round(delta / SIZE_STEP);
  return STYLE_SIZES[Math.min(STYLE_SIZES.length - 1, Math.max(0, i))] as StyleSize;
}

export type DropTarget =
  | { kind: 'slot'; before: string | null }
  | { kind: 'screen'; screen: string }
  | { kind: 'none' };

export interface ScreenChip { screen: string; rect: Rect }

/** A screen chip under the pointer wins; otherwise the slot among the other parts of this screen. */
export function dropTargetAt(at: Point, parts: readonly Part[], dragged: string, chips: readonly ScreenChip[]): DropTarget {
  const chip = chips.find((c) => rectContains(c.rect, at));
  if (chip) return { kind: 'screen', screen: chip.screen };
  if (!parts.some((p) => p.id === dragged)) return { kind: 'none' };
  return { kind: 'slot', before: dropSlot(at, parts, dragged) };
}

/** The line that shows a slot: just above `before`, or just below the last other part. */
export function slotLine(parts: readonly Part[], before: string | null, dragged: string): { x: number; y: number; width: number } | undefined {
  const others = parts.filter((p) => p.id !== dragged);
  const next = before === null ? undefined : others.find((p) => p.id === before);
  if (next) return { x: next.rect.x, y: next.rect.y - 3, width: next.rect.width };
  const last = others[others.length - 1];
  return last ? { x: last.rect.x, y: last.rect.y + last.rect.height + 3, width: last.rect.width } : undefined;
}

export type Noun = 'button' | 'field' | 'list' | 'words' | 'part';

/** Everyday noun per component type (docs/00 voice: what a shopkeeper would call it). */
export function nounOf(c: KalamComponent): Noun {
  switch (c.type) {
    case 'bigButton': return 'button';
    case 'number': case 'textInput': case 'date': case 'choice': case 'toggle': case 'counter': case 'signature': return 'field';
    case 'list': return 'list';
    case 'heading': case 'text': return 'words';
    default: return 'part';
  }
}

/** The part's own words, shortened for a tag; empty when it has none. */
export function nameOf(c: KalamComponent, max = 28): string {
  const l = 'label' in c && typeof c.label === 'string' ? c.label.trim().replace(/\s+/g, ' ') : '';
  return l.length > max ? `${l.slice(0, max - 1).trimEnd()}…` : l;
}

/** Collections that hold at least one saved entry, from `db.records.listAll(appId)` (an object keyed by collection id). */
export const filledCollections = (all: Readonly<Record<string, readonly unknown[]>>): Set<string> =>
  new Set(Object.entries(all).filter(([, rows]) => rows.length > 0).map(([id]) => id));

export { sizeOf };
