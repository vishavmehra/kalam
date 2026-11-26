import { describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { DrawingElement } from '@/core/contracts';
import {
  addElement, canTransition, createDocument, DIGIT_SHAPES, handwritingStrokes, pageToSvg, propsOf, textPlacement, type PointerState,
} from './model';
import { canvasLabel, createStudioStore, currentPage, describeInPage, selectBaseVisible, selectPointerState, type StudioState } from './studio-store';

type Geo = { x: number; y: number; w: number; h: number; color: string; size: number; rotation?: number };

type Store = StoreApi<StudioState>;
const box = (id: string, x: number, y = 20, extra: Partial<DrawingElement> = {}): DrawingElement =>
  ({ id, kind: 'rect', x, y, w: 60, h: 40, color: '#000000', size: 2, ...extra }) as DrawingElement;

function studio(...els: DrawingElement[]): Store {
  let doc = createDocument(1, 'drw_dx1');
  const pid = doc.pages[0]!.id;
  for (const el of els) doc = addElement(doc, pid, el);
  const s = createStudioStore(doc);
  s.getState().setTool('select');
  return s;
}
const els = (s: Store) => currentPage(s.getState()).elements;
const byId = (s: Store, id: string) => els(s).find((e) => e.id === id)!;
const sel = (s: Store) => [...s.getState().selectedIds];
const tap = (s: Store, x: number, y: number, opts?: { additive?: boolean }) => {
  s.getState().pointerDown({ x, y }, opts);
  s.getState().pointerUp();
};
const drag = (s: Store, from: [number, number], to: [number, number]) => {
  s.getState().pointerDown({ x: from[0], y: from[1] });
  s.getState().pointerMove({ x: to[0], y: to[1] });
  s.getState().pointerUp();
};
/** Three boxes, the first two grouped. */
function grouped(): Store {
  const s = studio(box('a', 10), box('b', 100), box('c', 200));
  s.getState().select(['a', 'b']);
  s.getState().groupSelected();
  s.getState().clearSelection();
  return s;
}

describe('groups in the studio', () => {
  it('groups the selection as one undo step, with a message, and selecting one member picks them all', () => {
    const s = studio(box('a', 10), box('b', 100), box('c', 200));
    s.getState().select(['a', 'b']);
    const before = s.getState().history.past.length;
    s.getState().groupSelected();
    expect(s.getState().history.past.length).toBe(before + 1);
    expect(s.getState().notice?.message).toMatch(/Grouped 2 objects/);
    expect(byId(s, 'a').groupId).toBeTruthy();
    s.getState().clearSelection();
    tap(s, 120, 40);
    expect(sel(s).sort()).toEqual(['a', 'b']);
    s.getState().undo();
    expect(byId(s, 'a').groupId).toBeUndefined();
  });

  it('tells the person when nothing can be grouped', () => {
    const s = studio(box('a', 10), box('b', 100));
    s.getState().select(['a']);
    s.getState().groupSelected();
    expect(s.getState().notice?.message).toMatch(/two or more/i);
    expect(byId(s, 'a').groupId).toBeUndefined();
    s.getState().ungroupSelected();
    expect(s.getState().notice?.message).toMatch(/not in a group|Nothing/i);
  });

  it('says to unlock first when the whole group is locked, and does not claim there is no group', () => {
    const s = grouped();
    s.getState().toggleLocked('a');
    s.getState().select(['a']);
    s.getState().ungroupSelected();
    expect(s.getState().notice?.message).toMatch(/unlock the group first/i);
    expect(byId(s, 'a').groupId).toBeTruthy();
    s.getState().toggleLocked('a');
    s.getState().select(['a']);
    s.getState().ungroupSelected();
    expect(byId(s, 'a').groupId).toBeUndefined();
  });

  it('moves the whole group when one member is dragged', () => {
    const s = grouped();
    drag(s, [120, 40], [140, 90]);
    const a = byId(s, 'a') as Geo;
    const b = byId(s, 'b') as Geo;
    expect([a.x, a.y]).toEqual([30, 70]);
    expect([b.x, b.y]).toEqual([120, 70]);
    expect((byId(s, 'c') as Geo).x).toBe(200);
  });

  it('resizes the group as one frame', () => {
    const s = grouped();
    s.getState().select(['a']);
    const before = (byId(s, 'b') as Geo).w;
    s.getState().scaleSelected(2);
    expect((byId(s, 'b') as Geo).w).toBeCloseTo(before * 2, 5);
  });

  it('locks and hides as one, from the object list too', () => {
    const s = grouped();
    s.getState().toggleLocked('a');
    expect(byId(s, 'a').locked && byId(s, 'b').locked).toBe(true);
    expect(byId(s, 'c').locked).toBeFalsy();
    s.getState().toggleLocked('b');
    expect(byId(s, 'a').locked || byId(s, 'b').locked).toBeFalsy();
    s.getState().toggleHidden('b');
    expect(byId(s, 'a').hidden && byId(s, 'b').hidden).toBe(true);
  });

  it('deletes, copies and duplicates the group as one; the copy is a group of its own', () => {
    const s = grouped();
    s.getState().select(['a']);
    s.getState().duplicateSelected();
    expect(els(s)).toHaveLength(5);
    const newIds = sel(s);
    expect(newIds).toHaveLength(2);
    const copies = els(s).filter((e) => newIds.includes(e.id));
    expect(copies[0]!.groupId).toBe(copies[1]!.groupId);
    expect(copies[0]!.groupId).not.toBe(byId(s, 'a').groupId);
    s.getState().deleteSelected();
    expect(els(s).map((e) => e.id)).toEqual(['a', 'b', 'c']);
    s.getState().select(['b']);
    s.getState().deleteSelected();
    expect(els(s).map((e) => e.id)).toEqual(['c']);
  });

  it('ungroups so each object moves on its own, and a click toggles the whole group in a multi-select', () => {
    const s = grouped();
    s.getState().select(['a']);
    s.getState().ungroupSelected();
    expect(els(s).every((e) => !e.groupId)).toBe(true);
    s.getState().clearSelection();
    tap(s, 120, 40);
    expect(sel(s)).toEqual(['b']);

    const g = grouped();
    tap(g, 220, 40);
    tap(g, 40, 40, { additive: true });
    expect(sel(g).sort()).toEqual(['a', 'b', 'c']);
    tap(g, 40, 40, { additive: true });
    expect(sel(g)).toEqual(['c']);
  });

  it('picks the whole group with a selection box that touches one member', () => {
    const s = grouped();
    drag(s, [5, 5], [40, 30]);
    expect(sel(s).sort()).toEqual(['a', 'b']);
  });

  it('describes a group for the object list and the screen reader', () => {
    const s = grouped();
    expect(describeInPage(currentPage(s.getState()), byId(s, 'a'))).toBe('Rectangle, in a group of 2');
    expect(describeInPage(currentPage(s.getState()), byId(s, 'c'))).toBe('Rectangle');
    s.getState().select(['a']);
    expect(canvasLabel(s.getState())).toMatch(/Group of 2 objects selected/);
  });

  it('keeps groups in the SVG export', () => {
    const s = grouped();
    const svg = pageToSvg(currentPage(s.getState()));
    const id = byId(s, 'a').groupId!;
    expect(svg.match(new RegExp(`data-kalam-group="${id}"`, 'g'))).toHaveLength(2);
  });
});

describe('pan and pinch live in the gesture state', () => {
  it('a pan moves the view by the pointer delta and ends cleanly', () => {
    const s = studio();
    const t0 = s.getState().view;
    s.getState().beginPan(100, 100);
    expect(s.getState().gesture?.kind).toBe('pan');
    expect(selectPointerState(s.getState())).toBe('panning');
    s.getState().panTo(130, 90);
    expect(s.getState().view.tx).toBe(t0.tx + 30);
    expect(s.getState().view.ty).toBe(t0.ty - 10);
    s.getState().panTo(140, 90);
    expect(s.getState().view.tx).toBe(t0.tx + 40);
    s.getState().endView();
    expect(s.getState().gesture).toBeUndefined();
    expect(selectPointerState(s.getState())).toBe('idle');
  });

  it('a pinch zooms by the change in finger distance around the centre', () => {
    const s = studio();
    s.getState().setViewport(400, 800);
    const k0 = s.getState().view.scale;
    s.getState().beginPinch(200, 400, 100);
    s.getState().pinchTo(200, 400, 200);
    expect(s.getState().view.scale).toBeCloseTo(k0 * 2, 5);
    s.getState().pinchTo(200, 400, 100);
    expect(s.getState().view.scale).toBeCloseTo(k0, 5);
    s.getState().endView();
    expect(s.getState().gesture).toBeUndefined();
  });

  it('a pinch from the Android adapter reports a factor, and still counts as panning', () => {
    const s = studio();
    s.getState().setViewport(400, 800);
    const k0 = s.getState().view.scale;
    s.getState().zoomPinch(1.5, 200, 400);
    expect(selectPointerState(s.getState())).toBe('panning');
    expect(s.getState().view.scale).toBeCloseTo(k0 * 1.5, 5);
    s.getState().endView();
    expect(selectPointerState(s.getState())).toBe('idle');
  });

  it('a second finger cancels a stroke in progress instead of drawing a second one', () => {
    const s = createStudioStore(createDocument(1, 'drw_pen'));
    s.getState().setTool('pen');
    s.getState().pointerDown({ x: 10, y: 10 });
    s.getState().pointerMove({ x: 40, y: 40 });
    expect(selectPointerState(s.getState())).toBe('drawing');
    s.getState().beginPinch(100, 100, 80);
    expect(s.getState().draft).toBeUndefined();
    expect(selectPointerState(s.getState())).toBe('panning');
    s.getState().pointerDown({ x: 50, y: 50 });
    s.getState().pointerMove({ x: 60, y: 60 });
    s.getState().pointerUp();
    expect(currentPage(s.getState()).elements).toHaveLength(0);
    s.getState().endView();
    expect(selectPointerState(s.getState())).toBe('idle');
  });

  it('only moves between legal states through a whole scripted session', () => {
    const s = studio(box('a', 10), box('b', 100));
    const seen: PointerState[] = [selectPointerState(s.getState())];
    const step = (f: () => void) => { f(); seen.push(selectPointerState(s.getState())); };
    step(() => s.getState().pointerDown({ x: 20, y: 30 }));
    step(() => s.getState().pointerMove({ x: 50, y: 60 }));
    step(() => s.getState().pointerUp());
    step(() => s.getState().pointerDown({ x: 300, y: 600 }));
    step(() => s.getState().pointerMove({ x: 340, y: 640 }));
    step(() => s.getState().pointerUp());
    step(() => s.getState().beginPan(0, 0));
    step(() => s.getState().panTo(10, 10));
    step(() => s.getState().endView());
    step(() => s.getState().setTool('pen'));
    step(() => s.getState().pointerDown({ x: 20, y: 300 }));
    step(() => s.getState().pointerMove({ x: 60, y: 340 }));
    step(() => s.getState().beginPinch(100, 100, 50));
    step(() => s.getState().endView());
    step(() => s.getState().setTool('text'));
    step(() => s.getState().pointerDown({ x: 100, y: 100 }));
    step(() => s.getState().cancelTextEdit());
    for (let i = 1; i < seen.length; i++) expect(canTransition(seen[i - 1]!, seen[i]!), `${seen[i - 1]} to ${seen[i]}`).toBe(true);
    expect(seen).toContain('transforming');
    expect(seen).toContain('selecting');
    expect(seen).toContain('text_editing');
  });

  it('ignores a pointer while a pan or pinch owns the pointers', () => {
    const s = studio(box('a', 10));
    s.getState().beginPan(0, 0);
    s.getState().pointerDown({ x: 20, y: 30 });
    expect(sel(s)).toEqual([]);
    expect(s.getState().gesture?.kind).toBe('pan');
  });
});

describe('importing objects', () => {
  it('adds them as one undo step, selects them and switches to the select tool', () => {
    const s = studio(box('a', 10));
    const before = s.getState().history.past.length;
    const n = s.getState().importElements([box('x', 100), box('y', 200)]);
    expect(n).toBe(2);
    expect(els(s)).toHaveLength(3);
    expect(sel(s)).toEqual(['x', 'y']);
    expect(s.getState().history.past.length).toBe(before + 1);
    s.getState().undo();
    expect(els(s)).toHaveLength(1);
  });

  it('adds only what the screen can still hold, and says so', () => {
    const s = studio();
    const lots = Array.from({ length: 510 }, (_, i) => box(`n${i}`, i % 300));
    expect(s.getState().importElements(lots)).toBe(500);
    expect(s.getState().notice?.message).toMatch(/500 of 510/);
    expect(s.getState().importElements([box('late', 5)])).toBe(0);
  });
});

describe('turning handwriting into text', () => {
  const written = (id: string, digit: string, dx: number) => ({
    id, kind: 'stroke' as const, tool: 'pen' as const, color: '#aa0000', size: 4,
    points: DIGIT_SHAPES[digit]![0]!.map((p) => ({ x: dx + p.x * 80, y: 100 + p.y * 80 })),
  });

  it('swaps the strokes for one text object in one step, and undo brings the writing back', () => {
    const s = studio(written('w1', '4', 20), written('w2', '2', 100), box('keep', 300, 500));
    const strokes = handwritingStrokes(els(s));
    expect(strokes).toHaveLength(2);
    const at = { ...textPlacement(strokes, '42'), color: '#aa0000' };
    const before = s.getState().history.past.length;
    s.getState().replaceWithText(strokes.map((x) => x.id), '42', at);
    expect(s.getState().history.past.length).toBe(before + 1);
    const page = els(s);
    expect(page.map((e) => e.kind)).toEqual(['rect', 'text']);
    const t = page[1] as Extract<DrawingElement, { kind: 'text' }>;
    expect(t.text).toBe('42');
    expect(t.color).toBe('#aa0000');
    expect(sel(s)).toEqual([t.id]);
    s.getState().undo();
    expect(els(s).map((e) => e.kind)).toEqual(['stroke', 'stroke', 'rect']);
  });

  it('does nothing for empty text, so the writing is never lost', () => {
    const s = studio(written('w1', '4', 20));
    s.getState().replaceWithText(['w1'], '   ', { x: 0, y: 0, fontSize: 20, color: '#000000' });
    expect(els(s)).toHaveLength(1);
  });
});

describe('changing object properties from the studio', () => {
  it('sets fill and corner radius on a box, and each change undoes on its own', () => {
    const s = studio(box('a', 10));
    s.getState().select(['a']);
    s.getState().updateSelected({ fill: '#fdf1d0' });
    s.getState().updateSelected({ radius: 28 });
    expect(propsOf(byId(s, 'a'))).toMatchObject({ fill: '#fdf1d0', radius: 28 });
    s.getState().undo();
    expect(propsOf(byId(s, 'a'))).toMatchObject({ fill: '#fdf1d0' });
    expect(propsOf(byId(s, 'a')).radius).toBeUndefined();
  });

  it('applies to every object that fits and skips the rest, and leaves locked objects alone', () => {
    const arrow: DrawingElement = { id: 'ar', kind: 'arrow', x: 0, y: 200, w: 100, h: 0, color: '#000000', size: 3 };
    const text: DrawingElement = { id: 'tx', kind: 'text', x: 0, y: 300, text: 'Hi', color: '#000000', fontSize: 20 };
    const s = studio(box('a', 10), box('locked', 100, 20, { locked: true }), arrow, text);
    s.getState().select(['a', 'locked', 'ar', 'tx']);
    s.getState().updateSelected({ fill: '#aabbcc', headSize: 32, font: 'serif', bold: true });
    expect(propsOf(byId(s, 'a')).fill).toBe('#aabbcc');
    expect(propsOf(byId(s, 'locked')).fill).toBeUndefined();
    expect(propsOf(byId(s, 'ar')).headSize).toBe(32);
    expect(propsOf(byId(s, 'ar')).fill).toBeUndefined();
    expect(propsOf(byId(s, 'tx'))).toMatchObject({ font: 'serif', bold: true });
  });
});

describe('only what is on screen is drawn on a busy page', () => {
  it('zoomed in on a corner, the visible list has far fewer objects than the page', () => {
    const many = Array.from({ length: 200 }, (_, i) => box(`n${i}`, (i % 10) * 38, 10 + Math.floor(i / 10) * 38));
    const s = studio(...many);
    s.getState().setViewport(200, 400);
    s.getState().zoomBy(1, 0, 0);
    const all = selectBaseVisible(s.getState()).length;
    s.getState().zoomBy(4, 0, 0);
    s.getState().panBy(0, 0);
    const zoomed = selectBaseVisible(s.getState());
    expect(zoomed.length).toBeLessThan(all * 0.4);
    expect(zoomed.length).toBeGreaterThan(1);
  });
});
