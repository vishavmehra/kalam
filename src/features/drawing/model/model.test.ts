import { describe, expect, it } from 'vitest';
import type { DrawingElement } from '@/core/contracts';
import {
  addElement, addPage, canRedo, canUndo, commit, createDocument, createHistory, elementBounds, elementPrimitives,
  hitTest, movePage, outlineToSvgPath, redo, removeElements, removePage, renamePage, summarizeDrawing,
  translateElement, undo, MAX_PAGES,
} from './index';

const stroke = (id: string, pts: Array<[number, number]>): DrawingElement =>
  ({ id, kind: 'stroke', tool: 'pen', color: '#000000', size: 4, points: pts.map(([x, y]) => ({ x, y })) });

describe('drawing document ops', () => {
  it('never mutates input and keeps at least one page', () => {
    const doc = createDocument(1, 'd1');
    const pageId = doc.pages[0]!.id;
    const next = addElement(doc, pageId, stroke('s1', [[0, 0], [10, 10]]));
    expect(doc.pages[0]!.elements).toHaveLength(0);
    expect(next.pages[0]!.elements).toHaveLength(1);
    expect(removePage(next, pageId)).toBe(next);
  });

  it('adds, renames, reorders and removes pages', () => {
    let doc = createDocument(1, 'd1');
    const first = doc.pages[0]!.id;
    const added = addPage(doc);
    doc = renamePage(added.doc, added.pageId, 'Orders');
    expect(doc.pages.map((p) => p.title)).toEqual(['Screen 1', 'Orders']);
    doc = movePage(doc, added.pageId, -1);
    expect(doc.pages[0]!.id).toBe(added.pageId);
    expect(movePage(doc, added.pageId, -1)).toBe(doc);
    doc = removePage(doc, first);
    expect(doc.pages).toHaveLength(1);
  });

  it('caps the page count', () => {
    let doc = createDocument(1, 'd1');
    for (let i = 0; i < MAX_PAGES + 3; i++) doc = addPage(doc).doc;
    expect(doc.pages).toHaveLength(MAX_PAGES);
  });

  it('hit-tests strokes by distance and boxes by area, topmost first', () => {
    let doc = createDocument(1, 'd1');
    const pid = doc.pages[0]!.id;
    doc = addElement(doc, pid, { id: 'r', kind: 'rect', x: 0, y: 0, w: 100, h: 100, color: '#000000', size: 2 });
    doc = addElement(doc, pid, stroke('s', [[0, 50], [100, 50]]));
    const page = doc.pages[0]!;
    expect(hitTest(page, { x: 50, y: 52 })).toBe('s');
    expect(hitTest(page, { x: 50, y: 80 })).toBe('r');
    expect(hitTest(page, { x: 300, y: 300 })).toBeUndefined();
    doc = removeElements(doc, pid, new Set(['s']));
    expect(doc.pages[0]!.elements.map((e) => e.id)).toEqual(['r']);
  });

  it('normalises negative boxes and translates elements', () => {
    const r: DrawingElement = { id: 'r', kind: 'rect', x: 100, y: 100, w: -40, h: -20, color: '#000000', size: 2 };
    expect(elementBounds(r)).toEqual({ x: 60, y: 80, w: 40, h: 20 });
    const s = translateElement(stroke('s', [[1, 1]]), 5, 6);
    expect(s.kind === 'stroke' && s.points[0]).toEqual({ x: 6, y: 7 });
  });
});

describe('history', () => {
  it('undoes and redoes, clearing redo on new commits', () => {
    let h = createHistory(1);
    h = commit(h, 2, { now: 0 });
    h = commit(h, 3, { now: 10_000 });
    h = undo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(3);
    h = undo(undo(h));
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    h = commit(h, 9, { now: 20_000 });
    expect(canRedo(h)).toBe(false);
  });

  it('coalesces commits with the same key inside the window', () => {
    let h = createHistory('');
    h = commit(h, 'O', { coalesceKey: 'title', now: 0 });
    h = commit(h, 'Or', { coalesceKey: 'title', now: 300 });
    h = commit(h, 'Ord', { coalesceKey: 'title', now: 600 });
    expect(h.past).toEqual(['']);
    h = commit(h, 'Orde', { coalesceKey: 'title', now: 5_000 });
    expect(h.past).toEqual(['', 'Ord']);
  });

  it('ignores no-op commits and respects the limit', () => {
    let h = createHistory(0);
    expect(commit(h, 0)).toBe(h);
    for (let i = 1; i <= 10; i++) h = commit(h, i, { limit: 3, now: i * 10_000 });
    expect(h.past).toEqual([7, 8, 9]);
  });
});

