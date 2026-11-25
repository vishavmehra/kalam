/**
 * Pure drawing-document operations (docs/08 §5, §10, §11). Every function returns a new document
 * and never mutates its input, so history snapshots can share structure safely. Array order is the
 * stacking order (last = on top); `zIndex` mirrors it for readers outside the studio.
 */
import type { DrawingDocument, DrawingElement, DrawingElementCommon, DrawingPage } from '@/core/contracts';
import {
  DRAWING_SCHEMA_VERSION, MAX_PAGES, PAGE_HEIGHT, PAGE_OBJECT_CAP, PAGE_WIDTH, type PageBackground,
} from './constants';
import { translateElement } from './geometry';

export type StampComponent = 'bigButton' | 'list' | 'textInput' | 'heading' | 'stat' | 'photo' | 'toggle';

/** Component stamps give the compiler deterministic structure (docs/07 §14.5). */
export const STAMPS: ReadonlyArray<{ component: StampComponent; name: string; label: string; w: number; h: number }> = [
  { component: 'heading', name: 'Heading', label: 'Heading', w: 300, h: 44 },
  { component: 'textInput', name: 'Text input', label: 'Name', w: 320, h: 64 },
  { component: 'bigButton', name: 'Button', label: 'Save', w: 240, h: 56 },
  { component: 'list', name: 'List', label: 'Items', w: 320, h: 180 },
  { component: 'stat', name: 'Stat', label: 'Total', w: 150, h: 96 },
  { component: 'photo', name: 'Photo', label: 'Photo', w: 200, h: 150 },
  { component: 'toggle', name: 'Toggle', label: 'Done', w: 240, h: 44 },
];

