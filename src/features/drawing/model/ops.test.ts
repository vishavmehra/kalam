import { describe, expect, it } from 'vitest';
import type { DrawingDocument, DrawingElement, DrawingPage } from '@/core/contracts';
import {
  addElement, addElements, addPage, applyFrame, backdrop, canAddElements, classifyStroke, clearPage, constrainDrag, createDocument, describeLayout,
  duplicateElements, duplicatePage, elementAABB, elementPrimitives, elementsInRect, eraseAt, eraseSweep, exportSize,
  frameCorners, handlePositions, hitHandle, hitsElement, hitTest, MAX_EXPORT_SIDE, MAX_PAGES, migrateDrawing,
  pageImageIds, pagePrimitives, pasteElements, pngFileName, PAGE_OBJECT_CAP, reorderElements, reorderList,
  removeElements, resizeFrame, rotateDrag, rotateElement, scaleElement, scaleSelection, selectionFrame, setFlags,
  setPageBackground, snapAngle, splitStroke, summarizeDrawing, translateElement, zipFileName, DRAWING_SCHEMA_VERSION,
} from './index';

const rect = (id: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}): DrawingElement =>
  ({ id, kind: 'rect', x, y, w, h, color: '#000000', size: 2, ...extra }) as DrawingElement;
const stroke = (id: string, pts: Array<[number, number]>, extra: Record<string, unknown> = {}): DrawingElement =>
  ({ id, kind: 'stroke', tool: 'pen', color: '#000000', size: 4, points: pts.map(([x, y]) => ({ x, y })), ...extra }) as DrawingElement;

function withElements(...els: DrawingElement[]): { doc: DrawingDocument; pid: string } {
  let doc = createDocument(1, 'd1');
  const pid = doc.pages[0]!.id;
  for (const el of els) doc = addElement(doc, pid, el);
  return { doc, pid };
}
const ids = (doc: DrawingDocument, pid = doc.pages[0]!.id) => doc.pages.find((p) => p.id === pid)!.elements.map((e) => e.id);

describe('stacking order', () => {
  it('moves selected objects as a block and keeps their relative order', () => {
    expect(reorderList(['a', 'b', 'c', 'd'], (x) => x === 'a' || x === 'b', 'forward')).toEqual(['c', 'a', 'b', 'd']);
    expect(reorderList(['a', 'b', 'c', 'd'], (x) => x === 'c' || x === 'd', 'backward')).toEqual(['a', 'c', 'd', 'b']);
    expect(reorderList(['a', 'b', 'c'], (x) => x === 'a', 'front')).toEqual(['b', 'c', 'a']);
    expect(reorderList(['a', 'b', 'c'], (x) => x === 'c', 'back')).toEqual(['c', 'a', 'b']);
  });

  it('returns the same list when nothing can move', () => {
    const list = ['a', 'b'];
    expect(reorderList(list, (x) => x === 'b', 'front')).toBe(list);
    expect(reorderList(list, (x) => x === 'a', 'back')).toBe(list);
    expect(reorderList(list, () => false, 'forward')).toBe(list);
  });

  it('reorders a page and numbers zIndex to match', () => {
    const { doc, pid } = withElements(rect('a', 0, 0, 10, 10), rect('b', 0, 0, 10, 10), rect('c', 0, 0, 10, 10));
    const next = reorderElements(doc, pid, new Set(['a']), 'front');
    expect(ids(next)).toEqual(['b', 'c', 'a']);
    expect(next.pages[0]!.elements.map((e) => e.zIndex)).toEqual([0, 1, 2]);
    expect(reorderElements(next, pid, new Set(['a']), 'front')).toBe(next);
  });

  it('stamps zIndex on new objects', () => {
    const { doc } = withElements(rect('a', 0, 0, 10, 10), rect('b', 0, 0, 10, 10));
    expect(doc.pages[0]!.elements.map((e) => e.zIndex)).toEqual([0, 1]);
  });
});

