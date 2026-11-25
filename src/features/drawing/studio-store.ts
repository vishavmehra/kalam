/**
 * Drawing Studio state (docs/08 §7–§13). One zustand store per open studio. Pointer handlers
 * receive document-space points, so the web canvas and the Android Skia canvas share every tool
 * behaviour; renderers only translate input and draw `selectBase` + `selectOverlay`.
 *
 * Every edit goes through `apply`, which is one undoable history step (docs/08 §12). Gestures
 * (drawing, moving, resizing, turning, erasing) work on a preview and commit once on pointer up.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DrawingDocument, DrawingElement, DrawingPage, DrawingPoint } from '@/core/contracts';
import {
  addElement, addPage, canAddElements, canRedo, canUndo, clearPage, commit, createDocument, createHistory,
  duplicateElements, duplicatePage, elementsInRect, eraseSweep, hitHandle, hitTest, INK_COLORS,
  constrainDrag, lockAspect, movePage, newId, normalizeBox, PAGE_HEIGHT, PAGE_OBJECT_CAP, PAGE_WIDTH, pasteElements, pickElements,
  pointerAngle, redo, removeElements, removePage, renamePage, reorderElements, replaceElements, resizeElements,
  rotateDrag, rotateElements, scaleSelection, selectionFrame, setFlags, setPageBackground, setPageElements,
  setTitle, STAMPS, translateElement, undo, updateElements,
  type Bounds, type DrawingHint, type Frame, type History, type HandleId, type PageBackground, type ReorderMode,
  type ResizeHandle, type StampComponent,
} from './model';
import { clamp, currentPage, fitView } from './studio-view';

export {
  canvasLabel, currentPage, describeElement, selectBase, selectChrome, selectLive, selectOverlay, selectPrimitives, TOOL_LABELS, toDocPoint,
} from './studio-view';

export type Tool =
  | 'select' | 'pen' | 'marker' | 'highlighter' | 'eraser' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'stamp';
export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';
export interface ViewTransform { scale: number; tx: number; ty: number }
export interface TextEdit { x: number; y: number; id?: string; text: string; fontSize: number; color: string }
export interface Notice { id: number; message: string }

export const COLORS: readonly string[] = INK_COLORS.map((c) => c.value);
export const COLOR_NAMES: Readonly<Record<string, string>> = Object.fromEntries(INK_COLORS.map((c) => [c.value, c.name]));
export const SIZES = [2, 4, 8, 14] as const;
export const isInkTool = (t: Tool) => t === 'pen' || t === 'marker' || t === 'highlighter';

export type Gesture =
  | { kind: 'draw' | 'erase' | 'shape'; origin: DrawingPoint; last: DrawingPoint }
  | { kind: 'move'; origin: DrawingPoint; last: DrawingPoint; start: readonly DrawingElement[]; key?: string; warned?: boolean }
  | { kind: 'marquee'; origin: DrawingPoint; last: DrawingPoint; base: readonly string[] }
  | { kind: 'resize'; origin: DrawingPoint; last: DrawingPoint; handle: ResizeHandle; start: readonly DrawingElement[]; frame: Frame; keepAspect: boolean }
  | { kind: 'rotate'; origin: DrawingPoint; last: DrawingPoint; start: readonly DrawingElement[]; frame: Frame; angle0: number };

export interface PlacedImage { blobId: string; width: number; height: number; alt?: string }

export interface StudioState {
  history: History<DrawingDocument>;
  pageId: string;
  tool: Tool;
  color: string;
  size: number;
  /** Colours picked with the colour box, newest first (docs/08 §7.10). */
  recentColors: readonly string[];
  stamp: StampComponent;
  /** Selected object ids on the current page, in the order they were picked. */
  selectedIds: readonly string[];
  /** Touch multi-select: taps add to or remove from the selection (docs/08 §9.4). */
  multiSelect: boolean;
  draft?: DrawingElement;
  /** Working copy of the page while the eraser is down; committed as one step on release. */
  erasing?: DrawingPage;
  /** Objects being moved, resized or turned, keyed by id. Committed on release. */
  preview?: ReadonlyMap<string, DrawingElement>;
  marquee?: Bounds;
  gesture?: Gesture;
  textEdit?: TextEdit;
  view: ViewTransform;
  viewport: { w: number; h: number };
  saveStatus: SaveStatus;
  loaded: boolean;
  /** Latest message for the person (page full, locked object, nothing to paste). The screen shows it as a toast. */
  notice?: Notice;
  canPaste: boolean;

  load(doc: DrawingDocument): void;
  setTool(t: Tool): void;
  setColor(c: string): void;
  setSize(s: number): void;
  setStamp(s: StampComponent): void;
  undo(): void;
  redo(): void;
  pointerDown(p: DrawingPoint, opts?: { additive?: boolean }): void;
  /** `constrain` (Shift): squares, circles, 45 degree lines, and proportional resize. */
  pointerMove(p: DrawingPoint, opts?: { constrain?: boolean }): void;
  pointerUp(): void;
  cancelPointer(): void;
  /** Handle under a point, for the hover cursor. */
  handleAt(p: DrawingPoint): HandleId | undefined;
  updateTextEdit(text: string): void;
  commitTextEdit(): void;
  cancelTextEdit(): void;

  select(ids: readonly string[]): void;
  toggleSelect(id: string): void;
  selectAll(): void;
  clearSelection(): void;
  setMultiSelect(on: boolean): void;
  deleteSelected(): void;
  duplicateSelected(): void;
  copySelected(): void;
  cutSelected(): void;
  paste(): void;
  reorderSelected(mode: ReorderMode): void;
  setLocked(locked: boolean, ids?: readonly string[]): void;
  setHidden(hidden: boolean, ids?: readonly string[]): void;
  toggleLocked(id: string): void;
  toggleHidden(id: string): void;
  setHint(hint: DrawingHint | null): void;
  nudgeSelected(dx: number, dy: number): void;
  scaleSelected(factor: number): void;
  rotateSelectedBy(deg: number): void;
  updateSelected(patch: { color?: string; size?: number; label?: string; text?: string; alt?: string }): void;
  placeImage(img: PlacedImage): void;
  /** Adds a shape or label in the middle of the page without dragging (docs/10 §10.3). */
  insertShape(kind: 'rect' | 'ellipse' | 'line' | 'arrow' | 'text'): void;

  selectPage(id: string): void;
  addPage(): void;
  removePage(id: string): void;
  renamePage(id: string, title: string): void;
  movePage(id: string, dir: -1 | 1): void;
  duplicatePage(id: string): void;
  setPageBackground(id: string, patch: { background?: PageBackground; backgroundColor?: string | null }): void;
  clearPage(): void;
  setTitle(title: string): void;
  setViewport(w: number, h: number): void;
  fitPage(): void;
  zoomBy(factor: number, cx?: number, cy?: number): void;
  panBy(dx: number, dy: number): void;
  setSaveStatus(s: SaveStatus): void;
  notify(message: string): void;
}

