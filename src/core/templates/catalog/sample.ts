/**
 * Turns a template's made-up rows into entries a preview can show (docs/14 §12.5 "preview it with synthetic sample
 * data"). Dates are written relative to today so a preview is never stale, links are written by name so the rows do
 * not depend on generated ids, and the same day always gives exactly the same entries.
 */
import type { KalamRecord, RecordValue } from '../../contracts';
import { localDate } from '../../formula';
import { addDays, startOf } from '../../reports/dates';
import { RESERVED_IDS, type KalamField, type KalamSpec } from '../../spec/schema';
import { relationOf } from '../../spec/v11';
import type { CatalogEntry, SampleData } from './types';

export interface ResolvedSample {
  /** collection id → entries, oldest first. Ids are stable (`sample_<collection>_<n>`). */
  records: Record<string, KalamRecord[]>;
  state: Record<string, RecordValue>;
  form: Record<string, RecordValue>;
}

const REL_DAYS = /^~([+-]?\d{1,4})$/;
const MONTH_DAY = /^\^(\d{1,2})$/;
const LINK = /^>([a-z0-9_]{1,40})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** `sample_customers_ramesh` for a row with a key, `sample_customers_2` otherwise. */
const rowId = (collection: string, key: string | undefined, index: number): string => `sample_${collection}_${key ?? index + 1}`;

/** The date a token stands for, or undefined when `token` is not a date token. */
function dateFor(token: string, today: string): string | undefined {
  const rel = REL_DAYS.exec(token);
  if (rel) return addDays(today, Number(rel[1]));
  const month = MONTH_DAY.exec(token);
  if (month) {
    const day = addDays(startOf(today, 'month'), Number(month[1]));
    return day > today ? today : day; // never later than today, so "this month" always has its entries
  }
  return undefined;
}

function resolveValue(
  spec: KalamSpec, collection: string, field: string, value: RecordValue, today: string, keys: Map<string, Set<string>>,
): RecordValue {
  if (typeof value !== 'string') return value;
  const date = dateFor(value, today);
  if (date) return date;
  const link = LINK.exec(value);
  if (link) {
    const target = relationOf(spec, collection, field)?.collection;
    return target && keys.get(target)?.has(link[1]!) ? rowId(target, link[1], 0) : null;
  }
  return value;
}

export function resolveSample(entry: Pick<CatalogEntry, 'sample'>, spec: KalamSpec, now: Date): ResolvedSample {
  const today = localDate(now);
  const data: SampleData = entry.sample;
  const keys = new Map<string, Set<string>>();
  for (const [collection, rows] of Object.entries(data.records ?? {})) {
    keys.set(collection, new Set(rows.flatMap((r) => (r.key ? [r.key] : []))));
  }
  const records: Record<string, KalamRecord[]> = {};
  for (const [collection, rows] of Object.entries(data.records ?? {})) {
    if (!own(spec.collections, collection)) continue;
    records[collection] = rows.map((r, i) => {
      const values: Record<string, RecordValue> = {};
      for (const [field, v] of Object.entries(r.values)) values[field] = resolveValue(spec, collection, field, v, today, keys);
      // Entries added later get a later time, so "newest first" matches the order they are written in.
      const at = now.getTime() - (rows.length - i) * 60_000;
      return { id: rowId(collection, r.key, i), appId: spec.id, collectionId: collection, createdAt: at, updatedAt: at, values };
    });
  }
  return { records, state: { ...(data.state ?? {}) }, form: { ...(data.form ?? {}) } };
}

// ─── Checking ─────────────────────────────────────────────────────────────────
function fits(field: KalamField, value: RecordValue): string | undefined {
  switch (field.type) {
    case 'text': return typeof value === 'string' ? (field.maxLength && value.length > field.maxLength ? 'is too long' : undefined) : 'should be text';
    case 'number':
      if (typeof value !== 'number') return 'should be a number';
      if (field.min !== undefined && value < field.min) return 'is below the minimum';
      return field.max !== undefined && value > field.max ? 'is above the maximum' : undefined;
    case 'boolean': return typeof value === 'boolean' ? undefined : 'should be yes or no';
    case 'enum': return typeof value === 'string' && field.options.includes(value) ? undefined : 'is not one of the options';
    case 'date': return typeof value === 'string' && DATE.test(value) ? undefined : 'should be a date';
    case 'image': return 'cannot be sample data';
  }
}

/**
 * Everything wrong with a template's sample rows, one plain line each. Empty means every row fits the app it is
 * shown in: known lists and fields, the right kind of value, required fields present, links that resolve.
 */
export function sampleProblems(entry: Pick<CatalogEntry, 'id' | 'sample'>, spec: KalamSpec, now: Date): string[] {
  const out: string[] = [];
  const resolved = resolveSample(entry, spec, now);
  const reserved: readonly string[] = RESERVED_IDS;
  for (const [collection, rows] of Object.entries(entry.sample.records ?? {})) {
    const def = own(spec.collections, collection) ? spec.collections[collection] : undefined;
    if (!def) { out.push(`${collection}: the app has no such list`); continue; }
    rows.forEach((r, i) => {
      const where = `${collection} row ${i + 1}`;
      for (const [fid, f] of Object.entries(def.fields)) {
        if (f.type !== 'image' && 'required' in f && f.required && !own(r.values, fid)) out.push(`${where}: "${fid}" is required`);
      }
      for (const [fid, raw] of Object.entries(r.values)) {
        const f = own(def.fields, fid) ? def.fields[fid] : undefined;
        if (!f) { out.push(`${where}: no field "${fid}"`); continue; }
        const value = resolved.records[collection]?.[i]?.values[fid];
        if (value === null || value === undefined) { out.push(`${where}: "${fid}" does not resolve (${String(raw)})`); continue; }
        const problem = fits(f, value);
        if (problem) out.push(`${where}: "${fid}" ${problem}`);
        if (typeof raw === 'string' && (raw.startsWith('~') || raw.startsWith('>') || raw.startsWith('^')) && value === raw) out.push(`${where}: "${fid}" has an unresolved token`);
      }
    });
  }
  for (const key of Object.keys(entry.sample.state ?? {})) if (reserved.includes(key)) out.push(`state: "${key}" is reserved`);
  return out;
}