describe('lock, hide and hints', () => {
  it('sets and clears flags without touching other objects', () => {
    const { doc, pid } = withElements(rect('a', 0, 0, 10, 10), rect('b', 0, 0, 10, 10));
    const next = setFlags(doc, pid, new Set(['a']), { locked: true, hidden: true, hint: 'header' });
    const [a, b] = next.pages[0]!.elements;
    expect(a).toMatchObject({ locked: true, hidden: true, hint: 'header' });
    expect(b).toBe(doc.pages[0]!.elements[1]);
    const cleared = setFlags(next, pid, new Set(['a']), { locked: false, hidden: false, hint: null });
    expect(cleared.pages[0]!.elements[0]).toMatchObject({ locked: undefined, hidden: undefined, hint: undefined });
    expect(setFlags(doc, pid, new Set(['a']), { locked: false })).toBe(doc);
  });

  it('skips hidden objects when hit testing and rendering', () => {
    const { doc, pid } = withElements(rect('under', 0, 0, 100, 100), rect('over', 0, 0, 100, 100, { hidden: true }));
    const page = doc.pages[0]!;
    expect(hitTest(page, { x: 50, y: 50 })).toBe('under');
    const prims = pagePrimitives(page);
    expect(prims.filter((p) => p.t === 'rect')).toHaveLength(2); // paper + the visible rectangle
    expect(pid).toBeTruthy();
  });

  it('puts the hint in the drawing summary and leaves hidden objects out', () => {
    const { doc, pid } = withElements(
      { id: 't', kind: 'text', x: 20, y: 20, text: 'Tailor Book', color: '#000000', fontSize: 24, hint: 'header' },
      { id: 's', kind: 'stamp', component: 'stat', label: 'Total', x: 20, y: 600, w: 150, h: 96, hint: 'total' },
      { id: 'h', kind: 'stamp', component: 'bigButton', label: 'Secret', x: 20, y: 300, w: 200, h: 50, hidden: true },
    );
    const s = summarizeDrawing(doc);
    // Components come first, then free text.
    expect(s.elements).toEqual([
      { kind: 'stamp:stat', label: 'Total', page: 1, bbox: [20, 600, 150, 96], hint: 'total' },
      { kind: 'text', label: 'Tailor Book', page: 1, bbox: [20, 20, 148, 30], hint: 'header' },
    ]);
    expect(s.texts).not.toContain('Secret');
    expect(pid).toBeTruthy();
  });
});

describe('object cap', () => {
  it('stops adding at the cap and reports room', () => {
    let doc = createDocument(1, 'd1');
    const pid = doc.pages[0]!.id;
    doc = addElements(doc, pid, Array.from({ length: PAGE_OBJECT_CAP }, (_, i) => rect(`r${i}`, 0, 0, 5, 5)));
    expect(doc.pages[0]!.elements).toHaveLength(PAGE_OBJECT_CAP);
    expect(canAddElements(doc.pages[0]!)).toBe(false);
    expect(addElement(doc, pid, rect('extra', 0, 0, 5, 5))).toBe(doc);
    expect(duplicateElements(doc, pid, new Set(['r0'])).ids).toEqual([]);
    expect(pasteElements(doc, pid, [rect('x', 0, 0, 1, 1)]).ids).toEqual([]);
    const fewer = removeElements(doc, pid, new Set(['r0']));
    expect(canAddElements(fewer.pages[0]!)).toBe(true);
    expect(canAddElements(fewer.pages[0]!, 2)).toBe(false);
  });
});

describe('duplicate and paste', () => {
  it('copies objects with new ids, offset, unlocked, above the originals', () => {
    const { doc, pid } = withElements(rect('a', 10, 10, 50, 50, { locked: true }), stroke('s', [[0, 0], [10, 10]]), rect('z', 200, 200, 5, 5));
    const res = duplicateElements(doc, pid, new Set(['a', 's']));
    expect(res.ids).toHaveLength(2);
    const els = res.doc.pages[0]!.elements;
    expect(els).toHaveLength(5);
    const copyA = els.find((e) => e.id === res.ids[0])!;
    expect(copyA).toMatchObject({ kind: 'rect', x: 26, y: 26, locked: undefined });
    const copyS = els.find((e) => e.id === res.ids[1])!;
    expect(copyS.kind === 'stroke' && copyS.points[0]).toEqual({ x: 16, y: 16 });
    expect(els.slice(3).map((e) => e.id)).toEqual(res.ids);
    expect(ids(doc)).toEqual(['a', 's', 'z']);
  });

  it('pastes into another page and drops group membership', () => {
    const { doc, pid } = withElements(rect('a', 0, 0, 10, 10, { groupId: 'g' }));
    const clip = doc.pages[0]!.elements;
    const added = addPage(doc);
    const res = pasteElements(added.doc, added.pageId, clip, 0);
    const pasted = res.doc.pages[1]!.elements[0]!;
    expect(pasted.id).not.toBe('a');
    expect(pasted.groupId).toBeUndefined();
    expect(pid).toBeTruthy();
  });
});

