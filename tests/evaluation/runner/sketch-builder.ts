/**
 * Builds real DrawingDocuments for the golden sketches from a tiny layout language (stamps + text),
 * so the evaluation sketches are exactly what the Drawing Studio produces (docs/08) and stay
 * reproducible. Pure and deterministic: same input, same document, no clock and no randomness.
 */
import type { DrawingDocument, DrawingElement, DrawingPage } from '@/core/contracts';
import type { GoldenSketchCase, SketchItem, SketchPageDef, StampName } from './types';

/**
 * Page and stamp geometry of the Drawing Studio (docs/08 §11.1). Copied on purpose: the Studio model is
 * still changing, and golden sketches must not move when it does. runner.test.ts compares these values
 * with the Studio's own STAMPS so a drift is reported, never silent.
 */
export const PAGE_WIDTH = 400;
export const PAGE_HEIGHT = 800;
export const STAMP_SIZES: Readonly<Record<StampName, { w: number; h: number; label: string }>> = {
  heading: { w: 300, h: 44, label: 'Heading' },
  textInput: { w: 320, h: 64, label: 'Name' },
  bigButton: { w: 240, h: 56, label: 'Save' },
  list: { w: 320, h: 180, label: 'Items' },
  stat: { w: 150, h: 96, label: 'Total' },
  photo: { w: 200, h: 150, label: 'Photo' },
  toggle: { w: 240, h: 44, label: 'Done' },
};

const TOP = 40;
const GAP = 16;
const SIDE = 40;
const DEFAULT_TEXT_SIZE = 18;
const DEFAULT_BOX_HEIGHT = 72;

/** Same estimate the Studio uses for text bounds (about 0.56 em per character, 1.25 line height). */
const textHeight = (text: string, fontSize: number): number => text.split('\n').length * fontSize * 1.25;
const textWidth = (text: string, fontSize: number): number =>
  Math.max(fontSize, Math.max(...text.split('\n').map((l) => l.length)) * fontSize * 0.56);

/** Stable ids so documents and diffs are reproducible. */
const elementId = (sketchId: string, page: number, n: number): string => `el_${sketchId}_p${page + 1}_${n + 1}`;

function stampSize(name: StampName): { w: number; h: number; label: string } {
  const s = STAMP_SIZES[name];
  if (!s) throw new Error(`Unknown stamp "${name}"`);
  return s;
}

function buildPage(sketchId: string, index: number, def: SketchPageDef): DrawingPage {
  const elements: DrawingElement[] = [];
  let y = TOP;
  let n = 0;
  const next = () => elementId(sketchId, index, n++);

  for (const item of def.items as SketchItem[]) {
    if ('stamp' in item) {
      const size = stampSize(item.stamp);
      elements.push({
        id: next(),
        kind: 'stamp',
        x: Math.round((PAGE_WIDTH - size.w) / 2),
        y,
        w: size.w,
        h: size.h,
        component: item.stamp,
        label: item.label ?? size.label,
      });
      y += size.h + GAP;
    } else if ('text' in item) {
      const fontSize = item.fontSize ?? DEFAULT_TEXT_SIZE;
      elements.push({ id: next(), kind: 'text', x: SIDE, y, text: item.text, color: '#1F2A24', fontSize });
      y += Math.ceil(textHeight(item.text, fontSize)) + GAP;
    } else {
      const h = item.h ?? DEFAULT_BOX_HEIGHT;
      elements.push({ id: next(), kind: item.box, x: SIDE, y, w: PAGE_WIDTH - SIDE * 2, h, color: '#1F2A24', size: 2 });
      if (item.label) {
        const th = textHeight(item.label, DEFAULT_TEXT_SIZE);
        // Centred in the box, so the Studio's "label written inside a box" rule applies (docs/08 §15.7).
        const w = Math.min(textWidth(item.label, DEFAULT_TEXT_SIZE), PAGE_WIDTH - SIDE * 2 - 28);
        elements.push({
          id: next(),
          kind: 'text',
          x: Math.round(SIDE + (PAGE_WIDTH - SIDE * 2 - w) / 2),
          y: Math.round(y + (h - th) / 2),
          text: item.label,
          color: '#1F2A24',
          fontSize: DEFAULT_TEXT_SIZE,
        });
      }
      y += h + GAP;
    }
  }
  return {
    id: `pg_${sketchId}_${index + 1}`,
    title: def.title,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    elements,
    background: 'plain',
  };
}

export function buildSketchDocument(c: Pick<GoldenSketchCase, 'id' | 'title' | 'pages'>): DrawingDocument {
  const pages = c.pages.map((p, i) => buildPage(c.id, i, p));
  return {
    id: `drw_golden_${c.id}`,
    title: c.title,
    createdAt: 0,
    updatedAt: 0,
    pages,
    schemaVersion: 1,
    activePageId: pages[0]?.id,
  };
}

const DEFAULT_PAGE_TITLE = /^Screen \d+$/;

/**
 * What the drawing summary must give back for a sketch: every page title, stamp label, text and box label, and the
 * stamp count per component. Declared values in the case win; otherwise they are read off the layout (docs/08 §15).
 */
export function expectedExtraction(c: Pick<GoldenSketchCase, 'pages' | 'expected'>): {
  labels: string[];
  stamps: Partial<Record<StampName, number>>;
} {
  const labels: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    const v = (raw ?? '').trim().replace(/\s+/g, ' ');
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      labels.push(v);
    }
  };
  const stamps: Partial<Record<StampName, number>> = {};
  for (const p of c.pages) {
    if (!DEFAULT_PAGE_TITLE.test(p.title.trim())) add(p.title);
    for (const item of p.items) {
      if ('stamp' in item) {
        add(item.label ?? STAMP_SIZES[item.stamp].label);
        stamps[item.stamp] = (stamps[item.stamp] ?? 0) + 1;
      } else if ('text' in item) add(item.text);
      else add(item.label);
    }
  }
  return { labels: c.expected.labels ?? labels, stamps: c.expected.stamps ?? stamps };
}

/** The lowest edge of any element on a page, to prove the layout fits the page (used by tests). */
export function lowestEdge(page: DrawingPage, boundsOf: (el: DrawingElement) => { y: number; h: number }): number {
  return page.elements.reduce((max, el) => {
    const b = boundsOf(el);
    return Math.max(max, b.y + b.h);
  }, 0);
}
