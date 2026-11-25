import { describe, expect, it } from 'vitest';
import { createDocument, pagePrimitives } from './model';
import { createStudioStore, currentPage, selectOverlay, selectPrimitives, toDocPoint } from './studio-store';

const fresh = () => createStudioStore(createDocument(1, 'drw_t'));
const els = (s: ReturnType<typeof fresh>) => currentPage(s.getState()).elements;
/** Primitives of the blank paper (backdrop) that every page draws first. */
const paper = (s: ReturnType<typeof fresh>) => pagePrimitives({ ...currentPage(s.getState()), elements: [] }).length;

describe('studio tools', () => {
  it('draws a stroke as one undoable step', () => {
    const s = fresh();
    s.getState().pointerDown({ x: 10, y: 10 });
    s.getState().pointerMove({ x: 20, y: 20 });
    s.getState().pointerMove({ x: 30, y: 25 });
    expect(els(s)).toHaveLength(0);
    // The stroke in progress is the only overlay primitive, drawn on top of the paper.
    expect(selectOverlay(s.getState())).toHaveLength(1);
    expect(selectPrimitives(s.getState())).toHaveLength(paper(s) + 1);
    s.getState().pointerUp();
    expect(els(s)).toMatchObject([{ kind: 'stroke', tool: 'pen' }]);
    expect(s.getState().saveStatus).toBe('unsaved');
    s.getState().undo();
    expect(els(s)).toHaveLength(0);
  });

  it('normalises dragged rectangles and ignores tiny shapes', () => {
    const s = fresh();
    s.getState().setTool('rect');
    s.getState().pointerDown({ x: 100, y: 100 });
    s.getState().pointerMove({ x: 40, y: 60 });
    s.getState().pointerUp();
    expect(els(s)[0]).toMatchObject({ kind: 'rect', x: 40, y: 60, w: 60, h: 40 });
    s.getState().pointerDown({ x: 5, y: 5 });
    s.getState().pointerMove({ x: 6, y: 6 });
    s.getState().pointerUp();
    expect(els(s)).toHaveLength(1);
  });

  it('cuts strokes where the eraser passes and restores them on undo', () => {
    const s = fresh();
    s.getState().pointerDown({ x: 10, y: 50 });
    s.getState().pointerMove({ x: 200, y: 50 });
    s.getState().pointerUp();
    s.getState().setTool('eraser');
    s.getState().pointerDown({ x: 100, y: 52 });
    // Partial erase (docs/08 §7.4): the stroke is split into the two pieces either side of the eraser.
    expect(selectPrimitives(s.getState())).toHaveLength(paper(s) + 2);
    s.getState().pointerUp();
    expect(els(s)).toHaveLength(2);
    expect(els(s).every((e) => e.kind === 'stroke')).toBe(true);
    s.getState().undo();
    expect(els(s)).toHaveLength(1);
  });

  it('places a stamp, drags it, edits its label and deletes it', () => {
    const s = fresh();
    s.getState().setStamp('list');
    s.getState().pointerDown({ x: 200, y: 300 });
    s.getState().pointerMove({ x: 210, y: 320 });
    s.getState().pointerUp();
    const stamp = els(s)[0]!;
    expect(stamp).toMatchObject({ kind: 'stamp', component: 'list', label: 'Items' });
    expect(stamp.kind === 'stamp' && [stamp.x, stamp.y]).toEqual([50, 230]);
    s.getState().updateSelected({ label: 'Orders' });
    expect(els(s)[0]).toMatchObject({ label: 'Orders' });
    s.getState().deleteSelected();
    expect(els(s)).toHaveLength(0);
  });

  it('commits text from the editor and removes it when cleared', () => {
    const s = fresh();
    s.getState().setTool('text');
    s.getState().pointerDown({ x: 30, y: 40 });
    s.getState().updateTextEdit('Customer name');
    s.getState().commitTextEdit();
    expect(els(s)[0]).toMatchObject({ kind: 'text', text: 'Customer name', x: 30, y: 40 });
    s.getState().pointerDown({ x: 35, y: 45 });
    expect(s.getState().textEdit?.id).toBe(els(s)[0]!.id);
    s.getState().updateTextEdit('');
    s.getState().commitTextEdit();
    expect(els(s)).toHaveLength(0);
  });

  it('manages pages and converts screen points through the view', () => {
    const s = fresh();
    s.getState().addPage();
    expect(s.getState().history.present.pages).toHaveLength(2);
    expect(s.getState().pageId).toBe(s.getState().history.present.pages[1]!.id);
    s.getState().setViewport(800, 1000);
    const { view } = s.getState();
    const p = toDocPoint(view, view.tx + view.scale * 100, view.ty + view.scale * 50, 0.7);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(50);
    expect(p.pressure).toBe(0.7);
    s.getState().zoomBy(2, 400, 500);
    expect(s.getState().view.scale).toBeCloseTo(view.scale * 2);
  });
});