const fontSizeFor = (size: number) => clamp(size * 3 + 12, 14, 52);
const capMessage = () => `This screen already has ${PAGE_OBJECT_CAP} objects, the most it can hold. Delete some to add more.`;

/** Copied objects, shared by every studio so a drawing can be pasted into another one. */
let clipboard: readonly DrawingElement[] = [];
let pasteCount = 0;
let noticeSeq = 0;

/** Keeps the active page and selection valid after the document changes (undo can remove either). */
function reconcile(doc: DrawingDocument, pageId: string, selected: readonly string[]): Partial<StudioState> {
  const id = doc.pages.some((p) => p.id === pageId) ? pageId : doc.pages[0]!.id;
  const page = doc.pages.find((p) => p.id === id)!;
  const alive = new Set(page.elements.map((e) => e.id));
  const kept = selected.filter((s) => alive.has(s));
  return { pageId: id, ...(kept.length === selected.length ? {} : { selectedIds: kept }) };
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const rectOf = (a: DrawingPoint, b: DrawingPoint): Bounds => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
const toMap = (prev: readonly DrawingElement[], next: readonly DrawingElement[]) => new Map(prev.map((el, i) => [el.id, next[i]!] as const));

export function createStudioStore(initial: DrawingDocument = createDocument()): StoreApi<StudioState> {
  return createStore<StudioState>()((set, get) => {
    /** Commit a new document version (one undo step). */
    const apply = (next: DrawingDocument, coalesceKey?: string) => {
      const s = get();
      if (next === s.history.present) return;
      const history = commit(s.history, next, coalesceKey ? { coalesceKey } : {});
      set({ history, saveStatus: 'unsaved', ...reconcile(history.present, s.pageId, s.selectedIds) });
    };
    const page = () => currentPage(get());
    const notify = (message: string) => set({ notice: { id: ++noticeSeq, message } });
    const selectedEls = (): DrawingElement[] => {
      const ids = new Set(get().selectedIds);
      return ids.size ? page().elements.filter((e) => ids.has(e.id)) : [];
    };
    const editableSelected = () => selectedEls().filter((e) => !e.locked);
    const full = (count = 1): boolean => {
      if (canAddElements(page(), count)) return false;
      notify(capMessage());
      return true;
    };
    const eraserRadius = () => Math.max(6, get().size * 2) / get().view.scale;
    const clearGesture = () => set({ gesture: undefined, draft: undefined, erasing: undefined, preview: undefined, marquee: undefined });
    /** Replace the editable selection with transformed copies, as one history step. */
    const commitTransform = (make: (els: readonly DrawingElement[]) => DrawingElement[], key?: string) => {
      const els = editableSelected();
      if (els.length === 0) return;
      const s = get();
      apply(replaceElements(s.history.present, s.pageId, toMap(els, make(els))), key);
    };
    const resetTransient = () => set({ selectedIds: [], preview: undefined, marquee: undefined });

    return {
      history: createHistory(initial),
      pageId: initial.activePageId && initial.pages.some((p) => p.id === initial.activePageId) ? initial.activePageId : initial.pages[0]!.id,
      tool: 'pen',
      color: COLORS[0]!,
      size: 4,
      recentColors: [],
      stamp: 'bigButton',
      selectedIds: [],
      multiSelect: false,
      view: { scale: 1, tx: 0, ty: 0 },
      viewport: { w: 0, h: 0 },
      saveStatus: 'saved',
      loaded: false,
      canPaste: clipboard.length > 0,

      load: (doc) => set({
        history: createHistory(doc),
        pageId: doc.activePageId && doc.pages.some((p) => p.id === doc.activePageId) ? doc.activePageId : doc.pages[0]!.id,
        loaded: true, saveStatus: 'saved',
        selectedIds: [], draft: undefined, textEdit: undefined, erasing: undefined, preview: undefined, marquee: undefined, gesture: undefined,
      }),
      setTool: (tool) => {
        get().commitTextEdit();
        set({ tool, ...(tool === 'select' ? {} : { selectedIds: [] }), multiSelect: tool === 'select' ? get().multiSelect : false });
      },
      setColor: (color) => {
        const known = COLORS.includes(color);
        set((s) => ({ color, ...(known ? {} : { recentColors: [color, ...s.recentColors.filter((c) => c !== color)].slice(0, 6) }) }));
        if (get().tool === 'select' && get().selectedIds.length) get().updateSelected({ color });
      },
      setSize: (size) => {
        set({ size });
        if (get().tool === 'select' && get().selectedIds.length) get().updateSelected({ size });
      },
      setStamp: (stamp) => set({ stamp, tool: 'stamp' }),
      undo: () => {
        const s = get();
        const history = undo(s.history);
        set({ history, saveStatus: 'unsaved', ...reconcile(history.present, s.pageId, s.selectedIds) });
      },
      redo: () => {
        const s = get();
        const history = redo(s.history);
        set({ history, saveStatus: 'unsaved', ...reconcile(history.present, s.pageId, s.selectedIds) });
      },

      pointerDown: (p, opts) => {
        const s = get();
        if (s.textEdit) s.commitTextEdit();
        const origin = { origin: p, last: p };
        const onPage = p.x >= 0 && p.y >= 0 && p.x <= PAGE_WIDTH && p.y <= PAGE_HEIGHT;
        // Labels and components only make sense on the screen itself.
        if (!onPage && (s.tool === 'text' || s.tool === 'stamp')) return;
        switch (s.tool) {
          case 'pen': case 'marker': case 'highlighter':
            if (full()) return;
            set({
              gesture: { kind: 'draw', ...origin },
              draft: { id: newId('el'), kind: 'stroke', tool: s.tool, color: s.color, size: s.size, points: [p] },
            });
            return;
          case 'eraser': {
            const next = eraseSweep(page(), p, p, eraserRadius());
            set({ gesture: { kind: 'erase', ...origin }, erasing: next === page() ? undefined : next });
            return;
          }
          case 'rect': case 'ellipse': case 'line': case 'arrow':
            if (full()) return;
            set({
              gesture: { kind: 'shape', ...origin },
              draft: { id: newId('el'), kind: s.tool, x: p.x, y: p.y, w: 0, h: 0, color: s.color, size: s.size },
            });
            return;
          case 'stamp': {
            if (full()) return;
            const def = STAMPS.find((d) => d.component === s.stamp)!;
            const el: DrawingElement = {
              id: newId('el'), kind: 'stamp', component: def.component, label: def.label,
              x: clamp(p.x - def.w / 2, 0, PAGE_WIDTH - def.w), y: clamp(p.y - def.h / 2, 0, PAGE_HEIGHT - def.h),
              w: def.w, h: def.h,
            };
            const key = `place:${el.id}`;
            apply(addElement(s.history.present, s.pageId, el), key);
            const placed = page().elements.find((e) => e.id === el.id) ?? el;
            set({ selectedIds: [el.id], gesture: { kind: 'move', ...origin, start: [placed], key } });
            return;
          }
          case 'text': {
            const hit = hitTest(page(), p);
            const existing = hit ? page().elements.find((e) => e.id === hit) : undefined;
            if (existing?.kind === 'text') {
              if (existing.locked) { notify('That text is locked. Unlock it to change it.'); return; }
              set({ textEdit: { id: existing.id, x: existing.x, y: existing.y, text: existing.text, fontSize: existing.fontSize, color: existing.color } });
            } else {
              if (full()) return;
              set({ textEdit: { x: p.x, y: p.y, text: '', fontSize: fontSizeFor(s.size), color: s.color } });
            }
            return;
          }
          case 'select': {
            const editable = editableSelected();
            const frame = editable.length ? selectionFrame(editable) : undefined;
            const handle = frame ? hitHandle(frame, p, s.view.scale) : undefined;
            if (frame && handle) {
              set({
                gesture: handle === 'rotate'
                  ? { kind: 'rotate', ...origin, start: editable, frame, angle0: pointerAngle(frame, p) }
                  : { kind: 'resize', ...origin, handle, start: editable, frame, keepAspect: lockAspect(editable) },
              });
              return;
            }
            const hitId = hitTest(page(), p, 8 / s.view.scale);
            const additive = !!opts?.additive || s.multiSelect;
            if (hitId) {
              let ids = s.selectedIds;
              if (additive) {
                if (ids.includes(hitId)) { set({ selectedIds: ids.filter((i) => i !== hitId) }); return; }
                ids = [...ids, hitId];
              } else if (!ids.includes(hitId)) {
                ids = [hitId];
              }
              const idSet = new Set(ids);
              const start = page().elements.filter((e) => idSet.has(e.id) && !e.locked);
              set({ selectedIds: ids, gesture: { kind: 'move', ...origin, start } });
            } else {
              const base = additive ? s.selectedIds : [];
              set({ selectedIds: base, gesture: { kind: 'marquee', ...origin, base } });
            }
          }
        }
      },

      pointerMove: (p, opts) => {
        const s = get();
        const g = s.gesture;
        if (!g) return;
        if (Math.hypot(p.x - g.last.x, p.y - g.last.y) < 0.6 / s.view.scale) return;
        switch (g.kind) {
          case 'draw':
            if (s.draft?.kind === 'stroke') set({ gesture: { ...g, last: p }, draft: { ...s.draft, points: [...s.draft.points, p] } });
            return;
          case 'erase': {
            const base = s.erasing ?? page();
            const next = eraseSweep(base, g.last, p, eraserRadius());
            set({ gesture: { ...g, last: p }, ...(next !== base ? { erasing: next } : {}) });
            return;
          }
          case 'shape':
            if (s.draft && s.draft.kind !== 'stroke' && s.draft.kind !== 'text' && s.draft.kind !== 'stamp' && s.draft.kind !== 'image') {
              const d = opts?.constrain ? constrainDrag(s.draft.kind, p.x - g.origin.x, p.y - g.origin.y) : { w: p.x - g.origin.x, h: p.y - g.origin.y };
              set({ gesture: { ...g, last: p }, draft: { ...s.draft, ...d } });
            }
            return;
          case 'move': {
            if (g.start.length === 0) {
              if (!g.warned) { notify('That object is locked. Unlock it to move it.'); set({ gesture: { ...g, warned: true } }); }
              return;
            }
            const dx = p.x - g.origin.x; const dy = p.y - g.origin.y;
            set({ gesture: { ...g, last: p }, preview: new Map(g.start.map((el) => [el.id, translateElement(el, dx, dy)] as const)) });
            return;
          }
          case 'marquee': {
            const rect = rectOf(g.origin, p);
            const hits = elementsInRect(page(), rect);
            const ids = [...g.base, ...hits.filter((id) => !g.base.includes(id))];
            set({ gesture: { ...g, last: p }, marquee: rect, ...(sameIds(ids, s.selectedIds) ? {} : { selectedIds: ids }) });
            return;
          }
          case 'resize':
            set({ gesture: { ...g, last: p }, preview: toMap(g.start, resizeElements(g.start, g.frame, g.handle, p, g.keepAspect || !!opts?.constrain)) });
            return;
          case 'rotate':
            set({ gesture: { ...g, last: p }, preview: toMap(g.start, rotateDrag(g.start, g.frame, g.angle0, p)) });
        }
      },

      pointerUp: () => {
        const s = get();
        const g = s.gesture;
        if (!g) return;
        let doc = s.history.present;
        let key: string | undefined;
        if (g.kind === 'draw' && s.draft) {
          doc = addElement(doc, s.pageId, s.draft);
        } else if (g.kind === 'erase' && s.erasing) {
          doc = setPageElements(doc, s.pageId, s.erasing.elements);
        } else if (g.kind === 'shape' && s.draft && s.draft.kind !== 'stroke' && s.draft.kind !== 'text' && s.draft.kind !== 'stamp' && s.draft.kind !== 'image') {
          const d = s.draft;
          if (Math.abs(d.w) > 3 || Math.abs(d.h) > 3) {
            doc = addElement(doc, s.pageId, d.kind === 'rect' || d.kind === 'ellipse' ? normalizeBox(d) : d);
          }
        } else if ((g.kind === 'move' || g.kind === 'resize' || g.kind === 'rotate') && s.preview?.size) {
          doc = replaceElements(doc, s.pageId, s.preview);
          if (g.kind === 'move') key = g.key;
        }
        clearGesture();
        apply(doc, key);
      },

      cancelPointer: () => clearGesture(),

      handleAt: (p) => {
        const s = get();
        if (s.tool !== 'select') return undefined;
        const editable = editableSelected();
        const frame = editable.length ? selectionFrame(editable) : undefined;
        return frame ? hitHandle(frame, p, s.view.scale) : undefined;
      },

      updateTextEdit: (text) => set((s) => (s.textEdit ? { textEdit: { ...s.textEdit, text } } : s)),
      commitTextEdit: () => {
        const s = get();
        const t = s.textEdit;
        if (!t) return;
        set({ textEdit: undefined });
        const text = t.text.replace(/\s+$/, '');
        let doc = s.history.present;
        if (t.id) {
          doc = text
            ? updateElements(doc, s.pageId, new Set([t.id]), (el) => (el.kind === 'text' ? { ...el, text } : el))
            : removeElements(doc, s.pageId, new Set([t.id]));
        } else if (text) {
          if (!canAddElements(page())) { notify(capMessage()); return; }
          doc = addElement(doc, s.pageId, { id: newId('el'), kind: 'text', x: t.x, y: t.y, text, color: t.color, fontSize: t.fontSize });
        }
        apply(doc);
      },
      cancelTextEdit: () => set({ textEdit: undefined }),

      select: (ids) => set({ selectedIds: ids }),
      toggleSelect: (id) => set((s) => ({ selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((i) => i !== id) : [...s.selectedIds, id] })),
      selectAll: () => set({ selectedIds: page().elements.filter((e) => !e.hidden && !e.locked).map((e) => e.id) }),
      clearSelection: () => set({ selectedIds: [] }),
      setMultiSelect: (multiSelect) => set({ multiSelect }),

      deleteSelected: () => {
        const sel = selectedEls();
        if (sel.length === 0) return;
        const ids = new Set(sel.filter((e) => !e.locked).map((e) => e.id));
        if (ids.size === 0) { notify('That object is locked. Unlock it to delete it.'); return; }
        const s = get();
        apply(removeElements(s.history.present, s.pageId, ids));
        if (ids.size < sel.length) notify('Locked objects were kept.');
      },
      duplicateSelected: () => {
        const sel = selectedEls();
        if (sel.length === 0 || full(sel.length)) return;
        const s = get();
        const res = duplicateElements(s.history.present, s.pageId, new Set(sel.map((e) => e.id)));
        if (res.ids.length === 0) return;
        apply(res.doc);
        set({ selectedIds: res.ids });
      },
      copySelected: () => {
        const sel = selectedEls();
        if (sel.length === 0) return;
        clipboard = pickElements(page(), new Set(sel.map((e) => e.id)));
        pasteCount = 0;
        set({ canPaste: true });
      },
      cutSelected: () => {
        get().copySelected();
        get().deleteSelected();
      },
      paste: () => {
        if (clipboard.length === 0) { notify('Nothing to paste. Copy something first.'); return; }
        if (full(clipboard.length)) return;
        pasteCount += 1;
        const s = get();
        const res = pasteElements(s.history.present, s.pageId, clipboard, 16 * (((pasteCount - 1) % 10) + 1));
        if (res.ids.length === 0) return;
        apply(res.doc);
        set({ selectedIds: res.ids, tool: 'select' });
      },
      reorderSelected: (mode) => {
        const ids = new Set(editableSelected().map((e) => e.id));
        const s = get();
        apply(reorderElements(s.history.present, s.pageId, ids, mode));
      },
      setLocked: (locked, ids) => {
        const target = new Set(ids ?? get().selectedIds);
        const s = get();
        apply(setFlags(s.history.present, s.pageId, target, { locked }));
      },
      setHidden: (hidden, ids) => {
        const target = new Set(ids ?? get().selectedIds);
        const s = get();
        apply(setFlags(s.history.present, s.pageId, target, { hidden }));
        if (hidden && !ids) set({ selectedIds: [] });
      },
      toggleLocked: (id) => {
        const el = page().elements.find((e) => e.id === id);
        if (el) get().setLocked(!el.locked, [id]);
      },
      toggleHidden: (id) => {
        const el = page().elements.find((e) => e.id === id);
        if (el) get().setHidden(!el.hidden, [id]);
      },
      setHint: (hint) => {
        const ids = new Set(get().selectedIds);
        const s = get();
        apply(setFlags(s.history.present, s.pageId, ids, { hint }));
      },
      nudgeSelected: (dx, dy) => commitTransform((els) => els.map((el) => translateElement(el, dx, dy)), 'nudge'),
      scaleSelected: (factor) => commitTransform((els) => scaleSelection(els, factor), 'scale'),
      rotateSelectedBy: (deg) => commitTransform((els) => {
        const frame = selectionFrame(els);
        return frame ? rotateElements(els, frame, deg) : [...els];
      }, 'rotate'),
      updateSelected: (patch) => {
        const ids = new Set(editableSelected().map((e) => e.id));
        if (ids.size === 0) return;
        const s = get();
        const text = patch.label !== undefined || patch.text !== undefined || patch.alt !== undefined;
        apply(updateElements(s.history.present, s.pageId, ids, (el) => {
          switch (el.kind) {
            case 'stamp': return patch.label !== undefined ? { ...el, label: patch.label.slice(0, 60) } : el;
            case 'image': return patch.alt !== undefined ? { ...el, alt: patch.alt.slice(0, 200) } : el;
            case 'text': return {
              ...el,
              ...(patch.color ? { color: patch.color } : {}),
              ...(patch.size ? { fontSize: fontSizeFor(patch.size) } : {}),
              ...(patch.text !== undefined ? { text: patch.text } : {}),
            };
            default: return { ...el, ...(patch.color ? { color: patch.color } : {}), ...(patch.size ? { size: patch.size } : {}) };
          }
        }), text ? `edit:${[...ids].join(',')}` : undefined);
      },
      insertShape: (kind) => {
        if (full()) return;
        const s = get();
        const mid = { x: PAGE_WIDTH / 2, y: PAGE_HEIGHT / 2 };
        const base = { id: newId('el'), color: s.color, size: s.size };
        const el: DrawingElement = kind === 'text'
          ? { id: newId('el'), kind: 'text', x: mid.x - 40, y: mid.y - 12, text: 'Label', color: s.color, fontSize: fontSizeFor(s.size) }
          : kind === 'line' || kind === 'arrow'
            ? { ...base, kind, x: mid.x - 80, y: mid.y, w: 160, h: 0 }
            : { ...base, kind, x: mid.x - 80, y: mid.y - 50, w: 160, h: 100 };
        apply(addElement(s.history.present, s.pageId, el));
        set({ selectedIds: [el.id], tool: 'select' });
      },
      placeImage: (img) => {
        if (full()) return;
        const fit = Math.min(1, 280 / Math.max(img.width, 1), 360 / Math.max(img.height, 1));
        const w = Math.max(16, Math.round(img.width * fit)); const h = Math.max(16, Math.round(img.height * fit));
        const el: DrawingElement = {
          id: newId('el'), kind: 'image', blobId: img.blobId, w, h,
          x: Math.round((PAGE_WIDTH - w) / 2), y: Math.round((PAGE_HEIGHT - h) / 2), ...(img.alt ? { alt: img.alt } : {}),
        };
        const s = get();
        apply(addElement(s.history.present, s.pageId, el));
        set({ selectedIds: [el.id], tool: 'select' });
      },

      selectPage: (pageId) => { get().commitTextEdit(); set({ pageId }); resetTransient(); },
      addPage: () => {
        const s = get();
        const res = addPage(s.history.present, s.pageId);
        if (res.doc === s.history.present) { notify('This drawing already has the most screens it can hold.'); return; }
        apply(res.doc);
        set({ pageId: res.pageId });
        resetTransient();
      },
      removePage: (id) => {
        const s = get();
        const pages = s.history.present.pages;
        const doc = removePage(s.history.present, id);
        if (doc === s.history.present) return;
        const i = pages.findIndex((p) => p.id === id);
        const nextId = s.pageId === id ? (pages[i + 1] ?? pages[i - 1])!.id : s.pageId;
        apply(doc);
        set({ pageId: nextId });
        if (nextId !== s.pageId) resetTransient();
      },
      renamePage: (id, title) => apply(renamePage(get().history.present, id, title.slice(0, 60)), `page:${id}`),
      movePage: (id, dir) => apply(movePage(get().history.present, id, dir)),
      duplicatePage: (id) => {
        const s = get();
        const res = duplicatePage(s.history.present, id);
        if (!res.pageId) { notify('This drawing already has the most screens it can hold.'); return; }
        apply(res.doc);
        set({ pageId: res.pageId });
        resetTransient();
      },
      setPageBackground: (id, patch) => apply(setPageBackground(get().history.present, id, patch), `bg:${id}`),
      clearPage: () => {
        apply(clearPage(get().history.present, get().pageId));
        set({ selectedIds: [] });
      },
      setTitle: (title) => apply(setTitle(get().history.present, title.slice(0, 60)), 'title'),

      setViewport: (w, h) => {
        const s = get();
        const first = s.viewport.w === 0;
        set({ viewport: { w, h }, ...(first ? { view: fitView(w, h) } : {}) });
      },
      fitPage: () => set((s) => ({ view: fitView(s.viewport.w, s.viewport.h) })),
      zoomBy: (factor, cx, cy) => set((s) => {
        const scale = clamp(s.view.scale * factor, 0.2, 6);
        const k = scale / s.view.scale;
        const x = cx ?? s.viewport.w / 2; const y = cy ?? s.viewport.h / 2;
        return { view: { scale, tx: x - (x - s.view.tx) * k, ty: y - (y - s.view.ty) * k } };
      }),
      panBy: (dx, dy) => set((s) => ({ view: { ...s.view, tx: s.view.tx + dx, ty: s.view.ty + dy } })),
      setSaveStatus: (saveStatus) => set({ saveStatus }),
      notify,
    };
  });
}

export const canUndoStudio = (s: StudioState) => canUndo(s.history);
export const canRedoStudio = (s: StudioState) => canRedo(s.history);