describe('page operations', () => {
  it('duplicates a page after the original with new ids and keeps the background', () => {
    let { doc, pid } = withElements(rect('a', 0, 0, 10, 10, { locked: true }));
    doc = setPageBackground(doc, pid, { background: 'grid', backgroundColor: '#FFF4D6' });
    const res = duplicatePage(doc, pid);
    expect(res.pageId).toBeDefined();
    expect(res.doc.pages.map((p) => p.id)).toEqual([pid, res.pageId]);
    const copy = res.doc.pages[1]!;
    expect(copy.title).toBe('Screen 1 copy');
    expect(copy.background).toBe('grid');
    expect(copy.backgroundColor).toBe('#FFF4D6');
    expect(copy.elements[0]).toMatchObject({ kind: 'rect', locked: true });
    expect(copy.elements[0]!.id).not.toBe('a');
  });

  it('refuses to duplicate past the page limit', () => {
    let doc = createDocument(1, 'd1');
    for (let i = 0; i < MAX_PAGES; i++) doc = addPage(doc).doc;
    const res = duplicatePage(doc, doc.pages[0]!.id);
    expect(res.pageId).toBeUndefined();
    expect(res.doc).toBe(doc);
  });

  it('sets and resets the background', () => {
    const { doc, pid } = withElements();
    const dots = setPageBackground(doc, pid, { background: 'dots' });
    expect(dots.pages[0]!.background).toBe('dots');
    const colored = setPageBackground(dots, pid, { backgroundColor: '#E6E8F5' });
    expect(colored.pages[0]).toMatchObject({ background: 'dots', backgroundColor: '#E6E8F5' });
    expect(setPageBackground(colored, pid, { backgroundColor: null }).pages[0]!.backgroundColor).toBeUndefined();
    expect(setPageBackground(dots, pid, { background: 'dots' })).toBe(dots);
  });

  it('clears a page and keeps others', () => {
    const { doc, pid } = withElements(rect('a', 0, 0, 5, 5));
    expect(clearPage(doc, pid).pages[0]!.elements).toEqual([]);
    expect(clearPage(clearPage(doc, pid), pid).pages[0]!.elements).toEqual([]);
  });

  it('lists the photos a page needs', () => {
    const { doc } = withElements(
      { id: 'i1', kind: 'image', blobId: 'blob_1', x: 0, y: 0, w: 10, h: 10 },
      { id: 'i2', kind: 'image', blobId: 'blob_2', x: 0, y: 0, w: 10, h: 10, hidden: true },
    );
    expect(pageImageIds(doc.pages[0]!)).toEqual(['blob_1']);
  });
});

