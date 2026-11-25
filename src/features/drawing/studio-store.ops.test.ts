import { describe, expect, it } from 'vitest';
import type { DrawingElement } from '@/core/contracts';
import { addElement, addElements, createDocument, PAGE_OBJECT_CAP } from './model';
import { COLORS, createStudioStore, currentPage, selectChrome, selectLive, type StudioState } from './studio-store';
import type { StoreApi } from 'zustand/vanilla';

type Store = StoreApi<StudioState>;
const box = (id: string, x: number, y: number, w = 60, h = 40): DrawingElement => ({ id, kind: 'rect', x, y, w, h, color: '#000000', size: 2 });

function studio(...els: DrawingElement[]): Store {
  let doc = createDocument(1, 'drw_t');
  const pid = doc.pages[0]!.id;
  for (const el of els) doc = addElement(doc, pid, el);
  const s = createStudioStore(doc);
  s.getState().setTool('select');
  return s;
}
const els = (s: Store) => currentPage(s.getState()).elements;
const ids = (s: Store) => els(s).map((e) => e.id);
const sel = (s: Store) => [...s.getState().selectedIds];
const drag = (s: Store, from: [number, number], to: [number, number], opts?: { additive?: boolean; constrain?: boolean }) => {
  s.getState().pointerDown({ x: from[0], y: from[1] }, opts);
  s.getState().pointerMove({ x: to[0], y: to[1] }, opts);
  s.getState().pointerUp();
};

// The clipboard is shared between studios in one process, so this must run before anything is copied.
describe('empty clipboard', () => {
  it('tells the person when there is nothing to paste', () => {
    const s = studio(box('a', 10, 10));
    expect(s.getState().canPaste).toBe(false);
    s.getState().paste();
    expect(s.getState().notice?.message).toMatch(/nothing to paste/i);
    expect(els(s)).toHaveLength(1);
  });
});

describe('selecting', () => {
  it('selects by tap, adds with shift, removes with shift, and clears on empty space', () => {
    const s = studio(box('a', 10, 10), box('b', 200, 200));
    drag(s, [20, 20], [20, 20]);
    expect(sel(s)).toEqual(['a']);
    s.getState().pointerDown({ x: 210, y: 210 }, { additive: true });
    s.getState().pointerUp();
    expect(sel(s)).toEqual(['a', 'b']);
    s.getState().pointerDown({ x: 40, y: 30 }, { additive: true });
    s.getState().pointerUp();
    expect(sel(s)).toEqual(['b']);
    drag(s, [350, 700], [352, 702]);
    expect(sel(s)).toEqual([]);
  });

  it('touch multi-select mode adds on tap without a modifier key', () => {
    const s = studio(box('a', 10, 10), box('b', 200, 200));
    s.getState().setMultiSelect(true);
    drag(s, [20, 20], [20, 20]);
    drag(s, [210, 210], [210, 210]);
    expect(sel(s)).toEqual(['a', 'b']);
  });

  it('marquee selects what it touches, skips locked objects and shows the box while dragging', () => {
    const s = studio(box('a', 10, 10), box('b', 100, 10), box('c', 300, 500), box('locked', 20, 20, 10, 10));
    s.getState().toggleLocked('locked');
    s.getState().pointerDown({ x: 0, y: 0 });
    s.getState().pointerMove({ x: 200, y: 100 });
    expect(s.getState().marquee).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(sel(s)).toEqual(['a', 'b']);
    expect(selectChrome(s.getState()).length).toBeGreaterThan(0);
    s.getState().pointerUp();
    expect(s.getState().marquee).toBeUndefined();
    expect(sel(s)).toEqual(['a', 'b']);
  });

  it('select all leaves out hidden and locked objects', () => {
    const s = studio(box('a', 0, 0), box('b', 0, 0), box('c', 0, 0));
    s.getState().toggleHidden('b');
    s.getState().toggleLocked('c');
    s.getState().selectAll();
    expect(sel(s)).toEqual(['a']);
  });
});

