/**
 * The review of one document record (docs/14 §9.3-9.4, docs/16 R-016). For each field it keeps the value,
 * the reader's confidence, where on the page it was seen, the validation result and what the person
 * did to it. Nothing here saves anything. A low-confidence value is never treated as confirmed: the
 * person has to confirm or correct it first (`isReady`).
 */
import type { AIExecutionResult, RecordValue } from '../contracts';
import type { KalamField } from '../spec/schema';
import { coerceFieldValue, dateDirection, toIsoDate } from '../tasks/coerce';
import type { Confidence, PageArea } from './meta';

/** invalid: the text does not fit the field. ambiguous_date: a date with no year or a weekday, to be picked. missing: required and empty. */
export type FieldIssue = 'invalid' | 'ambiguous_date' | 'missing';

export interface ReviewField {
  id: string;
  label: string;
  type: KalamField['type'];
  required: boolean;
  /** The value that would be saved. Undefined when empty or unusable. */
  value?: RecordValue;
  /** What the person is typing, kept verbatim so a half-typed number or date is not rewritten under them. */
  input?: string;
  /** Text as read or as typed when it does not fit the field. */
  read?: string;
  /** For an ambiguous date: the calendar day it would be today. A suggestion, never applied by itself. */
  suggestion?: string;
  confidence?: Confidence;
  area?: PageArea;
  issue?: FieldIssue;
  /** The reader was unsure of this value (low confidence, or listed as unsure). */
  unsure: boolean;
  /** The person confirmed or typed this field. */
  checked: boolean;
}

type Defs = Readonly<Record<string, KalamField>>;
type ReadResult = Pick<AIExecutionResult<Record<string, RecordValue>>, 'output' | 'uncertainFields' | 'fieldReadings' | 'unreadFields'>;

/** What is wrong with a field right now, if anything. `now` only resolves relative dates into a suggestion. */
function settle(f: ReviewField, def: KalamField, now: Date): ReviewField {
  const rest = { ...f };
  delete rest.issue;
  delete rest.suggestion;
  if (f.value !== undefined) return rest;
  if (f.read) {
    const suggestion = def.type === 'date' ? toIsoDate(f.read, now, { direction: dateDirection(def.label, f.id) }) : undefined;
    return suggestion ? { ...rest, issue: 'ambiguous_date', suggestion } : { ...rest, issue: 'invalid' };
  }
  return f.required ? { ...rest, issue: 'missing' } : rest;
}

/** One row per field the step reads, in the step's order, filled from what the model returned. */
export function buildReviewFields(ids: readonly string[], defs: Defs, result: ReadResult, now: Date): ReviewField[] {
  const unsure = new Set(result.uncertainFields ?? []);
  return ids.map((id) => {
    const def = defs[id];
    const note = result.fieldReadings?.[id];
    const value = result.output && Object.prototype.hasOwnProperty.call(result.output, id) ? result.output[id] : undefined;
    const read = result.unreadFields?.[id];
    return settle(
      {
        id, label: def.label, type: def.type, required: def.required === true,
        ...(value !== undefined && value !== null ? { value } : {}),
        ...(read ? { read } : {}),
        ...(note?.confidence ? { confidence: note.confidence } : {}),
        ...(note?.area ? { area: note.area as PageArea } : {}),
        unsure: unsure.has(id) || note?.confidence === 'low',
        checked: false,
      },
      def, now,
    );
  });
}

/** The person typed in a field. Whatever they typed is theirs, so the field counts as checked. Empty text clears it. */
export function editField(fields: ReviewField[], id: string, text: string, defs: Defs, now: Date): ReviewField[] {
  const def = defs[id];
  const t = text.trim();
  return fields.map((f) => {
    if (f.id !== id || !def) return f;
    const value = t ? coerceFieldValue(def, t, now, { id }) : undefined;
    const next: ReviewField = { ...f, input: text, checked: true };
    delete next.value;
    delete next.read;
    if (value !== undefined) next.value = value;
    else if (t) next.read = t.slice(0, 200);
    return settle(next, def, now);
  });
}

/** Takes the suggested date for an ambiguous one. */
export function takeSuggestion(fields: ReviewField[], id: string, defs: Defs, now: Date): ReviewField[] {
  const f = fields.find((x) => x.id === id);
  return f?.suggestion ? editField(fields, id, f.suggestion, defs, now) : fields;
}

/** The person says an unsure value is right. Fields with a problem cannot be confirmed; they have to be fixed. */
export function confirmField(fields: ReviewField[], id: string): ReviewField[] {
  return fields.map((f) => (f.id === id && !f.issue ? { ...f, checked: true } : f));
}

/** True while the field still needs the person: a problem, or an unsure value nobody has checked. */
export const needsAttention = (f: ReviewField): boolean => !!f.issue || (f.unsure && !f.checked && f.value !== undefined);

/** Ready to save: something was read, nothing has a problem, and every unsure value was checked. */
export const isReady = (fields: readonly ReviewField[]): boolean =>
  fields.some((f) => f.value !== undefined) && !fields.some(needsAttention);

/** The record to save. Only fields with a value. */
export function recordValues(fields: readonly ReviewField[]): Record<string, RecordValue> {
  const out: Record<string, RecordValue> = {};
  for (const f of fields) if (f.value !== undefined) out[f.id] = f.value;
  return out;
}

export type AreaMark = { fields: string[]; attention: boolean };

/** Which parts of the page hold fields, and which of those need a look: the data behind the highlight on the page picture. */
export function areaMarks(fields: readonly ReviewField[]): Partial<Record<PageArea, AreaMark>> {
  const out: Partial<Record<PageArea, AreaMark>> = {};
  for (const f of fields) {
    if (!f.area || (f.value === undefined && !f.read)) continue;
    const m = (out[f.area] ??= { fields: [], attention: false });
    m.fields.push(f.id);
    if (needsAttention(f)) m.attention = true;
  }
  return out;
}

/** Text for the field's input: what the person typed, else the value, else the text that did not fit. */
export const fieldText = (f: ReviewField): string => f.input ?? (f.value !== undefined ? String(f.value) : f.read ?? '');