describe('rotation, scaling and bounds', () => {
  it('rotates a box about its own centre without moving it', () => {
    const r = rotateElement(rect('a', 0, 0, 100, 50), 90, { x: 50, y: 25 });
    expect(r).toMatchObject({ x: 0, y: 0, w: 100, h: 50, rotation: 90 });
    const aabb = elementAABB(r);
    expect(aabb.x).toBeCloseTo(25); expect(aabb.y).toBeCloseTo(-25);
    expect(aabb.w).toBeCloseTo(50); expect(aabb.h).toBeCloseTo(100);
  });

  it('bakes rotation into strokes and lines', () => {
    const s = rotateElement(stroke('s', [[10, 0], [20, 0]]), 90, { x: 0, y: 0 });
    expect(s.kind === 'stroke' && s.points[0]!.x).toBeCloseTo(0);
    expect(s.kind === 'stroke' && s.points[0]!.y).toBeCloseTo(10);
    expect(s.rotation).toBeUndefined();
    const l = rotateElement({ id: 'l', kind: 'line', x: 10, y: 0, w: 10, h: 0, color: '#000000', size: 2 }, 90, { x: 0, y: 0 });
    if (l.kind !== 'line') throw new Error('expected a line');
    expect(l.x).toBeCloseTo(0); expect(l.y).toBeCloseTo(10); expect(l.w).toBeCloseTo(0); expect(l.h).toBeCloseTo(10);
  });

  it('turns back to zero and drops the stored rotation', () => {
    const turned = rotateElement(rect('a', 0, 0, 10, 10), 30, { x: 5, y: 5 });
    const back = rotateElement(turned, -30, { x: 5, y: 5 });
    expect(back.rotation).toBeUndefined();
  });

  it('hit tests rotated boxes in their own frame', () => {
    const r = rotateElement(rect('a', 0, 0, 100, 20), 90, { x: 50, y: 10 }); // now tall: x 40..60, y -40..60
    expect(hitsElement(r, { x: 50, y: 50 }, 0)).toBe(true);
    expect(hitsElement(r, { x: 10, y: 10 }, 0)).toBe(false);
  });

  it('scales about an anchor', () => {
    const r = scaleElement(rect('a', 10, 10, 20, 20), 2, 0.5, 10, 10);
    expect(r).toMatchObject({ x: 10, y: 10, w: 40, h: 10 });
    const t = scaleElement({ id: 't', kind: 'text', x: 0, y: 0, text: 'Hi', color: '#000000', fontSize: 20 }, 2, 2, 0, 0);
    expect(t.kind === 'text' && t.fontSize).toBe(40);
    expect(scaleElement(rect('a', 0, 0, 1, 1), 1, 1, 0, 0)).toEqual(rect('a', 0, 0, 1, 1));
  });

  it('selects objects whose rotated box touches a marquee, skipping locked and hidden ones', () => {
    const { doc } = withElements(
      rect('in', 10, 10, 20, 20), rect('out', 300, 300, 20, 20), rect('locked', 12, 12, 5, 5, { locked: true }),
      rect('hidden', 14, 14, 5, 5, { hidden: true }),
    );
    expect(elementsInRect(doc.pages[0]!, { x: 0, y: 0, w: 100, h: 100 })).toEqual(['in']);
  });

  it('moves strokes, boxes and keeps pressure', () => {
    const s = translateElement({ id: 's', kind: 'stroke', tool: 'pen', color: '#000000', size: 2, points: [{ x: 1, y: 1, pressure: 0.4 }] }, 3, 4);
    expect(s.kind === 'stroke' && s.points[0]).toEqual({ x: 4, y: 5, pressure: 0.4 });
  });
});