describe('moving, resizing and turning', () => {
  it('moves the selection as one undo step and previews while dragging', () => {
    const s = studio(box('a', 10, 10), box('b', 100, 10));
    s.getState().select(['a', 'b']);
    s.getState().pointerDown({ x: 40, y: 30 });
    s.getState().pointerMove({ x: 70, y: 50 });
    expect(s.getState().preview?.size).toBe(2);
    expect(selectLive(s.getState()).length).toBe(2);
    s.getState().pointerUp();
    expect(els(s)).toMatchObject([{ x: 40, y: 30 }, { x: 130, y: 30 }]);
    expect(s.getState().preview).toBeUndefined();
    s.getState().undo();
    expect(els(s)).toMatchObject([{ x: 10, y: 10 }, { x: 100, y: 10 }]);
  });

  it('does not move locked objects and says so', () => {
    const s = studio(box('a', 10, 10));
    s.getState().toggleLocked('a');
    const before = s.getState().history.present;
    drag(s, [20, 20], [80, 80]);
    expect(s.getState().history.present).toBe(before);
    expect(s.getState().notice?.message).toMatch(/locked/i);
  });

  it('resizes from a corner handle', () => {
    const s = studio(box('a', 100, 100, 100, 50));
    s.getState().select(['a']);
    expect(s.getState().handleAt({ x: 200, y: 150 })).toBe('se');
    drag(s, [200, 150], [300, 200]);
    expect(els(s)[0]).toMatchObject({ x: 100, y: 100, w: 200, h: 100 });
    expect(sel(s)).toEqual(['a']);
  });

  it('keeps proportions with Shift on a corner', () => {
    const s = studio(box('a', 100, 100, 100, 50));
    s.getState().select(['a']);
    drag(s, [200, 150], [300, 170], { constrain: true });
    const r = els(s)[0] as unknown as { w: number; h: number };
    expect(r.w / r.h).toBeCloseTo(2);
  });

  it('turns from the rotate handle and stores the rotation', () => {
    const s = studio(box('a', 100, 100, 100, 100));
    s.getState().select(['a']);
    expect(s.getState().handleAt({ x: 150, y: 70 })).toBe('rotate');
    drag(s, [150, 70], [250, 150]);
    expect(els(s)[0]!.rotation).toBe(90);
  });

  it('nudges, scales and turns with buttons, merging quick repeats into one undo step', () => {
    const s = studio(box('a', 100, 100, 100, 100));
    s.getState().select(['a']);
    s.getState().nudgeSelected(10, 0);
    s.getState().nudgeSelected(10, 0);
    expect(els(s)[0]).toMatchObject({ x: 120 });
    s.getState().undo();
    expect(els(s)[0]).toMatchObject({ x: 100 });
    s.getState().scaleSelected(0.5);
    expect(els(s)[0]).toMatchObject({ w: 50, h: 50 });
    s.getState().rotateSelectedBy(15);
    expect(els(s)[0]!.rotation).toBe(15);
  });

  it('shift-constrains a dragged rectangle to a square', () => {
    const s = studio();
    s.getState().setTool('rect');
    drag(s, [50, 50], [150, 80], { constrain: true });
    expect(els(s)[0]).toMatchObject({ kind: 'rect', w: 100, h: 100 });
  });
});

describe('copy, paste, duplicate and delete', () => {
  it('duplicates the selection and selects the copies', () => {
    const s = studio(box('a', 10, 10), box('b', 100, 10));
    s.getState().select(['a']);
    s.getState().duplicateSelected();
    expect(els(s)).toHaveLength(3);
    expect(sel(s)).toHaveLength(1);
    expect(sel(s)[0]).not.toBe('a');
    expect(els(s)[2]).toMatchObject({ x: 26, y: 26 });
    s.getState().undo();
    expect(els(s)).toHaveLength(2);
  });

  it('copies and pastes, moving each paste further, also into another screen', () => {
    const s = studio(box('a', 10, 10));
    s.getState().select(['a']);
    s.getState().copySelected();
    expect(s.getState().canPaste).toBe(true);
    s.getState().paste();
    s.getState().paste();
    expect(els(s).map((e) => (e as { x: number }).x)).toEqual([10, 26, 42]);
    s.getState().addPage();
    s.getState().paste();
    expect(els(s)).toHaveLength(1);
    expect(sel(s)).toHaveLength(1);
  });

  it('cuts, keeps locked objects when deleting, and deletes the rest', () => {
    const s = studio(box('a', 10, 10), box('b', 100, 10));
    s.getState().toggleLocked('b');
    s.getState().select(['a', 'b']);
    s.getState().deleteSelected();
    expect(ids(s)).toEqual(['b']);
    expect(s.getState().notice?.message).toMatch(/locked/i);
    s.getState().select(['b']);
    s.getState().deleteSelected();
    expect(ids(s)).toEqual(['b']);
    s.getState().toggleLocked('b');
    s.getState().select(['b']);
    s.getState().cutSelected();
    expect(ids(s)).toEqual([]);
  });
});

