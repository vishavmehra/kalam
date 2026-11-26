/**
 * Pure logic behind the sharing screens: what a person's choices turn into, and what blocks them.
 * No React in here, so it runs under Vitest. The rules themselves live in `src/core/share`.
 */
import {
  collectionLabel, collectionOf, compatibleTargets, describeLink, fieldLabel, fieldOf, isFromBazaar, suggestMappings, unmappedRequired,
  SHARE_COPY, type CreateLinkInput, type ShareAccess, type ShareAuditEntry,
} from '@/core/share';
import type { KalamCollection, KalamSpec } from '@/core/spec/schema';
import { SHARE_UI } from './copy';

/** The four things a person can want, from the point of view of the app they are in. */
export type ShareIntent = 'view_from' | 'let_view' | 'send_to' | 'receive_from';
export const SHARE_INTENTS: readonly ShareIntent[] = ['view_from', 'let_view', 'send_to', 'receive_from'];

/** Which side the current app is on, and the kind of link each intent makes. */
export const INTENT_ROLE: Record<ShareIntent, { thisApp: 'source' | 'destination'; access: ShareAccess }> = {
  view_from: { thisApp: 'destination', access: 'read' },
  let_view: { thisApp: 'source', access: 'read' },
  send_to: { thisApp: 'source', access: 'write' },
  receive_from: { thisApp: 'destination', access: 'write' },
};

export interface Draft {
  intent: ShareIntent;
  otherAppId?: string;
  sourceCollection?: string;
  destinationCollection?: string;
  /** Source field id to destination field id. A source field missing from here, or set to '', is not shared. */
  mapping: Record<string, string>;
  acknowledgeBazaar: boolean;
}

export const emptyDraft = (intent: ShareIntent = 'view_from'): Draft => ({ intent, mapping: {}, acknowledgeBazaar: false });

export interface Sides {
  source?: KalamSpec;
  destination?: KalamSpec;
}

/** The two designs in link order. `thisSpec` is the app the person is in. */
export function sidesOf(draft: Draft, thisSpec: KalamSpec, otherSpec: KalamSpec | undefined): Sides {
  return INTENT_ROLE[draft.intent].thisApp === 'source'
    ? { source: thisSpec, destination: otherSpec }
    : { source: otherSpec, destination: thisSpec };
}

export function collectionsOf(draft: Draft, sides: Sides): { from?: KalamCollection; to?: KalamCollection } {
  return {
    from: sides.source && draft.sourceCollection ? collectionOf(sides.source, draft.sourceCollection) : undefined,
    to: sides.destination && draft.destinationCollection ? collectionOf(sides.destination, draft.destinationCollection) : undefined,
  };
}

/** The suggested pairs for two lists, as a mapping the person can change. */
export function suggestedMapping(from: KalamCollection, to: KalamCollection): Record<string, string> {
  return Object.fromEntries(suggestMappings(from, to).map((s) => [s.source, s.target]));
}

/** Destination fields a source field may go to, leaving out fields another source field already fills. */
export function targetChoices(from: KalamCollection, to: KalamCollection, sourceField: string, mapping: Draft['mapping']): string[] {
  const source = fieldOf(from, sourceField);
  if (!source) return [];
  const taken = new Set(Object.entries(mapping).filter(([s, t]) => s !== sourceField && t).map(([, t]) => t));
  return compatibleTargets(to, source.type).filter((t) => !taken.has(t));
}

/** Chosen pairs in the source list's own field order. */
export function chosenFields(draft: Draft, from: KalamCollection | undefined): Array<{ source: string; target: string }> {
  if (!from) return [];
  return Object.keys(from.fields).flatMap((source) => (draft.mapping[source] ? [{ source, target: draft.mapping[source] }] : []));
}

export interface DraftCheck {
  /** Nothing is allowed until this is empty. */
  blockers: string[];
  /** The destination came from the Bazaar, so the person has to say they trust it. */
  needsBazaarAck: boolean;
  /** What the link would allow, in sentences. Empty until both lists are chosen. */
  lines: string[];
}

/**
 * `parentOf` finds an app on this device by id, so a copy of a Bazaar app is still known as one (the service
 * follows the same trail, so the form asks for the person's trust exactly when the service will).
 */
export function checkDraft(
  draft: Draft, thisSpec: KalamSpec, otherSpec: KalamSpec | undefined, parentOf?: (appId: string) => KalamSpec | undefined,
): DraftCheck {
  const blockers: string[] = [];
  const sides = sidesOf(draft, thisSpec, otherSpec);
  const { from, to } = collectionsOf(draft, sides);
  const fields = chosenFields(draft, from);
  const needsBazaarAck = isFromBazaar(sides.destination, parentOf);
  if (!otherSpec) blockers.push(SHARE_UI.form.blockers.pickApp);
  else if (!from || !to) blockers.push(SHARE_UI.form.blockers.pickLists);
  else if (!fields.length) blockers.push(SHARE_UI.form.blockers.pickFields);
  else if (INTENT_ROLE[draft.intent].access === 'write' && sides.destination) {
    const [first] = unmappedRequired(to, fields.map((f) => f.target));
    if (first) blockers.push(SHARE_COPY.create.required_unmapped(sides.destination.name, first));
  }
  if (needsBazaarAck && !draft.acknowledgeBazaar && sides.destination) blockers.push(SHARE_UI.form.blockers.bazaar(sides.destination.name));

  const lines =
    sides.source && sides.destination && from && to && fields.length
      ? describeLink({
          access: INTENT_ROLE[draft.intent].access,
          source: sides.source.name,
          destination: sides.destination.name,
          sourceList: collectionLabel(sides.source, draft.sourceCollection!),
          destinationList: collectionLabel(sides.destination, draft.destinationCollection!),
          fields: fields.map((f) => fieldLabel(from, f.source)),
        })
      : [];
  return { blockers, needsBazaarAck, lines };
}