describe('selection frame, handles, resize and turn', () => {
  it('frames one rotated box on its own and several objects by their union', () => {
    const turned = rotateElement(rect('a', 0, 0, 100, 50), 45, { x: 50, y: 25 });
    expect(selectionFrame([turned])).toMatchObject({ cx: 50, cy: 25, w: 100, h: 50, rot: 45 });
    const two = selectionFrame([rect('a', 0, 0, 10, 10), rect('b', 90, 40, 10, 10)])!;
    expect(two).toMatchObject({ cx: 50, cy: 25, w: 100, h: 50, rot: 0 });
    expect(selectionFrame([])).toBeUndefined();
  });

  it('keeps thin lines grabbable by giving the frame a minimum size', () => {
    const f = selectionFrame([{ id: 'l', kind: 'line', x: 0, y: 50, w: 100, h: 0, color: '#000000', size: 2 }])!;
    expect(f.h).toBeGreaterThanOrEqual(8);
  });

  it('finds the handle under the pointer, scaled to the zoom', () => {
    const f = selectionFrame([rect('a', 100, 100, 100, 50)])!;
    expect(hitHandle(f, { x: 101, y: 99 }, 1)).toBe('nw');
    expect(hitHandle(f, { x: 199, y: 151 }, 1)).toBe('se');
    expect(hitHandle(f, { x: 150, y: 100 - 30 }, 1)).toBe('rotate');
    expect(hitHandle(f, { x: 150, y: 125 }, 1)).toBeUndefined();
    // At 4x zoom the same pixel reach covers a quarter of the document distance.
    expect(hitHandle(f, { x: 108, y: 100 }, 4)).toBeUndefined();
    expect(handlePositions(f, 1)).toHaveLength(9);
  });

  it('resizes from a corner with the opposite corner pinned', () => {
    const f = selectionFrame([rect('a', 100, 100, 100, 50)])!;
    const next = resizeFrame(f, 'se', { x: 300, y: 200 }, false);
    expect(next).toMatchObject({ w: 200, h: 100, cx: 200, cy: 150 });
    const els = applyFrame([rect('a', 100, 100, 100, 50)], f, next, 'se');
    expect(els[0]).toMatchObject({ x: 100, y: 100, w: 200, h: 100 });
  });

  it('resizes along one axis from an edge handle', () => {
    const f = selectionFrame([rect('a', 100, 100, 100, 50)])!;
    const next = resizeFrame(f, 'e', { x: 260, y: 999 }, false);
    expect(next).toMatchObject({ w: 160, h: 50 });
    const els = applyFrame([rect('a', 100, 100, 100, 50)], f, next, 'e');
    expect(els[0]).toMatchObject({ x: 100, y: 100, w: 160, h: 50 });
  });

  it('never collapses below the minimum size and keeps proportions when asked', () => {
    const f = selectionFrame([rect('a', 100, 100, 100, 50)])!;
    expect(resizeFrame(f, 'se', { x: 50, y: 50 }, false)).toMatchObject({ w: 8, h: 8 });
    const locked = resizeFrame(f, 'se', { x: 300, y: 125 }, true);
    expect(locked.w / locked.h).toBeCloseTo(2);
  });

  it('resizes a rotated box in its own axes', () => {
    const turned = rotateElement(rect('a', 0, 0, 100, 50), 90, { x: 50, y: 25 });
    const f = selectionFrame([turned])!;
    // The east handle of a box turned 90 degrees sits below the centre.
    const east = handlePositions(f, 1).find((h) => h.id === 'e')!;
    const next = resizeFrame(f, 'e', { x: east.x, y: east.y + 20 }, false);
    expect(next.w).toBeCloseTo(120);
    const [el] = applyFrame([turned], f, next, 'e');
    expect(el!.kind === 'rect' && el!.w).toBeCloseTo(120);
    expect(el).toMatchObject({ h: 50, rotation: 90 });
  });

  it('scales several objects together about the anchor', () => {
    const start = [rect('a', 0, 0, 10, 10), rect('b', 20, 0, 10, 10)];
    const f = selectionFrame(start)!;
    const els = applyFrame(start, f, { ...f, w: f.w * 2, cx: f.cx + f.w / 2 }, 'e');
    expect(els[0]).toMatchObject({ x: 0, w: 20 });
    expect(els[1]).toMatchObject({ x: 40, w: 20 });
  });

  it('scales a selection about its centre', () => {
    const [r] = scaleSelection([rect('a', 0, 0, 100, 100)], 0.5);
    expect(r).toMatchObject({ x: 25, y: 25, w: 50, h: 50 });
  });

  it('turns by dragging the rotate handle, snapping near 15 degree steps', () => {
    const start = [rect('a', 0, 0, 100, 100)];
    const f = selectionFrame(start)!;
    // Grab the handle straight above, then swing it a quarter turn to the right.
    const [turned] = rotateDrag(start, f, -90, { x: 150, y: 50 });
    expect(turned!.rotation).toBe(90);
    const [near] = rotateDrag(start, f, -90, { x: 150, y: 50 + 100 * Math.tan((2 * Math.PI) / 180) });
    expect(near!.rotation).toBe(90);
    expect(snapAngle(30)).toBe(30);
    expect(snapAngle(33)).toBe(30);
    expect(snapAngle(37)).toBe(37);
    expect(frameCorners(f)).toHaveLength(4);
  });

  it('constrains drags to squares, circles and 45 degree lines', () => {
    expect(constrainDrag('rect', 30, -10)).toEqual({ w: 30, h: -30 });
    expect(constrainDrag('ellipse', -5, 40)).toEqual({ w: -40, h: 40 });
    const line = constrainDrag('line', 100, 10);
    expect(line.w).toBeCloseTo(100.5, 0);
    expect(Math.abs(line.h)).toBeLessThan(1e-6);
    const diag = constrainDrag('arrow', 50, 60);
    expect(diag.w).toBeCloseTo(diag.h);
  });
});