describe('order, lock, hide and hints', () => {
  it('reorders the selection', () => {
    const s = studio(box('a', 0, 0), box('b', 0, 0), box('c', 0, 0));
    s.getState().select(['a']);
    s.getState().reorderSelected('front');
    expect(ids(s)).toEqual(['b', 'c', 'a']);
    s.getState().reorderSelected('backward');
    expect(ids(s)).toEqual(['b', 'a', 'c']);
    s.getState().undo();
    expect(ids(s)).toEqual(['b', 'c', 'a']);
  });

  it('hides from the list and from selection, and brings objects back', () => {
    const s = studio(box('a', 10, 10));
    s.getState().select(['a']);
    s.getState().setHidden(true);
    expect(els(s)[0]!.hidden).toBe(true);
    expect(sel(s)).toEqual([]);
    drag(s, [20, 20], [20, 20]);
    expect(sel(s)).toEqual([]);
    s.getState().toggleHidden('a');
    expect(els(s)[0]!.hidden).toBeUndefined();
    drag(s, [20, 20], [20, 20]);
    expect(sel(s)).toEqual(['a']);
  });

  it('tags objects with a role and clears it', () => {
    const s = studio(box('a', 10, 10));
    s.getState().select(['a']);
    s.getState().setHint('total');
    expect(els(s)[0]!.hint).toBe('total');
    s.getState().setHint(null);
    expect(els(s)[0]!.hint).toBeUndefined();
  });
});

describe('limits and messages', () => {
  it('refuses new objects when the screen is full and says why', () => {
    let doc = createDocument(1, 'd');
    doc = addElements(doc, doc.pages[0]!.id, Array.from({ length: PAGE_OBJECT_CAP }, (_, i) => box(`r${i}`, 0, 0, 5, 5)));
    const s = createStudioStore(doc);
    s.getState().setTool('pen');
    s.getState().pointerDown({ x: 10, y: 10 });
    expect(s.getState().draft).toBeUndefined();
    expect(s.getState().notice?.message).toContain(String(PAGE_OBJECT_CAP));
    s.getState().insertShape('rect');
    expect(els(s)).toHaveLength(PAGE_OBJECT_CAP);
    s.getState().setTool('select');
    s.getState().select(['r0']);
    s.getState().duplicateSelected();
    expect(els(s)).toHaveLength(PAGE_OBJECT_CAP);
  });

  it('numbers each notice so the same message can show twice', () => {
    const s = studio();
    s.getState().notify('Hello');
    const first = s.getState().notice!.id;
    s.getState().notify('Hello');
    expect(s.getState().notice!.id).toBeGreaterThan(first);
  });
});