/** What to hand to the service once the person confirms. Never call this before they have. */
export function toCreateInput(draft: Draft, thisAppId: string, sides: Sides, from: KalamCollection | undefined): CreateLinkInput | undefined {
  if (!draft.otherAppId || !draft.sourceCollection || !draft.destinationCollection || !sides.source || !sides.destination) return undefined;
  const thisIsSource = INTENT_ROLE[draft.intent].thisApp === 'source';
  return {
    sourceAppId: thisIsSource ? thisAppId : draft.otherAppId,
    sourceCollection: draft.sourceCollection,
    destinationAppId: thisIsSource ? draft.otherAppId : thisAppId,
    destinationCollection: draft.destinationCollection,
    access: INTENT_ROLE[draft.intent].access,
    fields: chosenFields(draft, from),
    confirmed: true,
    acknowledgeBazaar: draft.acknowledgeBazaar,
  };
}

/** One line of a link's history, ready to show. */
export function historyLine(entry: ShareAuditEntry, formatDate: (ms: number) => string): string {
  const when = formatDate(entry.at);
  const what =
    entry.kind === 'created' ? SHARE_UI.history.created
    : entry.kind === 'revoked' ? SHARE_UI.history.revoked
    : entry.kind === 'blocked' ? SHARE_UI.history.blocked
    : `${SHARE_UI.history.sent(entry.count ?? 0, entry.updated ?? 0)}${entry.reason === 'some_rejected' ? `, ${SHARE_UI.history.someRejected}` : ''}`;
  return `${when}: ${what}`;
}

// ─── Building a link step by step ─────────────────────────────────────────────

/** The app on the other side, as the form needs it. */
export interface OtherApp {
  id: string;
  spec: KalamSpec;
}

const only = (spec: KalamSpec | undefined): string | undefined => {
  const ids = spec ? Object.keys(spec.collections) : [];
  return ids.length === 1 ? ids[0] : undefined;
};

/** A new intent starts the form again: nothing chosen for one kind of link carries over to another. */
export const withIntent = (intent: ShareIntent): Draft => emptyDraft(intent);

/** Fills the mapping from the suggestions once both lists are chosen. */
function withSuggestions(draft: Draft, sides: Sides): Draft {
  const { from, to } = collectionsOf(draft, sides);
  return from && to ? { ...draft, mapping: suggestedMapping(from, to), acknowledgeBazaar: false } : { ...draft, mapping: {}, acknowledgeBazaar: false };
}

/** Picks the other app. A list that is the only one in its app is chosen for the person. */
export function withOtherApp(draft: Draft, thisSpec: KalamSpec, other: OtherApp): Draft {
  const next: Draft = { ...draft, otherAppId: other.id, mapping: {}, acknowledgeBazaar: false };
  const sides = sidesOf(next, thisSpec, other.spec);
  const thisIsSource = INTENT_ROLE[draft.intent].thisApp === 'source';
  const mine = only(thisSpec);
  const theirs = only(other.spec);
  next.sourceCollection = thisIsSource ? mine : theirs;
  next.destinationCollection = thisIsSource ? theirs : mine;
  return withSuggestions(next, sides);
}

/** Picks a list on one side. The field pairs are suggested again, because they belong to the two lists. */
export function withCollection(draft: Draft, side: 'source' | 'destination', id: string, sides: Sides): Draft {
  const next: Draft = side === 'source' ? { ...draft, sourceCollection: id } : { ...draft, destinationCollection: id };
  return withSuggestions(next, sides);
}

/** Sends one source field to a destination field, or stops sharing it when `target` is ''. */
export function withTarget(draft: Draft, sourceField: string, target: string): Draft {
  const mapping = { ...draft.mapping };
  if (target) mapping[sourceField] = target;
  else delete mapping[sourceField];
  return { ...draft, mapping };
}

// ─── Choosing entries to send ─────────────────────────────────────────────────

/** Adds or removes one entry. At the limit, adding changes nothing, so a send never goes over what the service allows. */
export function toggleEntry(selected: ReadonlySet<string>, id: string, limit: number): Set<string> {
  const next = new Set(selected);
  if (next.delete(id)) return next;
  if (next.size < limit) next.add(id);
  return next;
}

/** The first `limit` ids of the list, for "Choose all". */
export const chooseAllEntries = (ids: readonly string[], limit: number): Set<string> => new Set(ids.slice(0, limit));

/** What a send of the chosen entries will do, so the question the person answers is the truth. */
export interface SendPlan {
  /** Entries that will be made new in the other app. */
  create: number;
  /** Entries sent before that will be changed. Zero unless the person asked for updates. */
  change: number;
  /** Entries sent before that stay as they are, because the person did not ask for updates. */
  leftOut: number;
}

export function sendPlan(items: ReadonlyArray<{ id: string; alreadySent: boolean }>, selected: ReadonlySet<string>, update: boolean): SendPlan {
  const chosen = items.filter((i) => selected.has(i.id));
  const before = chosen.filter((i) => i.alreadySent).length;
  return { create: chosen.length - before, change: update ? before : 0, leftOut: update ? 0 : before };
}

/** Local date and time for a history line. Falls back to a plain ISO date when Intl is not there. */
export function formatWhen(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }
}
