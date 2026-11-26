/**
 * Formula context assembly, list queries and stat formatting (docs/09 §8, docs/05 §6.11–6.12).
 * All formula evaluation goes through the whitelisted engine in src/core/formula.
 */
import type { FormulaContext, FormulaResult, FormulaValue, KalamRecord, RecordValue } from '@/core/contracts';
import { evaluateFormula, formulaDependencies } from '@/core/formula';
import type { ComponentOf, KalamSpec } from '@/core/spec/schema';
import { statCurrency } from '@/core/spec/v11';
import { engineText } from '@/i18n/engine-messages';
import type { FieldDef } from './types';

export type CollectionValues = Record<string, ReadonlyArray<Readonly<Record<string, RecordValue>>>>;

/**
 * What a formula sees of one entry: its values plus `id`, its own id, so `filter(customers, id == selected)`
 * is the opened customer (eval 2026-11-25 s23). A field the app itself named `id` wins.
 */
const formulaRecord = (r: KalamRecord): Readonly<Record<string, RecordValue>> =>
  Object.prototype.hasOwnProperty.call(r.values, 'id') ? r.values : { ...r.values, id: r.id };

/** Record values per collection — build once per records snapshot and reuse (memoisation key). */
export function collectionValues(spec: KalamSpec, records: Record<string, KalamRecord[]>): CollectionValues {
  const out: Record<string, Array<Readonly<Record<string, RecordValue>>>> = {};
  for (const id of Object.keys(spec.collections)) out[id] = (records[id] ?? []).map(formulaRecord);
  return out;
}

/** `selected`: id of the entry the screen is about (state.selectedId), so a customer's page totals only that customer. */
export function formulaContext(
  collections: CollectionValues,
  form: Record<string, RecordValue>,
  state: Record<string, RecordValue>,
  now: Date,
  selected: string | null = null,
): FormulaContext {
  return { collections, form, state, now, selected };
}

type Reads = { form: boolean; state: boolean; selected: boolean };
const readsMemo = new Map<string, Reads>();

/**
 * Which mutable inputs a formula reads, so the UI can skip re-evaluating on every keystroke. Read from the parsed
 * formula (formulaDependencies), not from its text, so a quoted "form." in a string does not count. Memoised per
 * expression; the cap is a ceiling, a spec has far fewer formulas (ponytail: clear-all instead of LRU).
 */
export function formulaReads(expr: string): Reads {
  let r = readsMemo.get(expr);
  if (!r) {
    const d = formulaDependencies(expr);
    r = { form: d.form.length > 0, state: d.state.length > 0, selected: /\bselected\b/.test(expr) };
    if (readsMemo.size >= 500) readsMemo.clear();
    readsMemo.set(expr, r);
  }
  return r;
}

export function evaluate(expr: string, ctx: FormulaContext, lang?: string): FormulaResult {
  try {
    return evaluateFormula(expr, ctx);
  } catch (e) {
    // The formula engine should never throw; if it does, contain it to this component.
    return { ok: false, error: e instanceof Error ? e.message : engineText(lang, 'formulaFailed') };
  }
}

function compareValues(a: RecordValue | undefined, b: RecordValue | undefined): number {
  const an = a === undefined || a === null || a === '';
  const bn = b === undefined || b === null || b === '';
  if (an || bn) return an === bn ? 0 : an ? 1 : -1; // empty values last
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export interface ListQuery {
  rows: KalamRecord[];
  /** Set when the filter could not be evaluated; rows are then shown unfiltered. */
  filterError?: string;
}

/** Filters (record predicate), sorts (default newest first) and limits a list's records. */
export function queryList(list: ComponentOf<'list'>, records: KalamRecord[], ctx: FormulaContext, lang?: string): ListQuery {
  let rows = records;
  let filterError: string | undefined;
  if (list.filter) {
    const kept: KalamRecord[] = [];
    for (const r of records) {
      const res = evaluate(list.filter, { ...ctx, record: formulaRecord(r) }, lang);
      if (!res.ok) {
        filterError = res.error;
        break;
      }
      if (res.value) kept.push(r);
    }
    rows = filterError ? records : kept;
  }
  const sorted = [...rows];
  if (list.sort) {
    const { field, direction } = list.sort;
    const dir = direction === 'desc' ? -1 : 1;
    sorted.sort((a, b) => {
      const c = compareValues(a.values[field], b.values[field]);
      return c === 0 ? b.createdAt - a.createdAt : c * dir;
    });
  } else {
    sorted.sort((a, b) => b.createdAt - a.createdAt);
  }
  return { rows: list.limit ? sorted.slice(0, list.limit) : sorted, filterError };
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(lang: string): Intl.DateTimeFormat {
  let f = dateFormatters.get(lang);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      f = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    dateFormatters.set(lang, f);
  }
  return f;
}

function safeNumberFormat(lang: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(lang, opts);
  } catch {
    return new Intl.NumberFormat('en', opts.style === 'currency' ? { maximumFractionDigits: 2 } : opts);
  }
}

/** Human-readable record value for list rows. */
export function formatFieldValue(def: FieldDef | undefined, value: RecordValue | undefined, lang: string): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (def?.type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return dateFormatter(lang).format(new Date(y, m - 1, d));
  }
  if (typeof value === 'number') {
    const s = safeNumberFormat(lang, { maximumFractionDigits: def?.decimals ?? 2 }).format(value);
    return def?.unit ? `${s} ${def.unit}` : s;
  }
  return String(value);
}

/** Shown for a stat with no value. Compare against it instead of the literal. */
export const EMPTY_STAT = '—';

/**
 * Formats a stat result. Errors and non-finite values render as EMPTY_STAT, never "NaN". `currency` is the
 * resolved one (statCurrency: the stat's, else the app's setting, else INR).
 */
export function formatStat(stat: ComponentOf<'stat'>, result: FormulaResult, lang: string, currency: string = statCurrency({}, stat)): string {
  if (!result.ok) return EMPTY_STAT;
  const v: FormulaValue = result.value;
  if (v === null) return EMPTY_STAT;
  let body: string;
  if (Array.isArray(v)) {
    body = safeNumberFormat(lang, {}).format(v.length);
  } else if (typeof v === 'number') {
    if (!Number.isFinite(v)) return EMPTY_STAT;
    switch (stat.format) {
      case 'integer':
        body = safeNumberFormat(lang, { maximumFractionDigits: 0 }).format(Math.round(v));
        break;
      case 'currency':
        body = safeNumberFormat(lang, { style: 'currency', currency }).format(v);
        break;
      case 'percent':
        body = safeNumberFormat(lang, { style: 'percent', maximumFractionDigits: 1 }).format(v);
        break;
      case 'text':
        body = String(v);
        break;
      default:
        body = safeNumberFormat(lang, { maximumFractionDigits: 2 }).format(v);
    }
  } else if (typeof v === 'boolean') {
    body = v ? 'Yes' : 'No';
  } else {
    body = String(v);
  }
  return `${stat.prefix ?? ''}${body}${stat.suffix ?? ''}`;
}