describe('partial eraser', () => {
  const longStroke = stroke('s', [[0, 50], [100, 50]]);

  it('cuts the part under the eraser and keeps the rest as separate strokes', () => {
    const parts = splitStroke(longStroke as Extract<DrawingElement, { kind: 'stroke' }>, { x: 50, y: 50 }, 8)!;
    expect(parts).toHaveLength(2);
    expect(parts[0]!.id).toBe('s');
    expect(parts[1]!.id).not.toBe('s');
    expect(parts[0]!.points.at(-1)!.x).toBeLessThan(50);
    expect(parts[1]!.points[0]!.x).toBeGreaterThan(50);
    expect(parts.every((p) => p.color === '#000000' && p.size === 4 && p.tool === 'pen')).toBe(true);
  });

  it('misses cleanly and removes strokes that are fully covered', () => {
    expect(splitStroke(longStroke as Extract<DrawingElement, { kind: 'stroke' }>, { x: 50, y: 90 }, 8)).toBeUndefined();
    const dot = stroke('d', [[5, 5]]) as Extract<DrawingElement, { kind: 'stroke' }>;
    expect(splitStroke(dot, { x: 5, y: 5 }, 8)).toEqual([]);
  });

  it('erases a page without touching locked or hidden objects, and shapes go whole', () => {
    const { doc } = withElements(longStroke, stroke('safe', [[0, 50], [100, 50]], { locked: true }), rect('box', 40, 40, 20, 20), rect('away', 300, 300, 10, 10));
    const page: DrawingPage = doc.pages[0]!;
    const next = eraseAt(page, { x: 50, y: 50 }, 8);
    const out = next.elements.map((e) => e.id);
    expect(out).toContain('safe');
    expect(out).toContain('away');
    expect(out).not.toContain('box');
    expect(out.filter((id) => id !== 'safe' && id !== 'away' && id !== 'box')).toHaveLength(2);
    expect(eraseAt(page, { x: 200, y: 200 }, 8)).toBe(page);
  });

  it('sweeps along a drag so a quick pass cannot skip a thin stroke', () => {
    const { doc } = withElements(stroke('v', [[50, 0], [50, 100]]));
    const page = doc.pages[0]!;
    const swept = eraseSweep(page, { x: 0, y: 50 }, { x: 100, y: 50 }, 6);
    expect(swept.elements.length).toBeGreaterThan(1);
    const gone = swept.elements.every((e) => e.kind === 'stroke' && e.points.every((p) => Math.abs(p.y - 50) > 5));
    expect(gone).toBe(true);
  });
});