describe('insert, photos and colours', () => {
  it('inserts shapes at the page centre and selects them', () => {
    const s = studio();
    s.getState().insertShape('rect');
    s.getState().insertShape('text');
    expect(els(s).map((e) => e.kind)).toEqual(['rect', 'text']);
    expect(els(s)[0]).toMatchObject({ x: 120, y: 350, w: 160, h: 100 });
    expect(sel(s)).toEqual([els(s)[1]!.id]);
  });

  it('places a photo scaled to fit and keeps the alt text', () => {
    const s = studio();
    s.getState().placeImage({ blobId: 'blob_1', width: 1280, height: 960, alt: 'Shop front' });
    expect(els(s)[0]).toMatchObject({ kind: 'image', blobId: 'blob_1', w: 280, h: 210, alt: 'Shop front' });
    expect(s.getState().tool).toBe('select');
    s.getState().updateSelected({ alt: 'Front door' });
    expect(els(s)[0]).toMatchObject({ alt: 'Front door' });
  });

  it('remembers custom colours, newest first, and not the presets', () => {
    const s = studio();
    s.getState().setColor('#123456');
    s.getState().setColor('#654321');
    s.getState().setColor('#123456');
    s.getState().setColor(COLORS[1]!);
    expect(s.getState().recentColors).toEqual(['#123456', '#654321']);
    expect(s.getState().color).toBe(COLORS[1]);
  });

  it('recolours the selection only while the select tool is active', () => {
    const s = studio(box('a', 10, 10));
    s.getState().select(['a']);
    s.getState().setColor('#B42E25');
    expect(els(s)[0]).toMatchObject({ color: '#B42E25' });
    s.getState().setTool('pen');
    s.getState().setColor('#1D7048');
    expect(els(s)[0]).toMatchObject({ color: '#B42E25' });
  });
});

describe('screens', () => {
  it('duplicates a screen, moves to it, and keeps the original', () => {
    const s = studio(box('a', 10, 10));
    const first = s.getState().pageId;
    s.getState().duplicatePage(first);
    const pages = s.getState().history.present.pages;
    expect(pages).toHaveLength(2);
    expect(s.getState().pageId).toBe(pages[1]!.id);
    expect(pages[1]!.elements[0]!.id).not.toBe('a');
    s.getState().undo();
    expect(s.getState().history.present.pages).toHaveLength(1);
    expect(s.getState().pageId).toBe(first);
  });

  it('moves to a neighbouring screen when the current one is deleted, and back after undo', () => {
    const s = studio();
    s.getState().addPage();
    s.getState().addPage();
    const [p1, p2, p3] = s.getState().history.present.pages.map((p) => p.id);
    s.getState().selectPage(p2!);
    s.getState().removePage(p2!);
    expect(s.getState().pageId).toBe(p3);
    s.getState().undo();
    expect(s.getState().history.present.pages.map((p) => p.id)).toEqual([p1, p2, p3]);
  });

  it('sets a background and colour as undoable steps and clears a screen', () => {
    const s = studio(box('a', 10, 10));
    const pid = s.getState().pageId;
    s.getState().setPageBackground(pid, { background: 'grid' });
    s.getState().setPageBackground(pid, { backgroundColor: '#FFF4D6' });
    expect(currentPage(s.getState())).toMatchObject({ background: 'grid', backgroundColor: '#FFF4D6' });
    s.getState().clearPage();
    expect(els(s)).toHaveLength(0);
    s.getState().undo();
    expect(els(s)).toHaveLength(1);
  });

  it('survives undoing an added screen while it is open', () => {
    const s = studio();
    s.getState().addPage();
    const second = s.getState().pageId;
    s.getState().undo();
    expect(s.getState().pageId).not.toBe(second);
    expect(s.getState().history.present.pages.some((p) => p.id === s.getState().pageId)).toBe(true);
  });
});

describe('eraser', () => {
  it('rubs out part of a stroke and leaves locked strokes alone', () => {
    const s = studio();
    s.getState().setTool('pen');
    drag(s, [10, 100], [300, 100]);
    s.getState().setTool('eraser');
    s.getState().pointerDown({ x: 150, y: 100 });
    s.getState().pointerMove({ x: 160, y: 100 });
    s.getState().pointerUp();
    expect(els(s).length).toBeGreaterThanOrEqual(2);
    expect(els(s).every((e) => e.kind === 'stroke')).toBe(true);
    const before = els(s).length;
    s.getState().setTool('select');
    s.getState().toggleLocked(els(s)[0]!.id);
    s.getState().setTool('eraser');
    s.getState().pointerDown({ x: 20, y: 100 });
    s.getState().pointerUp();
    expect(els(s)).toHaveLength(before);
  });
});
