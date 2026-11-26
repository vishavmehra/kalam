/**
 * Choosing a record by voice (docs/10 §4.5 "Delete the last record", docs/00 §17 "voice navigation").
 * Without this, a person using only their voice could never open or delete an item, because the
 * detail screen and the delete action both need a record to be selected first.
 *
 *   "open the last order" / "edit Raju" / "delete the first record" / "delete Raju"
 *
 * Position words (last, latest, newest, first, oldest) pick by creation time among the rows the
 * list shows. A name matches the list's main field. Several matches are never guessed: the person is
 * asked to say more. Deleting always goes through the confirmation step. Pure TypeScript.
 */
import type { AccessModes, KalamRecord } from '@/core/contracts';
import type { ComponentOf, KalamSpec } from '@/core/spec/schema';
import { collectionValues, formatFieldValue, formulaContext, queryList } from './data';
import { collectionFieldDefs } from './fields';
import { currentScreen, selectedId } from './state';
import { visibleChildren } from './theme';
import type { DataSnapshot, RuntimeState } from './types';
import { speechWords } from './voice-intents';
import { v11FieldText } from './v11';

export type RecordVerb = 'open' | 'delete';
export type RecordRef = { kind: 'last' | 'first' } | { kind: 'text'; text: string };
export interface RecordCommand { verb: RecordVerb; ref: RecordRef }

const OPEN_VERBS = new Set(['open', 'edit', 'select', 'show', 'kholo', 'dikhao', 'kholiye', 'खोलो', 'दिखाओ']);
const DELETE_VERBS = new Set(['delete', 'remove', 'hatao', 'mitao', 'हटाओ', 'मिटाओ']);
const LAST = new Set(['last', 'latest', 'newest', 'recent', 'akhri', 'आखिरी']);
const FIRST = new Set(['first', 'oldest', 'pehla', 'पहला']);
const FILLER = new Set([
  'the', 'a', 'an', 'my', 'of', 'please', 'pls', 'one', 'record', 'records', 'entry', 'entries', 'item', 'items',
  'ka', 'ki', 'ke', 'ko', 'wala', 'wali',
]);

/** "delete the last record" → { delete, last }. Undefined when the words are not a record command. */
export function parseRecordCommand(transcript: string): RecordCommand | undefined {
  const w = speechWords(transcript);
  const verb: RecordVerb | undefined = OPEN_VERBS.has(w[0] ?? '') ? 'open' : DELETE_VERBS.has(w[0] ?? '') ? 'delete' : undefined;
  if (!verb) return undefined;
  const rest = w.slice(1).filter((x) => !FILLER.has(x));
  if (!rest.length) return undefined;
  const position = rest.find((x) => LAST.has(x) || FIRST.has(x));
  if (position) return { verb, ref: { kind: LAST.has(position) ? 'last' : 'first' } };
  return { verb, ref: { kind: 'text', text: rest.map((x) => x.replace(/['’]s$/, '')).join(' ') } };
}

export interface RecordTarget {
  list: ComponentOf<'list'>;
  record: KalamRecord;
  /** What the record is called on screen, e.g. "Raju". */
  name: string;
}
export type RecordPlan =
  | ({ kind: 'open' } & RecordTarget)
  | ({ kind: 'delete'; prompt: string; message: string } & RecordTarget)
  | { kind: 'say'; say: string };

export type RecordOpenPlan = Extract<RecordPlan, { kind: 'open' }>;
export type RecordDeletePlan = Extract<RecordPlan, { kind: 'delete' }>;

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
const singular = (s: string) => (s.length > 3 && s.endsWith('s') ? s.slice(0, -1) : s);

/**
 * Works out which record the person meant, on the current screen only.
 * Returns undefined when this is not a record command for this screen, so the normal command flow carries on.
 */
export function planRecordCommand(
  spec: KalamSpec, state: RuntimeState, data: DataSnapshot, now: Date, modes: AccessModes, cmd: RecordCommand,
): RecordPlan | undefined {
  const screen = currentScreen(spec, state);
  const lists = visibleChildren(screen, modes).filter((c): c is ComponentOf<'list'> => c.type === 'list');
  const positional = cmd.ref.kind !== 'text';
  if (!lists.length) {
    return positional ? { kind: 'say', say: 'Go to the list first, then say which one.' } : undefined;
  }
  const usable = lists.filter((l) => (cmd.verb === 'open' ? !!l.detailScreen : l.allowDelete === true));
  if (!usable.length) {
    return {
      kind: 'say',
      say: cmd.verb === 'open' ? 'Items in this list cannot be opened.' : 'Open that item first, then say delete.',
    };
  }

  const ctx = formulaContext(collectionValues(spec, data.records), {}, data.state, now, selectedId(spec, state));
  const candidates: RecordTarget[] = [];
  let anyRows = false;
  for (const list of usable) {
    const defs = collectionFieldDefs(spec, list.source);
    const rows = queryList(list, data.records[list.source] ?? [], ctx).rows;
    if (rows.length) anyRows = true;
    // A link is said by the linked entry's name ("open Ramesh"), never its id.
    const say = (r: KalamRecord, f: string) =>
      v11FieldText(spec, list.source, f, r.values[f], data.records) ?? formatFieldValue(defs?.[f], r.values[f], spec.lang);
    const nameOf = (r: KalamRecord) => say(r, list.primary) || 'this item';
    if (cmd.ref.kind === 'text') {
      const collectionWords = new Set(norm(`${spec.collections[list.source]?.label ?? ''} ${list.source}`).split(' ').map(singular));
      const query = norm(cmd.ref.text).split(' ').filter((t) => t && !collectionWords.has(singular(t)));
      if (!query.length) continue;
      for (const r of rows) {
        const hay = norm(`${nameOf(r)} ${list.secondary ? say(r, list.secondary) : ''}`);
        if (query.every((t) => hay.includes(t))) candidates.push({ list, record: r, name: nameOf(r) });
      }
    } else if (rows.length && candidates.length === 0) {
      // Position words use the first list that has rows: newest (last) or oldest (first) by creation time.
      const pick = [...rows].sort((a, b) => (cmd.ref.kind === 'last' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt))[0]!;
      candidates.push({ list, record: pick, name: nameOf(pick) });
    }
  }

  if (!candidates.length) {
    if (cmd.ref.kind === 'text') return undefined; // maybe one of the app's own commands ("open new order")
    return { kind: 'say', say: anyRows ? 'I could not find that.' : 'There is nothing in the list yet.' };
  }
  if (candidates.length > 1) {
    return { kind: 'say', say: `I found ${candidates.length} matches. Say more of the name.` };
  }
  const target = candidates[0]!;
  if (cmd.verb === 'open') return { kind: 'open', ...target };
  return {
    kind: 'delete', ...target,
    prompt: `Delete ${target.name}? Say confirm or cancel.`,
    // Same wording as the delete button in the list, so the engine's own confirmation reads the same.
    message: `Delete "${target.name}"? This can't be undone.`,
  };
}