let seq = 0;
export function newId(prefix: string): string {
  seq = (seq + 1) % 1_679_616;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createPage(index: number, id = newId('pg')): DrawingPage {
  return { id, title: `Screen ${index + 1}`, width: PAGE_WIDTH, height: PAGE_HEIGHT, elements: [] };
}

export function createDocument(now = Date.now(), id = newId('drw')): DrawingDocument {
  const page = createPage(0);
  return {
    id, title: 'Untitled sketch', createdAt: now, updatedAt: now, pages: [page],
    schemaVersion: DRAWING_SCHEMA_VERSION, activePageId: page.id,
  };
}

function mapPage(doc: DrawingDocument, pageId: string, fn: (p: DrawingPage) => DrawingPage): DrawingDocument {
  let changed = false;
  const pages = doc.pages.map((p) => {
    if (p.id !== pageId) return p;
    const next = fn(p);
    if (next !== p) changed = true;
    return next;
  });
  return changed ? { ...doc, pages } : doc;
}

export function getPage(doc: DrawingDocument, pageId: string): DrawingPage | undefined {
  return doc.pages.find((p) => p.id === pageId);
}

export const pageObjectCount = (page: DrawingPage): number => page.elements.length;
export const isPageEmpty = (page: DrawingPage): boolean => page.elements.length === 0;

// ── Pages ───────────────────────────────────────────────────────────────────────────────────────

export function setTitle(doc: DrawingDocument, title: string): DrawingDocument {
  return title === doc.title ? doc : { ...doc, title };
}

export function addPage(doc: DrawingDocument, afterPageId?: string): { doc: DrawingDocument; pageId: string } {
  if (doc.pages.length >= MAX_PAGES) return { doc, pageId: doc.pages[doc.pages.length - 1]!.id };
  const page = createPage(doc.pages.length);
  const at = afterPageId ? doc.pages.findIndex((p) => p.id === afterPageId) + 1 : doc.pages.length;
  const pages = [...doc.pages];
  pages.splice(at <= 0 ? pages.length : at, 0, page);
  return { doc: { ...doc, pages }, pageId: page.id };
}

/** Removes a page; a document always keeps at least one page (docs/08 §11.4). */
export function removePage(doc: DrawingDocument, pageId: string): DrawingDocument {
  if (doc.pages.length <= 1 || !doc.pages.some((p) => p.id === pageId)) return doc;
  return { ...doc, pages: doc.pages.filter((p) => p.id !== pageId) };
}

export function renamePage(doc: DrawingDocument, pageId: string, title: string): DrawingDocument {
  return mapPage(doc, pageId, (p) => (p.title === title ? p : { ...p, title }));
}

export function movePage(doc: DrawingDocument, pageId: string, direction: -1 | 1): DrawingDocument {
  const i = doc.pages.findIndex((p) => p.id === pageId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= doc.pages.length) return doc;
  const pages = [...doc.pages];
  [pages[i], pages[j]] = [pages[j]!, pages[i]!];
  return { ...doc, pages };
}

/** Copies a page (new id, new object ids) right after the original. `pageId` is undefined when the page limit is reached. */
export function duplicatePage(doc: DrawingDocument, pageId: string): { doc: DrawingDocument; pageId: string | undefined } {
  const i = doc.pages.findIndex((p) => p.id === pageId);
  if (i < 0 || doc.pages.length >= MAX_PAGES) return { doc, pageId: undefined };
  const src = doc.pages[i]!;
  const copy: DrawingPage = {
    ...src,
    id: newId('pg'),
    title: `${src.title} copy`.slice(0, 60),
    elements: cloneElements(src.elements, 0, true),
  };
  const pages = [...doc.pages];
  pages.splice(i + 1, 0, copy);
  return { doc: { ...doc, pages }, pageId: copy.id };
}

/** `colour: null` goes back to the default paper. */
export function setPageBackground(
  doc: DrawingDocument, pageId: string, patch: { background?: PageBackground; backgroundColor?: string | null },
): DrawingDocument {
  return mapPage(doc, pageId, (p) => {
    const background = patch.background ?? p.background;
    const backgroundColor = patch.backgroundColor === undefined ? p.backgroundColor : patch.backgroundColor ?? undefined;
    if (background === p.background && backgroundColor === p.backgroundColor) return p;
    return { ...p, background, backgroundColor };
  });
}

export function clearPage(doc: DrawingDocument, pageId: string): DrawingDocument {
  return mapPage(doc, pageId, (p) => (p.elements.length ? { ...p, elements: [] } : p));
}

// ── Elements ────────────────────────────────────────────────────────────────────────────────────

/**
 * A group of one is not a group. After objects are deleted or erased, the last member of a group lets go of
 * its `groupId`. Returns `list` itself when nothing needs fixing.
 */
export function dropOrphanGroups(list: readonly DrawingElement[]): readonly DrawingElement[] {
  const counts = new Map<string, number>();
  for (const el of list) if (el.groupId) counts.set(el.groupId, (counts.get(el.groupId) ?? 0) + 1);
  if (![...counts.values()].some((n) => n < 2)) return list;
  return list.map((el) => (el.groupId && (counts.get(el.groupId) ?? 0) < 2 ? { ...el, groupId: undefined } : el));
}

/** True when `count` more objects fit on the page (docs/08 §17.2). */
export function canAddElements(page: DrawingPage, count = 1): boolean {
  return page.elements.length + count <= PAGE_OBJECT_CAP;
}

const withZ = (els: DrawingElement[]): DrawingElement[] => els.map((el, i) => (el.zIndex === i ? el : { ...el, zIndex: i }));

/** Appends on top. Returns the document unchanged when the page is full. */
export function addElement(doc: DrawingDocument, pageId: string, el: DrawingElement): DrawingDocument {
  return mapPage(doc, pageId, (p) => (canAddElements(p) ? { ...p, elements: [...p.elements, { ...el, zIndex: p.elements.length }] } : p));
}

export function addElements(doc: DrawingDocument, pageId: string, list: readonly DrawingElement[]): DrawingDocument {
  if (list.length === 0) return doc;
  return mapPage(doc, pageId, (p) => {
    if (!canAddElements(p, list.length)) return p;
    const base = p.elements.length;
    return { ...p, elements: [...p.elements, ...list.map((el, i) => ({ ...el, zIndex: base + i }))] };
  });
}

export function updateElements(
  doc: DrawingDocument, pageId: string, ids: ReadonlySet<string>, fn: (el: DrawingElement) => DrawingElement,
): DrawingDocument {
  if (ids.size === 0) return doc;
  return mapPage(doc, pageId, (p) => {
    let changed = false;
    const elements = p.elements.map((el) => {
      if (!ids.has(el.id)) return el;
      const next = fn(el);
      if (next !== el) changed = true;
      return next;
    });
    return changed ? { ...p, elements } : p;
  });
}

/** Swaps in new versions of elements by id (move/resize/rotate commits). */
export function replaceElements(doc: DrawingDocument, pageId: string, next: ReadonlyMap<string, DrawingElement>): DrawingDocument {
  if (next.size === 0) return doc;
  return mapPage(doc, pageId, (p) => {
    let changed = false;
    const elements = p.elements.map((el) => {
      const r = next.get(el.id);
      if (!r || r === el) return el;
      changed = true;
      return r;
    });
    return changed ? { ...p, elements } : p;
  });
}

/** Replaces every element on the page (used to commit an eraser pass). */
export function setPageElements(doc: DrawingDocument, pageId: string, elements: DrawingElement[]): DrawingDocument {
  return mapPage(doc, pageId, (p) => (p.elements === elements ? p : { ...p, elements: [...dropOrphanGroups(elements)] }));
}

export function removeElements(doc: DrawingDocument, pageId: string, ids: ReadonlySet<string>): DrawingDocument {
  if (ids.size === 0) return doc;
  return mapPage(doc, pageId, (p) => {
    const elements = p.elements.filter((el) => !ids.has(el.id));
    return elements.length === p.elements.length ? p : { ...p, elements: [...dropOrphanGroups(elements)] };
  });
}

/** Sets lock / hide / semantic hint on elements. `hint: null` clears it. */
export function setFlags(
  doc: DrawingDocument, pageId: string, ids: ReadonlySet<string>,
  patch: { locked?: boolean; hidden?: boolean; hint?: string | null },
): DrawingDocument {
  return updateElements(doc, pageId, ids, (el) => {
    const next: DrawingElement = { ...el };
    if (patch.locked !== undefined) next.locked = patch.locked || undefined;
    if (patch.hidden !== undefined) next.hidden = patch.hidden || undefined;
    if (patch.hint !== undefined) next.hint = patch.hint ?? undefined;
    const same = (['locked', 'hidden', 'hint'] as const).every((k: keyof DrawingElementCommon) => next[k] === el[k]);
    return same ? el : next;
  });
}

/**
 * Copies elements with new ids, moved by (offset, offset). Locked state is dropped unless `keepFlags`.
 * Copies of a group form a new group of their own, so editing the copy never moves the original.
 */
export function cloneElements(els: readonly DrawingElement[], offset: number, keepFlags = false): DrawingElement[] {
  const sizes = new Map<string, number>();
  for (const el of els) if (el.groupId) sizes.set(el.groupId, (sizes.get(el.groupId) ?? 0) + 1);
  const fresh = new Map<string, string>();
  return els.map((el) => {
    const moved = translateElement(el, offset, offset);
    const copy: DrawingElement = { ...moved, id: newId('el'), groupId: undefined };
    if (el.groupId && (sizes.get(el.groupId) ?? 0) > 1) {
      let g = fresh.get(el.groupId);
      if (!g) { g = newId('grp'); fresh.set(el.groupId, g); }
      copy.groupId = g;
    }
    if (!keepFlags) { copy.locked = undefined; copy.hidden = undefined; }
    return copy;
  });
}

/** Elements of `ids` in stacking order (for copy and duplicate). */
export function pickElements(page: DrawingPage, ids: ReadonlySet<string>): DrawingElement[] {
  return page.elements.filter((el) => ids.has(el.id));
}

/** Duplicates elements just above the originals' stack. Returns the new ids (empty when the page is full). */
export function duplicateElements(
  doc: DrawingDocument, pageId: string, ids: ReadonlySet<string>, offset = 16,
): { doc: DrawingDocument; ids: string[] } {
  const page = getPage(doc, pageId);
  if (!page) return { doc, ids: [] };
  const copies = cloneElements(pickElements(page, ids), offset);
  if (copies.length === 0 || !canAddElements(page, copies.length)) return { doc, ids: [] };
  return { doc: addElements(doc, pageId, copies), ids: copies.map((c) => c.id) };
}

/** Pastes copied elements (from any drawing) onto a page as new objects. */
export function pasteElements(
  doc: DrawingDocument, pageId: string, clips: readonly DrawingElement[], offset = 16,
): { doc: DrawingDocument; ids: string[] } {
  const page = getPage(doc, pageId);
  if (!page || clips.length === 0) return { doc, ids: [] };
  const copies = cloneElements(clips, offset);
  if (!canAddElements(page, copies.length)) return { doc, ids: [] };
  return { doc: addElements(doc, pageId, copies), ids: copies.map((c) => c.id) };
}

export type ReorderMode = 'front' | 'back' | 'forward' | 'backward';

/** Stable block reorder: selected items keep their relative order (docs/08 §10.2). Returns `list` itself when nothing moves. */
export function reorderList<T>(list: readonly T[], isSelected: (item: T) => boolean, mode: ReorderMode): readonly T[] {
  const sel = list.map(isSelected);
  if (!sel.some(Boolean)) return list;
  let out: T[];
  if (mode === 'front' || mode === 'back') {
    const chosen = list.filter((_, i) => sel[i]);
    const rest = list.filter((_, i) => !sel[i]);
    out = mode === 'front' ? [...rest, ...chosen] : [...chosen, ...rest];
  } else {
    out = [...list];
    const flags = [...sel];
    if (mode === 'forward') {
      for (let i = out.length - 2; i >= 0; i--) {
        if (flags[i] && !flags[i + 1]) { [out[i], out[i + 1]] = [out[i + 1]!, out[i]!]; [flags[i], flags[i + 1]] = [false, true]; }
      }
    } else {
      for (let i = 1; i < out.length; i++) {
        if (flags[i] && !flags[i - 1]) { [out[i], out[i - 1]] = [out[i - 1]!, out[i]!]; [flags[i], flags[i - 1]] = [false, true]; }
      }
    }
  }
  return out.every((item, i) => item === list[i]) ? list : out;
}

export function reorderElements(doc: DrawingDocument, pageId: string, ids: ReadonlySet<string>, mode: ReorderMode): DrawingDocument {
  if (ids.size === 0) return doc;
  return mapPage(doc, pageId, (p) => {
    const next = reorderList(p.elements, (el) => ids.has(el.id), mode);
    return next === p.elements ? p : { ...p, elements: withZ([...next]) };
  });
}

/** Blob ids of the visible photos on a page (exports wait for these before rendering). */
export function pageImageIds(page: DrawingPage): string[] {
  const ids: string[] = [];
  for (const el of page.elements) if (el.kind === 'image' && !el.hidden) ids.push(el.blobId);
  return ids;
}

/** True when the page has anything a person can see. */
export function pageHasVisibleContent(page: DrawingPage): boolean {
  return page.elements.some((el) => !el.hidden);
}
