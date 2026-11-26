/**
 * What the canvas draws and how pointer positions map into the document (docs/08 §4.3–§4.6).
 * `selectBase` (paper + committed objects) changes only when the page does, so Android re-records
 * its Skia picture once per edit instead of once per pointer sample; `selectOverlay` (draft stroke,
 * objects being moved, selection chrome) is small and rebuilt every frame.
 */
import type { DrawingElement, DrawingPage, DrawingPoint } from '@/core/contracts';
import {
  elementCorners, elementPrimitives, frameCorners, groupMembers, handlePositions, PAGE_HEIGHT, PAGE_WIDTH, pagePrimitives,
  pagePrimitivesIn, pointerStateOf, SELECTION_COLORS, selectionFrame, singleGroupSize, SPATIAL_MIN, STAMPS, type PointerState, type Primitive,
} from './model';
import type { StudioState, Tool, ViewTransform } from './studio-store';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function fitView(w: number, h: number): ViewTransform {
  if (w <= 0 || h <= 0) return { scale: 1, tx: 0, ty: 0 };
  const scale = clamp(Math.min((w - 32) / PAGE_WIDTH, (h - 32) / PAGE_HEIGHT), 0.2, 2);
  return { scale, tx: (w - PAGE_WIDTH * scale) / 2, ty: (h - PAGE_HEIGHT * scale) / 2 };
}

export function currentPage(s: Pick<StudioState, 'history' | 'pageId'>): DrawingPage {
  const pages = s.history.present.pages;
  return pages.find((p) => p.id === s.pageId) ?? pages[0]!;
}

const baseCache = new WeakMap<DrawingPage, Primitive[]>();

/** Paper and every committed, visible object in stacking order. Same array while the page is unchanged. */
export function selectBase(s: StudioState): Primitive[] {
  const page = s.erasing ?? currentPage(s);
  if (!s.preview) {
    const hit = baseCache.get(page);
    if (hit) return hit;
    const out = pagePrimitives(page);
    baseCache.set(page, out);
    return out;
  }
  // Objects being moved, resized or turned are drawn in the overlay.
  return pagePrimitives(page, s.preview);
}

/**
 * Like `selectBase`, but only the objects on screen (docs/08 §17.2). For canvases that redraw the whole page
 * every frame, such as the web canvas. Small pages return the cached `selectBase` array. Not cached across frames.
 */
export function selectBaseVisible(s: StudioState): Primitive[] {
  const page = s.erasing ?? currentPage(s);
  if (page.elements.length < SPATIAL_MIN || s.viewport.w <= 0 || s.viewport.h <= 0) return selectBase(s);
  const { scale, tx, ty } = s.view;
  const margin = 16 / scale;
  const view = { x: -tx / scale - margin, y: -ty / scale - margin, w: s.viewport.w / scale + margin * 2, h: s.viewport.h / scale + margin * 2 };
  return pagePrimitivesIn(page, view, s.preview);
}

/** The explicit pointer state the studio is in right now (docs/08 §8.2). */
export function selectPointerState(s: StudioState): PointerState {
  return pointerStateOf(s);
}

function outline(corners: ReadonlyArray<{ x: number; y: number }>, stroke: string, width: number, dash: boolean): Primitive[] {
  return corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length]!;
    return { t: 'line' as const, x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke, width, dash };
  });
}

function selectionChrome(s: StudioState, shown: DrawingElement[]): Primitive[] {
  const scale = s.view.scale;
  const px = 1 / scale;
  const editable = shown.filter((e) => !e.locked);
  const frame = selectionFrame(editable.length ? editable : shown);
  if (!frame) return [];
  const colour = editable.length ? SELECTION_COLORS.line : SELECTION_COLORS.locked;
  const out: Primitive[] = [];
  if (shown.length > 1 && shown.length <= 40) {
    for (const el of shown) out.push(...outline(elementCorners(el), colour, px, false));
  }
  out.push(...outline(frameCorners(frame), colour, 1.5 * px, true));
  if (s.tool === 'select' && editable.length > 0 && !s.draft) {
    const handles = handlePositions(frame, scale);
    const rotate = handles.find((h) => h.id === 'rotate')!;
    const topMid = handles.find((h) => h.id === 'n')!;
    out.push({ t: 'line', x1: topMid.x, y1: topMid.y, x2: rotate.x, y2: rotate.y, stroke: colour, width: 1.5 * px });
    const hs = 11 * px;
    for (const h of handles) {
      if (h.id === 'rotate') {
        out.push({ t: 'ellipse', cx: h.x, cy: h.y, rx: hs * 0.6, ry: hs * 0.6, fill: SELECTION_COLORS.handleFill, stroke: colour, width: 1.5 * px });
      } else {
        out.push({ t: 'rect', x: h.x - hs / 2, y: h.y - hs / 2, w: hs, h: hs, r: 2 * px, fill: SELECTION_COLORS.handleFill, stroke: colour, width: 1.5 * px });
      }
    }
  }
  return out;
}

