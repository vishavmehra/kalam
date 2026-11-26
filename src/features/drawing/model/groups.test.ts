import { describe, expect, it } from 'vitest';
import type { DrawingDocument, DrawingElement } from '@/core/contracts';
import {
  addElement, canGroup, canUngroup, cloneElements, createDocument, duplicateElements, expandToGroups, getPage, groupElements,
  describeLayout, groupMembers, migrateDrawing, removeElements, setPageElements, singleGroupSize, ungroupElements,
} from './index';

const box = (id: string, x: number, extra: Partial<DrawingElement> = {}): DrawingElement =>
  ({ id, kind: 'rect', x, y: 10, w: 40, h: 30, color: '#000000', size: 2, ...extra }) as DrawingElement;

function docWith(...els: DrawingElement[]): { doc: DrawingDocument; pageId: string } {
  let doc = createDocument(1, 'drw_g');
  const pageId = doc.pages[0]!.id;
  for (const el of els) doc = addElement(doc, pageId, el);
  return { doc, pageId };
}
const els = (doc: DrawingDocument, pageId: string) => getPage(doc, pageId)!.elements;

describe('grouping', () => {
  it('puts two or more unlocked objects in one group and keeps their own ids', () => {
    const { doc, pageId } = docWith(box('a', 0), box('b', 60), box('c', 120));
    const res = groupElements(doc, pageId, new Set(['a', 'b']));
    expect(res.groupId).toBeTruthy();
    const page = getPage(res.doc, pageId)!;
    expect(groupMembers(page, res.groupId!)).toEqual(['a', 'b']);
    expect(page.elements.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(page.elements[2]!.groupId).toBeUndefined();
  });

  it('does nothing for one object, for locked objects, or when they are already one group', () => {
    const { doc, pageId } = docWith(box('a', 0), box('b', 60, { locked: true }), box('c', 120));
    expect(groupElements(doc, pageId, new Set(['a'])).doc).toBe(doc);
    expect(groupElements(doc, pageId, new Set(['a', 'b'])).doc).toBe(doc);
    const g = groupElements(doc, pageId, new Set(['a', 'c']));
    expect(groupElements(g.doc, pageId, new Set(['a', 'c'])).doc).toBe(g.doc);
  });

  it('groups of groups join into one group', () => {
    const { doc, pageId } = docWith(box('a', 0), box('b', 60), box('c', 120), box('d', 180));
    const g1 = groupElements(doc, pageId, new Set(['a', 'b']));
    const g2 = groupElements(g1.doc, pageId, new Set(['c', 'd']));
    const joined = groupElements(g2.doc, pageId, new Set(['a', 'b', 'c', 'd']));
    const page = getPage(joined.doc, pageId)!;
    expect(new Set(page.elements.map((e) => e.groupId)).size).toBe(1);
    expect(groupMembers(page, joined.groupId!)).toHaveLength(4);
  });

  it('can be asked whether a selection can be grouped or ungrouped', () => {
    const { doc, pageId } = docWith(box('a', 0), box('b', 60));
    const g = groupElements(doc, pageId, new Set(['a', 'b'])).doc;
    const page = getPage(g, pageId)!;
    expect(canGroup(page.elements)).toBe(false);
    expect(canUngroup(page.elements)).toBe(true);
    expect(canGroup(getPage(doc, pageId)!.elements)).toBe(true);
    expect(canUngroup(getPage(doc, pageId)!.elements)).toBe(false);
    expect(singleGroupSize(page, page.elements)).toBe(2);
    expect(singleGroupSize(page, [page.elements[0]!])).toBe(2);
    expect(singleGroupSize(getPage(doc, pageId)!, getPage(doc, pageId)!.elements)).toBeUndefined();
  });
});

describe('selecting a group', () => {
  it('expands one member to every member, keeping the ids that came first', () => {
    const { doc, pageId } = docWith(box('a', 0), box('x', 300), box('b', 60), box('c', 120));
    const g = groupElements(doc, pageId, new Set(['a', 'b', 'c'])).doc;
    const page = getPage(g, pageId)!;
    expect(expandToGroups(page, ['b'])).toEqual(['b', 'a', 'c']);
    expect(expandToGroups(page, ['x'])).toEqual(['x']);
    expect(expandToGroups(page, ['ghost'])).toEqual(['ghost']);
    expect(expandToGroups(page, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('ungrouping', () => {
  it('lets every member go, even ones that were not picked', () => {
    const { doc, pageId } = docWith(box('a', 0), box('b', 60), box('c', 120));
    const g = groupElements(doc, pageId, new Set(['a', 'b', 'c'])).doc;
    const free = ungroupElements(g, pageId, new Set(['a']));
    expect(els(free, pageId).every((e) => !e.groupId)).toBe(true);
    expect(ungroupElements(doc, pageId, new Set(['a']))).toBe(doc);
  });

  it('leaves a locked group alone', () => {
    const { doc, pageId } = docWith(box('a', 0, { locked: true }), box('b', 60, { locked: true }));
    const grouped = { ...doc, pages: [{ ...doc.pages[0]!, elements: doc.pages[0]!.elements.map((e) => ({ ...e, groupId: 'g' })) }] };
    expect(ungroupElements(grouped, pageId, new Set(['a', 'b']))).toBe(grouped);
  });
});

describe('copies of a group', () => {
  it('form a group of their own, so editing the copy never moves the original', () => {
    const { doc, pageId } = docWith(box('a', 0), box('b', 60), box('c', 120));
    const g = groupElements(doc, pageId, new Set(['a', 'b'])).doc;
    const res = duplicateElements(g, pageId, new Set(['a', 'b']));
    const page = getPage(res.doc, pageId)!;
    const copies = page.elements.filter((e) => res.ids.includes(e.id));
    expect(copies).toHaveLength(2);
    expect(copies[0]!.groupId).toBeTruthy();
    expect(copies[0]!.groupId).toBe(copies[1]!.groupId);
    expect(copies[0]!.groupId).not.toBe(page.elements[0]!.groupId);
  });

  it('drops the group when only one member is copied', () => {
    const { doc, pageId } = docWith(box('a', 0), box('b', 60));
    const g = groupElements(doc, pageId, new Set(['a', 'b'])).doc;
    const [copy] = cloneElements([els(g, pageId)[0]!], 10);
    expect(copy!.groupId).toBeUndefined();
  });
});

describe('deleting and erasing around a group', () => {
  it('a group of one is not a group: the last member lets go', () => {
    const { doc, pageId } = docWith(box('a', 0), box('b', 60), box('c', 120));
    const g = groupElements(doc, pageId, new Set(['a', 'b', 'c'])).doc;
    const less = removeElements(g, pageId, new Set(['a', 'b']));
    expect(els(less, pageId)[0]!.groupId).toBeUndefined();
    const some = removeElements(g, pageId, new Set(['a']));
    expect(new Set(els(some, pageId).map((e) => e.groupId)).size).toBe(1);
    const reset = setPageElements(g, pageId, [els(g, pageId)[0]!]);
    expect(els(reset, pageId)[0]!.groupId).toBeUndefined();
  });
});

describe('saving a group', () => {
  it('keeps group ids through a save and load', () => {
    const { doc, pageId } = docWith(box('a', 0), box('b', 60));
    const g = groupElements(doc, pageId, new Set(['a', 'b'])).doc;
    const stored = JSON.parse(JSON.stringify(g)) as unknown;
    const back = migrateDrawing(stored)!.doc;
    const page = back.pages[0]!;
    expect(page.elements[0]!.groupId).toBeTruthy();
    expect(page.elements[0]!.groupId).toBe(page.elements[1]!.groupId);
  });
});

describe('what the compiler hears about a group', () => {
  it('says the person grouped these objects, using their own labels', () => {
    const { doc, pageId } = docWith(
      { id: 'n', kind: 'text', x: 20, y: 300, text: 'Name', color: '#000000', fontSize: 16 },
      { id: 'f', kind: 'rect', x: 20, y: 330, w: 200, h: 40, color: '#000000', size: 2 },
      box('other', 300),
    );
    const g = groupElements(doc, pageId, new Set(['n', 'f'])).doc;
    const notes = describeLayout(g);
    expect(notes.some((n) => /grouped 2 objects together \("Name", "box"\)/.test(n))).toBe(true);
    expect(describeLayout(doc).some((n) => /grouped/.test(n))).toBe(false);
  });
});
