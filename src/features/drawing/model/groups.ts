/**
 * Groups (docs/08 §10.3). A group is a shared `groupId`: the members stay separate objects with their own
 * ids, styles and stacking, and are never flattened into a picture. Selecting one member selects them all,
 * so move, resize, turn, lock, hide, copy and delete work on the group as one. Groups do not nest:
 * grouping groups joins them into one.
 */
import type { DrawingDocument, DrawingElement, DrawingPage } from '@/core/contracts';
import { getPage, newId, updateElements } from './document';

/** Ids of the group `groupId` on this page, in stacking order. */
export function groupMembers(page: DrawingPage, groupId: string): string[] {
  return page.elements.filter((el) => el.groupId === groupId).map((el) => el.id);
}

/**
 * `ids` plus every member of any group they touch. Order is kept: the ids that came in first, then the
 * members that were added, in stacking order. Unknown ids pass through unchanged.
 */
export function expandToGroups(page: DrawingPage, ids: Iterable<string>): string[] {
  const out = [...new Set(ids)];
  const have = new Set(out);
  const wanted = new Set<string>();
  const byId = new Map(page.elements.map((el) => [el.id, el] as const));
  for (const id of out) {
    const g = byId.get(id)?.groupId;
    if (g) wanted.add(g);
  }
  if (wanted.size === 0) return out;
  for (const el of page.elements) {
    if (el.groupId && wanted.has(el.groupId) && !have.has(el.id)) { out.push(el.id); have.add(el.id); }
  }
  return out;
}

/** True when `els` can be grouped: two or more unlocked objects that are not already one group. */
export function canGroup(els: readonly DrawingElement[]): boolean {
  const open = els.filter((e) => !e.locked);
  if (open.length < 2) return false;
  const first = open[0]!.groupId;
  return !(first && open.every((e) => e.groupId === first));
}

export function canUngroup(els: readonly DrawingElement[]): boolean {
  return els.some((e) => !e.locked && !!e.groupId);
}

/** Number of members when every element in `els` belongs to one group, else undefined. */
export function singleGroupSize(page: DrawingPage, els: readonly DrawingElement[]): number | undefined {
  const g = els[0]?.groupId;
  if (!g || !els.every((e) => e.groupId === g)) return undefined;
  return groupMembers(page, g).length;
}

/** Puts the unlocked objects in `ids` into one new group. Returns the document unchanged when fewer than two qualify. */
export function groupElements(doc: DrawingDocument, pageId: string, ids: ReadonlySet<string>): { doc: DrawingDocument; groupId?: string } {
  const page = getPage(doc, pageId);
  if (!page) return { doc };
  const chosen = page.elements.filter((el) => ids.has(el.id) && !el.locked);
  if (!canGroup(chosen)) return { doc };
  const groupId = newId('grp');
  const set = new Set(chosen.map((el) => el.id));
  return { doc: updateElements(doc, pageId, set, (el) => ({ ...el, groupId })), groupId };
}

/** Takes the unlocked objects in `ids` out of their groups. Members left alone lose their group too. */
export function ungroupElements(doc: DrawingDocument, pageId: string, ids: ReadonlySet<string>): DrawingDocument {
  const page = getPage(doc, pageId);
  if (!page) return doc;
  const chosen = page.elements.filter((el) => ids.has(el.id) && !el.locked && el.groupId);
  if (chosen.length === 0) return doc;
  const groups = new Set(chosen.map((el) => el.groupId!));
  // Ungrouping a group lets go of all its members, even ones that were not picked.
  const all = new Set(page.elements.filter((el) => el.groupId && groups.has(el.groupId) && !el.locked).map((el) => el.id));
  return updateElements(doc, pageId, all, (el) => ({ ...el, groupId: undefined }));
}