/** Objects being moved, resized or turned, plus the stroke or shape in progress. Clipped to the page. */
export function selectLive(s: StudioState): Primitive[] {
  const out: Primitive[] = [];
  if (s.preview) for (const el of s.preview.values()) out.push(...elementPrimitives(el, false));
  if (s.draft) out.push(...elementPrimitives(s.draft, false));
  return out;
}

/** Selection outline, handles and marquee. Not clipped: handles may sit outside the page. */
export function selectChrome(s: StudioState): Primitive[] {
  const page = currentPage(s);
  const out: Primitive[] = [];
  if (s.selectedIds.length) {
    const ids = new Set(s.selectedIds);
    const shown = page.elements.filter((e) => ids.has(e.id)).map((e) => s.preview?.get(e.id) ?? e);
    out.push(...selectionChrome(s, shown));
  }
  if (s.marquee) {
    const m = s.marquee;
    out.push({ t: 'rect', x: m.x, y: m.y, w: m.w, h: m.h, fill: SELECTION_COLORS.marqueeFill, stroke: SELECTION_COLORS.line, width: 1 / s.view.scale });
  }
  return out;
}

/** Everything drawn above the page. */
export function selectOverlay(s: StudioState): Primitive[] {
  return [...selectLive(s), ...selectChrome(s)];
}

/** Everything the renderer draws for the current page, in paint order. Not a React selector (returns a new array). */
export function selectPrimitives(s: StudioState): Primitive[] {
  return [...selectBase(s), ...selectOverlay(s)];
}

/** Converts a screen-space point (relative to the canvas) to document space. */
export function toDocPoint(view: ViewTransform, x: number, y: number, pressure?: number): DrawingPoint {
  const p: DrawingPoint = { x: (x - view.tx) / view.scale, y: (y - view.ty) / view.scale };
  if (pressure !== undefined && pressure > 0) p.pressure = pressure;
  return p;
}

export const TOOL_LABELS: Readonly<Record<Tool, string>> = {
  select: 'Select and move', pen: 'Pen', marker: 'Marker', highlighter: 'Highlighter', eraser: 'Eraser', rect: 'Rectangle',
  ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow', text: 'Text', stamp: 'Component stamps',
};

/** Plain name of an object plus its group, for the object list: "Rectangle, in a group of 3". */
export function describeInPage(page: DrawingPage, el: DrawingElement): string {
  const name = describeElement(el);
  if (!el.groupId) return name;
  const n = groupMembers(page, el.groupId).length;
  return n > 1 ? `${name}, in a group of ${n}` : name;
}

/** Plain name of an object for the object list and screen readers (docs/10 §10.2). */
export function describeElement(el: DrawingElement): string {
  switch (el.kind) {
    case 'stamp': return `${STAMPS.find((d) => d.component === el.component)?.name ?? 'Component'}${el.label ? `, ${el.label}` : ''}`;
    case 'stroke': return el.tool === 'highlighter' ? 'Highlight' : 'Pen stroke';
    case 'text': return `Text, ${el.text.split('\n')[0]!.slice(0, 24)}`;
    case 'rect': return 'Rectangle';
    case 'ellipse': return 'Ellipse';
    case 'line': return 'Line';
    case 'arrow': return 'Arrow';
    case 'image': return el.alt ? `Photo, ${el.alt}` : 'Photo';
  }
}

/** Spoken summary of the canvas: page, tool and selection (docs/10 §10.4). Always starts with "Drawing canvas". */
export function canvasLabel(s: StudioState): string {
  const pages = s.history.present.pages;
  const page = currentPage(s);
  const index = pages.findIndex((p) => p.id === page.id);
  const chosen = page.elements.filter((e) => s.selectedIds.includes(e.id));
  const groupSize = singleGroupSize(page, chosen);
  const sel = s.selectedIds.length
    ? s.selectedIds.length === 1
      ? ` ${describeElement(page.elements.find((e) => e.id === s.selectedIds[0]) ?? page.elements[0]!)} selected.`
      : groupSize ? ` Group of ${groupSize} objects selected.` : ` ${s.selectedIds.length} objects selected.`
    : '';
  return `Drawing canvas. Screen ${index + 1} of ${pages.length}, ${page.title}. ${TOOL_LABELS[s.tool]} tool. ${page.elements.length} objects.${sel} Keys: P pen, E eraser, V select, T text.`;
}
