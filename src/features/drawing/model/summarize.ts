/**
 * Deterministic drawing interpretation (docs/08 §15, docs/07 §14.5): stamps, text and shapes are
 * already structured, so Kalam hands them to the compiler directly instead of asking a model to
 * re-read them. Rasterised pages are attached separately for cloud vision when needed.
 * Hidden objects are left out. Hints a person tagged (header, nav, total, list item) travel with
 * the object and take precedence over visual inference (docs/08 §15.5).
 */
import type { DrawingDocument, DrawingElement, DrawingSummary, NormalizedImage } from '@/core/contracts';
import { elementAABB, type Bounds } from './geometry';
import { classifyStroke, describeLayout } from './interpret';

const DEFAULT_TITLE = /^Screen \d+$/;

function contains(outer: Bounds, inner: Bounds): boolean {
  const cx = inner.x + inner.w / 2;
  const cy = inner.y + inner.h / 2;
  return cx >= outer.x && cx <= outer.x + outer.w && cy >= outer.y && cy <= outer.y + outer.h;
}

const round = (b: Bounds): [number, number, number, number] =>
  [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)];

/** Reading order: top-to-bottom, then left-to-right within a 24px row band. */
function readingOrder(a: { b: Bounds }, b: { b: Bounds }): number {
  const dy = a.b.y - b.b.y;
  return Math.abs(dy) > 24 ? dy : a.b.x - b.b.x;
}

export function summarizeDrawing(doc: DrawingDocument, images: NormalizedImage[] = []): DrawingSummary {
  const elements: DrawingSummary['elements'] = [];
  const texts: string[] = [];
  const seen = new Set<string>();
  const addText = (t: string) => {
    const v = t.trim().replace(/\s+/g, ' ');
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); texts.push(v); }
  };

  doc.pages.forEach((page, index) => {
    const pageNo = index + 1;
    const title = page.title.trim();
    if (title && !DEFAULT_TITLE.test(title)) {
      elements.push({ kind: 'screen_title', label: title, page: pageNo, bbox: [0, 0, page.width, 0] });
      addText(title);
    }
    // Freehand strokes are kept when they read as a line, box or circle, or when a person tagged them.
    // Scribbles are left to the page image.
    const items = page.elements
      .filter((el) => !el.hidden && (el.kind !== 'stroke' || el.hint || classifyStroke(el.points) !== 'scribble'))
      .map((el) => ({ el, b: elementAABB(el) }))
      .sort(readingOrder);
    const textItems = items.filter((i) => i.el.kind === 'text');
    const usedTexts = new Set<string>();
    const hintOf = (el: DrawingElement) => (el.hint ? { hint: el.hint } : {});

    for (const { el, b } of items) {
      if (el.kind === 'text') continue;
      let label: string | undefined;
      if (el.kind === 'stamp') label = el.label?.trim() || undefined;
      const shape = el.kind === 'stroke' ? classifyStroke(el.points) : undefined;
      if (el.kind === 'rect' || el.kind === 'ellipse' || shape === 'box' || shape === 'circle' || (el.kind === 'stamp' && !label)) {
        // A label written inside a box describes it (docs/08 §15.7 containment).
        const inside = textItems.filter((t) => contains(b, t.b));
        if (inside.length) {
          label = inside.map((t) => (t.el.kind === 'text' ? t.el.text.trim() : '')).join(' ');
          inside.forEach((t) => usedTexts.add(t.el.id));
        }
      }
      const kind = el.kind === 'stamp' ? `stamp:${el.component}` : shape ? `stroke:${shape}` : el.kind;
      const alt = el.kind === 'image' ? el.alt?.trim() : undefined;
      const shownLabel = label ?? (alt || undefined);
      elements.push({ kind, ...(shownLabel ? { label: shownLabel } : {}), page: pageNo, bbox: round(b), ...hintOf(el) });
      if (shownLabel) addText(shownLabel);
    }
    for (const { el, b } of textItems) {
      if (el.kind !== 'text' || !el.text.trim()) continue;
      if (!usedTexts.has(el.id)) elements.push({ kind: 'text', label: el.text.trim(), page: pageNo, bbox: round(b), ...hintOf(el) });
      addText(el.text);
    }
  });

  const notes = describeLayout(doc);
  return { drawingId: doc.id, pageCount: doc.pages.length, elements, texts, ...(notes.length ? { notes } : {}), images };
}

/** True when the drawing carries anything the compiler could use. */
export function hasDrawingContent(doc: DrawingDocument): boolean {
  return doc.pages.some((p) => p.elements.some((el) => !el.hidden));
}