describe('migrate and validate', () => {
  it('upgrades a version 1 drawing and numbers its stacking order', () => {
    const v1 = {
      id: 'd', title: 'Old', createdAt: 1, updatedAt: 2,
      pages: [{ id: 'p', title: 'Screen 1', width: 400, height: 800, elements: [rect('a', 0, 0, 5, 5), rect('b', 0, 0, 5, 5)] }],
    };
    const res = migrateDrawing(v1)!;
    expect(res.fromVersion).toBe(1);
    expect(res.doc.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(res.doc.activePageId).toBe('p');
    expect(res.doc.pages[0]!.elements.map((e) => e.zIndex)).toEqual([0, 1]);
    expect(res.notices).toEqual([]);
  });

  it('drops damaged objects, bad colours and unknown fields, and says so', () => {
    const raw = {
      id: 'd', title: 'x', createdAt: 1, updatedAt: 1, schemaVersion: 2, activePageId: 'missing',
      pages: [{
        id: 'p', title: 'S', width: 400, height: 800, background: 'stripes', backgroundColor: 'red; drop table',
        elements: [
          rect('ok', 0, 0, 5, 5, { color: 'javascript:alert(1)' as string }),
          { id: 'nan', kind: 'rect', x: Number.NaN, y: 0, w: 5, h: 5, color: '#000000', size: 2 },
          { id: 'weird', kind: 'laser', x: 0, y: 0 },
          { id: 'inf', kind: 'stroke', tool: 'pen', color: '#000000', size: 2, points: [{ x: Infinity, y: 0 }] },
          { id: 'hint', kind: 'text', x: 0, y: 0, text: 'Hi', color: '#000000', fontSize: 20, hint: 'evil', evil: true },
        ],
      }],
    };
    const res = migrateDrawing(raw)!;
    const els = res.doc.pages[0]!.elements;
    expect(els.map((e) => e.id)).toEqual(['ok', 'hint']);
    expect(els[0]).toMatchObject({ color: expect.stringMatching(/^#[0-9A-Fa-f]{6}$/) });
    expect(els[1]).not.toHaveProperty('evil');
    expect(els[1]!.hint).toBeUndefined();
    expect(res.doc.pages[0]!.background).toBeUndefined();
    expect(res.doc.pages[0]!.backgroundColor).toBeUndefined();
    expect(res.doc.activePageId).toBe('p');
    expect(res.dropped).toBe(3);
    expect(res.notices[0]).toBe('3 damaged objects could not be restored.');
  });

  it('keeps hints, locks, rotation and photos, and warns about newer files', () => {
    const raw = {
      id: 'd', title: 't', createdAt: 1, updatedAt: 1, schemaVersion: 9,
      pages: [{
        id: 'p', title: 'S', width: 400, height: 800, background: 'grid', backgroundColor: '#E6E8F5',
        elements: [
          { id: 'i', kind: 'image', blobId: 'blob_1', x: 1, y: 2, w: -30, h: 40, alt: 'Shop front', rotation: 400, locked: true, hint: 'header' },
        ],
      }],
    };
    const res = migrateDrawing(raw)!;
    expect(res.doc.pages[0]).toMatchObject({ background: 'grid', backgroundColor: '#E6E8F5' });
    expect(res.doc.pages[0]!.elements[0]).toMatchObject({ kind: 'image', blobId: 'blob_1', w: 30, rotation: 40, locked: true, hint: 'header', alt: 'Shop front' });
    expect(res.notices.join(' ')).toContain('newer version');
  });

  it('refuses things that are not drawings and repairs duplicate ids', () => {
    expect(migrateDrawing(undefined)).toBeUndefined();
    expect(migrateDrawing('text')).toBeUndefined();
    expect(migrateDrawing({ id: 'd', pages: [] })).toBeUndefined();
    expect(migrateDrawing({ id: 5, pages: [{}] })).toBeUndefined();
    const dup = migrateDrawing({
      id: 'd', pages: [
        { id: 'p', title: 'a', elements: [rect('x', 0, 0, 1, 1), rect('x', 5, 5, 1, 1)] },
        { id: 'p', title: 'b', elements: [] },
      ],
    })!;
    expect(new Set(dup.doc.pages.map((p) => p.id)).size).toBe(2);
    expect(new Set(dup.doc.pages[0]!.elements.map((e) => e.id)).size).toBe(2);
  });
});

describe('export sizing and names', () => {
  it('scales a page and caps the longest side', () => {
    expect(exportSize({ width: 400, height: 800 }, 1)).toEqual({ width: 400, height: 800, scale: 1 });
    expect(exportSize({ width: 400, height: 800 }, 2)).toMatchObject({ width: 800, height: 1600 });
    const big = exportSize({ width: 400, height: 800 }, 8);
    expect(Math.max(big.width, big.height)).toBe(MAX_EXPORT_SIDE);
    expect(big.scale).toBeCloseTo(MAX_EXPORT_SIDE / 800);
  });

  it('builds safe file names, keeping letters from any script', () => {
    expect(pngFileName('Tailor Book', 'New order', 1, 2, true)).toBe('Tailor-Book-2-New-order@2x.png');
    expect(pngFileName('Tailor Book', 'Home', 0, 1, false)).toBe('Tailor-Book-Home.png');
    expect(pngFileName('../../etc/passwd', '***', 0, 1, false)).toBe('etcpasswd-screen-1.png');
    expect(pngFileName('दर्जी', 'होम', 0, 1, false)).toContain('दर्जी');
    expect(zipFileName('')).toBe('drawing-screens.zip');
  });
});

describe('display list: rotation, photos and page background', () => {
  it('wraps rotated boxes in push and pop and memoises the result', () => {
    const el = rotateElement(rect('a', 0, 0, 100, 50), 30, { x: 50, y: 25 });
    const prims = elementPrimitives(el);
    expect(prims[0]).toEqual({ t: 'push', cx: 50, cy: 25, rot: 30 });
    expect(prims.at(-1)).toEqual({ t: 'pop' });
    expect(elementPrimitives(el)).toBe(prims);
    expect(elementPrimitives(rect('b', 0, 0, 5, 5)).some((p) => p.t === 'push')).toBe(false);
  });

  it('draws photos by blob id', () => {
    const prims = elementPrimitives({ id: 'i', kind: 'image', blobId: 'blob_9', x: 10, y: 20, w: 30, h: 40 });
    expect(prims).toEqual([{ t: 'image', blobId: 'blob_9', x: 10, y: 20, w: 30, h: 40 }]);
  });

  it('builds paper, grid and dots, and reuses them', () => {
    const plain = backdrop({ width: 400, height: 800 });
    expect(plain).toHaveLength(1);
    expect(plain[0]).toMatchObject({ t: 'rect', w: 400, h: 800 });
    const grid = backdrop({ width: 400, height: 800, background: 'grid', backgroundColor: '#FFF4D6' });
    expect(grid[0]).toMatchObject({ fill: '#FFF4D6' });
    expect(grid[1]).toMatchObject({ t: 'path', width: 1 });
    expect((grid[1] as { d: string }).d.startsWith('M20 0V800')).toBe(true);
    const dots = backdrop({ width: 400, height: 800, background: 'dots' });
    expect(dots[1]).toMatchObject({ t: 'path' });
    expect(backdrop({ width: 400, height: 800, background: 'dots' })).toBe(dots);
  });
});

describe('reading strokes and layout', () => {
  const sample = (pts: Array<[number, number]>) => pts.map(([x, y]) => ({ x, y }));
  const rectPath = (x: number, y: number, w: number, h: number) => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 10; i++) pts.push([x + (w * i) / 10, y]);
    for (let i = 1; i <= 10; i++) pts.push([x + w, y + (h * i) / 10]);
    for (let i = 1; i <= 10; i++) pts.push([x + w - (w * i) / 10, y + h]);
    for (let i = 1; i <= 10; i++) pts.push([x, y + h - (h * i) / 10]);
    return pts;
  };

  it('tells lines, boxes, circles and scribbles apart', () => {
    expect(classifyStroke(sample([[0, 0], [100, 3]]))).toBe('line');
    expect(classifyStroke(sample(rectPath(10, 10, 120, 60)))).toBe('box');
    const circle: Array<[number, number]> = Array.from({ length: 41 }, (_, i) => [100 + 50 * Math.cos((i / 40) * 2 * Math.PI), 100 + 50 * Math.sin((i / 40) * 2 * Math.PI)]);
    expect(classifyStroke(sample(circle))).toBe('circle');
    const scribble: Array<[number, number]> = Array.from({ length: 40 }, (_, i) => [i * 2, (i % 2) * 40]);
    expect(classifyStroke(sample(scribble))).toBe('scribble');
    expect(classifyStroke(sample([[0, 0], [5, 5]]))).toBe('scribble');
  });

  it('puts drawn boxes and lines in the summary and leaves scribbles out', () => {
    const { doc } = withElements(
      stroke('box', rectPath(10, 100, 200, 60)),
      stroke('scrawl', Array.from({ length: 40 }, (_, i) => [i * 2, 300 + (i % 2) * 40] as [number, number])),
      { id: 't', kind: 'text', x: 30, y: 120, text: 'Name', color: '#000000', fontSize: 18 },
    );
    const kinds = summarizeDrawing(doc).elements.map((e) => `${e.kind}:${e.label ?? ''}`);
    expect(kinds).toEqual(['stroke:box:Name']);
  });

  it('describes arrows, lists, titles and bottom bars', () => {
    const { doc } = withElements(
      { id: 'title', kind: 'stamp', component: 'heading', label: 'Tailor Book', x: 20, y: 20, w: 300, h: 44 },
      { id: 'a', kind: 'stamp', component: 'bigButton', label: 'Orders', x: 20, y: 200, w: 120, h: 50 },
      { id: 'b', kind: 'stamp', component: 'bigButton', label: 'New order', x: 260, y: 200, w: 120, h: 50 },
      { id: 'arrow', kind: 'arrow', x: 145, y: 225, w: 110, h: 0, color: '#000000', size: 2 },
      rect('r1', 20, 300, 200, 40), rect('r2', 20, 350, 200, 40), rect('r3', 20, 400, 200, 40), rect('r4', 20, 450, 200, 40),
      rect('n1', 20, 720, 80, 50), rect('n2', 160, 720, 80, 50), rect('n3', 300, 720, 80, 50),
    );
    const notes = describeLayout(doc);
    expect(notes).toContain('Page 1: an arrow points from "Orders" to "New order".');
    expect(notes).toContain('Page 1: 4 similar items are stacked in a column, which looks like a list.');
    expect(notes).toContain('Page 1: "Tailor Book" sits at the top, like a screen title.');
    expect(notes).toContain('Page 1: 3 items run along the bottom edge, like a navigation bar.');
    expect(summarizeDrawing(doc).notes).toEqual(notes);
    expect(describeLayout(createDocument(1, 'e'))).toEqual([]);
    expect(summarizeDrawing(createDocument(1, 'e')).notes).toBeUndefined();
  });
});