describe('summarizeDrawing', () => {
  it('extracts stamps, contained labels, texts and custom page titles in reading order', () => {
    let doc = createDocument(1, 'drw_1');
    const p1 = doc.pages[0]!.id;
    doc = renamePage(doc, p1, 'New order');
    doc = addElement(doc, p1, { id: 'b', kind: 'stamp', component: 'bigButton', label: 'Save order', x: 80, y: 600, w: 240, h: 56 });
    doc = addElement(doc, p1, { id: 'i', kind: 'stamp', component: 'textInput', label: 'Customer name', x: 40, y: 100, w: 320, h: 64 });
    doc = addElement(doc, p1, { id: 'box', kind: 'rect', x: 40, y: 300, w: 300, h: 80, color: '#000000', size: 2 });
    doc = addElement(doc, p1, { id: 't1', kind: 'text', x: 60, y: 320, text: 'Chest', color: '#000000', fontSize: 18 });
    doc = addElement(doc, p1, { id: 't2', kind: 'text', x: 40, y: 20, text: 'Tailor book', color: '#000000', fontSize: 28 });
    doc = addElement(doc, p1, stroke('s', [[0, 0], [5, 5]]));
    const added = addPage(doc);
    doc = addElement(added.doc, added.pageId, { id: 'l', kind: 'stamp', component: 'list', x: 40, y: 40, w: 320, h: 200 });

    const s = summarizeDrawing(doc);
    expect(s.drawingId).toBe('drw_1');
    expect(s.pageCount).toBe(2);
    const page1 = s.elements.filter((e) => e.page === 1).map((e) => `${e.kind}:${e.label ?? ''}`);
    expect(page1).toEqual([
      'screen_title:New order',
      'stamp:textInput:Customer name',
      'rect:Chest',
      'stamp:bigButton:Save order',
      'text:Tailor book',
    ]);
    expect(s.elements.find((e) => e.page === 2)).toMatchObject({ kind: 'stamp:list', bbox: [40, 40, 320, 200] });
    expect(s.elements.some((e) => e.kind === 'stroke')).toBe(false);
    expect(s.texts).toEqual(['New order', 'Customer name', 'Chest', 'Save order', 'Tailor book']);
    expect(s.images).toEqual([]);
  });
});

describe('display list', () => {
  it('builds a closed SVG path for freehand strokes and memoises primitives', () => {
    const el = stroke('s', [[0, 0], [10, 5], [20, 10], [30, 12], [40, 20]]);
    const prims = elementPrimitives(el);
    expect(prims[0]).toMatchObject({ t: 'path', fill: '#000000' });
    expect(prims[0]!.t === 'path' && prims[0]!.d.startsWith('M') && prims[0]!.d.endsWith('Z')).toBe(true);
    expect(elementPrimitives(el)).toBe(prims);
    expect(outlineToSvgPath([])).toBe('');
  });

  it('draws arrows with two head lines and stamps as wireframes', () => {
    const arrow = elementPrimitives({ id: 'a', kind: 'arrow', x: 0, y: 0, w: 100, h: 0, color: '#111111', size: 3 });
    expect(arrow.filter((p) => p.t === 'line')).toHaveLength(3);
    const btn = elementPrimitives({ id: 'b', kind: 'stamp', component: 'bigButton', label: 'Pay', x: 0, y: 0, w: 200, h: 50 });
    expect(btn.some((p) => p.t === 'text' && p.text === 'Pay')).toBe(true);
  });
});
