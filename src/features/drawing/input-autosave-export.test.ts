/**
 * More Studio coverage (docs/13 §5.6): pen and shape input as the canvas delivers it, autosave and restore of a drawing
 * through its stored form, and the export sizes and file names. The canvases themselves are checked in the browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DrawingDocument } from '@/core/contracts';

import { createAutosaver } from './autosave';
import {
  createDocument, exportSize, EXPORT_SCALES, MAX_EXPORT_SIDE, migrateDrawing, pageHasVisibleContent, pdfFileName, pngFileName, safeName, svgFileName,
  zipFileName,
} from './model';
import { clearRecovery, readRecovery, writeRecovery, type StorageLike } from './recovery';
import { createStudioStore, currentPage } from './studio-store';

const fresh = () => createStudioStore(createDocument(1, 'drw_t'));
const els = (s: ReturnType<typeof fresh>) => currentPage(s.getState()).elements;

describe('pen and shape input', () => {
  it('records the tool, colour and size the person had chosen', () => {
    const s = fresh();
    s.getState().setTool('marker');
    s.getState().setSize(8);
    s.getState().pointerDown({ x: 10, y: 10 });
    s.getState().pointerMove({ x: 60, y: 40 });
    s.getState().pointerUp();
    expect(els(s)[0]).toMatchObject({ kind: 'stroke', tool: 'marker', size: 8 });
  });

  it('ignores jitter smaller than a screen pixel and keeps it when zoomed in', () => {
    const s = fresh();
    s.getState().pointerDown({ x: 100, y: 100 });
    s.getState().pointerMove({ x: 100.2, y: 100.2 });
    s.getState().pointerMove({ x: 140, y: 100 });
    s.getState().pointerUp();
    const flat = els(s)[0];
    expect(flat?.kind === 'stroke' && flat.points).toHaveLength(2);
    s.getState().zoomBy(4);
    s.getState().pointerDown({ x: 300, y: 300 });
    s.getState().pointerMove({ x: 300.4, y: 300 });
    s.getState().pointerUp();
    const zoomed = els(s)[1];
    expect(zoomed?.kind === 'stroke' && zoomed.points.length).toBe(2);
  });

  it('throws a stroke away when the pointer is cancelled, for example by a palm', () => {
    const s = fresh();
    s.getState().pointerDown({ x: 10, y: 10 });
    s.getState().pointerMove({ x: 80, y: 80 });
    s.getState().cancelPointer();
    s.getState().pointerUp();
    expect(els(s)).toHaveLength(0);
    expect(s.getState().gesture).toBeUndefined();
  });

  it('keeps a square square when the shift key is held', () => {
    const s = fresh();
    s.getState().setTool('rect');
    s.getState().pointerDown({ x: 50, y: 50 });
    s.getState().pointerMove({ x: 170, y: 100 }, { constrain: true });
    s.getState().pointerUp();
    const r = els(s)[0];
    expect(r?.kind === 'rect' && Math.abs(r.w)).toBe(r?.kind === 'rect' ? Math.abs(r.h) : -1);
  });

  it('puts text and component stamps only on the screen itself', () => {
    const s = fresh();
    s.getState().setTool('text');
    s.getState().pointerDown({ x: -40, y: 20 });
    expect(s.getState().textEdit).toBeUndefined();
    s.getState().setTool('stamp');
    s.getState().pointerDown({ x: -40, y: 20 });
    s.getState().pointerUp();
    expect(els(s)).toHaveLength(0);
  });

  it('rubs out a whole shape with one touch of the eraser, and undo brings it back', () => {
    const s = fresh();
    s.getState().setTool('rect');
    s.getState().pointerDown({ x: 100, y: 100 });
    s.getState().pointerMove({ x: 220, y: 180 });
    s.getState().pointerUp();
    s.getState().setTool('eraser');
    s.getState().pointerDown({ x: 100, y: 140 });
    s.getState().pointerUp();
    expect(els(s)).toHaveLength(0);
    s.getState().undo();
    expect(els(s)).toHaveLength(1);
  });
});

describe('autosave and restore', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** What the Studio stores: the document as it is now. */
  const stored = (doc: DrawingDocument, pageId: string, now: number): DrawingDocument => ({ ...doc, schemaVersion: 1, activePageId: pageId, updatedAt: now });

  it('writes after the pause, marks a later change as unsaved again, and saves that too', async () => {
    const s = fresh();
    s.getState().setTool('rect');
    const written: DrawingDocument[] = [];
    let last: DrawingDocument | undefined;
    const saver = createAutosaver({
      isDirty: () => s.getState().history.present !== last,
      onStatus: () => undefined,
      save: async () => { const d = s.getState().history.present; written.push(d); last = d; },
    }, { debounceMs: 100 });
    const draw = (x: number) => { s.getState().pointerDown({ x, y: 10 }); s.getState().pointerMove({ x: x + 50, y: 60 }); s.getState().pointerUp(); saver.notify(); };
    draw(10);
    draw(80);
    await vi.advanceTimersByTimeAsync(150);
    expect(written).toHaveLength(1);
    expect(written[0]!.pages[0]!.elements).toHaveLength(2);
    draw(150);
    expect(s.getState().history.present).not.toBe(last);
    await vi.advanceTimersByTimeAsync(150);
    expect(written).toHaveLength(2);
    expect(await saver.flush()).toBe(true);
    saver.dispose();
  });

  it('brings a stored drawing back exactly, through JSON and validation', () => {
    const s = fresh();
    s.getState().setTool('ellipse');
    s.getState().pointerDown({ x: 30, y: 30 });
    s.getState().pointerMove({ x: 130, y: 90 });
    s.getState().pointerUp();
    s.getState().setTool('text');
    s.getState().pointerDown({ x: 60, y: 200 });
    s.getState().commitTextEdit();
    const doc = s.getState().history.present;
    const back = migrateDrawing(JSON.parse(JSON.stringify(stored(doc, s.getState().pageId, 99))));
    expect(back?.dropped).toBe(0);
    expect(back?.doc.pages[0]!.elements).toEqual(doc.pages[0]!.elements);
    expect(back?.doc.activePageId).toBe(s.getState().pageId);
  });

  it('falls back to the first screen when the saved active screen is gone', () => {
    const doc = createDocument(1, 'drw_x');
    const back = migrateDrawing({ ...doc, activePageId: 'pg_missing' });
    expect(back?.doc.activePageId).toBe(doc.pages[0]!.id);
  });

  it('cleans a damaged or hostile stored drawing instead of trusting it', () => {
    const doc = createDocument(1, 'drw_y');
    const raw = {
      ...doc,
      pages: [{
        ...doc.pages[0]!,
        elements: [
          { id: 'ok', kind: 'rect', x: 1, y: 1, w: 50, h: 50, color: '#2234C2', size: 2 },
          { id: 'nan', kind: 'rect', x: Number.NaN, y: 1, w: 50, h: 50, color: '#2234C2', size: 2 },
          { id: 'far', kind: 'rect', x: 9e12, y: 1, w: 50, h: 50, color: '#2234C2', size: 2 },
          { id: 'css', kind: 'rect', x: 1, y: 1, w: 50, h: 50, color: 'url(javascript:alert(1))', size: 2 },
          { id: 'code', kind: 'script', src: 'alert(1)' },
        ],
      }],
    };
    const back = migrateDrawing(raw);
    const kept = back?.doc.pages[0]!.elements ?? [];
    expect(kept.map((e) => e.id)).toContain('ok');
    expect(kept.some((e) => e.id === 'code' || e.id === 'nan')).toBe(false);
    for (const e of kept) if (e.kind === 'rect') expect(/^#[0-9a-f]{3,8}$/i.test(e.color)).toBe(true);
    expect((back?.dropped ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it('prefers the emergency copy of a closed tab only when it is newer', () => {
    const mem = new Map<string, string>();
    const storage: StorageLike = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
    const doc = stored(createDocument(1, 'drw_z'), 'p', 1000);
    expect(writeRecovery(storage, doc, 5000)).toBe(true);
    const emergency = migrateDrawing(readRecovery(storage, 'drw_z'));
    expect(emergency!.doc.updatedAt).toBe(5000);
    expect(emergency!.doc.updatedAt > doc.updatedAt).toBe(true);
    clearRecovery(storage, 'drw_z');
    expect(readRecovery(storage, 'drw_z')).toBeUndefined();
  });
});

describe('export sizes and names', () => {
  it('never asks for a picture bigger than the limit, however long the page or sharp the scale', () => {
    for (const scale of EXPORT_SCALES) {
      const s = exportSize({ width: 1000, height: 8000 }, scale);
      expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(MAX_EXPORT_SIDE);
      expect(s.width).toBeGreaterThanOrEqual(1);
    }
    expect(exportSize({ width: 390, height: 844 }, 2)).toEqual({ width: 780, height: 1688, scale: 2 });
    expect(exportSize({ width: 390, height: 844 }, 0).width).toBeGreaterThanOrEqual(1);
  });

  it('keeps the shape of the page when it is scaled down', () => {
    const s = exportSize({ width: 1000, height: 8000 }, 4);
    expect(s.width / s.height).toBeCloseTo(1000 / 8000, 1);
  });

  it('makes safe file names in any script and never lets a path through', () => {
    expect(safeName('दर्ज़ी ऑर्डर बुक', 'x')).toBe('दर्ज़ी-ऑर्डर-बुक');
    expect(safeName('../../etc/passwd', 'x')).not.toMatch(/[/\\.]/);
    expect(safeName('   ', 'fallback')).toBe('fallback');
    expect(safeName('a'.repeat(200), 'x').length).toBeLessThanOrEqual(48);
  });

  it('names the files of one screen and of many', () => {
    expect(pngFileName('Tailor book', 'Home', 0, 1, false)).toBe('Tailor-book-Home.png');
    expect(pngFileName('Tailor book', 'Home', 1, 2, true)).toBe('Tailor-book-2-Home@2x.png');
    expect(svgFileName('Tailor book', '', 2, true)).toBe('Tailor-book-3-screen-3.svg');
    expect(pdfFileName('Tailor book')).toBe('Tailor-book.pdf');
    expect(zipFileName('Tailor book')).toBe('Tailor-book-screens.zip');
  });

  it('exports only screens with something you can see', () => {
    const doc = createDocument(1, 'drw_e');
    const page = doc.pages[0]!;
    expect(pageHasVisibleContent(page)).toBe(false);
    expect(pageHasVisibleContent({ ...page, elements: [{ id: 'a', kind: 'rect', x: 1, y: 1, w: 10, h: 10, color: '#2234C2', size: 2, hidden: true }] })).toBe(false);
    expect(pageHasVisibleContent({ ...page, elements: [{ id: 'a', kind: 'rect', x: 1, y: 1, w: 10, h: 10, color: '#2234C2', size: 2 }] })).toBe(true);
  });
});
