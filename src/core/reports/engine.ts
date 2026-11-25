/**
 * Smart Reports engine (docs/14 §7, docs/00 §24.3). Pure and deterministic: every number is
 * computed here from the app's own records, never by a model. Inputs are a validated report
 * definition, one collection's records, an injected `now` and an explicit time zone.
 */
import { collectionName } from '../assistant/text';
import type { RecordValue } from '../contracts';
import { toNumber } from '../formula';
import type { KalamCollection, KalamField, KalamSpec } from '../spec/schema';
import type { ReportFilter, TimeUnit } from './chart-component';
import { REPORT_COPY } from './copy';
import { addDays, bucketLabel, bucketsBetween, civilDate, formatDay, parseCivil, shift, startOf } from './dates';
import { describeResult } from './describe';
import { type ReportDefinition, reportDefinitionSchema, type ReportMetric, type ReportView } from './definition';

export interface ReportRow {
  values: Readonly<Record<string, RecordValue>>;
  /** Epoch ms the entry was added. Used when the report has no date field. */
  createdAt?: number;
}

export interface ReportOptions {
  now: Date;
  /** IANA zone for "today" and for the time entries were added. Absent: the device zone. */
  timeZone?: string;
  /** Language for dates and numbers. Default: the app's language. */
  lang?: string;
}

export interface ReportMetricInfo { label: string; operation: ReportMetric['operation']; unit?: string }
export interface ReportPoint {
  key: string;
  /** Option name, Yes/No, or a date bucket. Never free text typed into a record. */
  label: string;
  /** One value per metric. null: nothing to average. */
  values: Array<number | null>;
  entries: number;
}
export type ReportStatus = 'empty' | 'none_in_range' | 'not_enough' | 'ok';
export interface ReportComparison {
  /** The earlier stretch, written out. */
  range: string;
  current: number | null;
  previous: number | null;
  /** null when the earlier value is zero or missing. */
  percent: number | null;
  direction: 'up' | 'down' | 'same' | 'new';
}
export interface ReportResult {
  id: string;
  title: string;
  collection: string;
  lang: string;
  metrics: ReportMetricInfo[];
  group: 'none' | 'field' | 'time';
  unit?: TimeUnit;
  /** Table header for the group column. */
  groupLabel: string;
  points: ReportPoint[];
  totals: Array<number | null>;
  /** Entries counted. */
  entries: number;
  /** Entries left out because the report needs a date and they have none. */
  skipped: number;
  /** Always explicit (docs/14 §7.7). */
  range: { from?: string; to: string; label: string };
  comparison?: ReportComparison;
  trend?: 'up' | 'down' | 'flat';
  status: ReportStatus;
  view: ReportView;
  /** One plain sentence, used as the chart summary. */
  summary: string;
  /** Comparison, trend and data notes, one sentence each. */
  details: string[];
}
export type ReportOutcome = { ok: true; result: ReportResult } | { ok: false; errors: string[] };

/** More time buckets than this and the oldest ones are left out (the range label says so). */
export const MAX_BUCKETS = 60;
/** More categories than this and the smallest fold into "Other". */
export const MAX_GROUPS = 12;

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const tidy = (x: number): number => Math.round(x * 1e6) / 1e6;

// ─── Validation ──────────────────────────────────────────────────────────────

function filterFits(f: KalamField, filter: ReportFilter): boolean {
  const eq = filter.operator === 'equals' || filter.operator === 'not_equals';
  switch (f.type) {
    case 'number': return typeof filter.value === 'number';
    case 'date': return parseCivil(filter.value) !== undefined;
    case 'boolean': return eq && typeof filter.value === 'boolean';
    case 'enum': return eq && typeof filter.value === 'string' && f.options.includes(filter.value);
    default: return eq && typeof filter.value === 'string';
  }
}

/** Reference and type checks against the app's own spec. Empty means valid. */
export function validateReport(spec: KalamSpec, def: ReportDefinition): string[] {
  const C = REPORT_COPY;
  const col: KalamCollection | undefined = own(spec.collections, def.sourceCollection) ? spec.collections[def.sourceCollection] : undefined;
  if (!col) return [C.unknownCollection(def.sourceCollection)];
  const field = (id: string): KalamField | undefined => (own(col.fields, id) ? col.fields[id] : undefined);
  const errors: string[] = [];
  const need = (id: string, ok: (f: KalamField) => boolean, wrong: string) => {
    const f = field(id);
    if (!f) errors.push(C.unknownField(id));
    else if (!ok(f)) errors.push(wrong);
  };
  for (const m of def.metrics) if (m.field) need(m.field, (f) => f.type === 'number', C.needsNumber(m.field));
  if (def.dateField) need(def.dateField, (f) => f.type === 'date', C.needsDate(def.dateField));
  if (def.groupBy?.kind === 'field') need(def.groupBy.field, (f) => f.type === 'enum' || f.type === 'boolean', C.needsGroupable(def.groupBy.field));
  for (const f of def.filters ?? []) need(f.field, (d) => filterFits(d, f), C.badFilter(f.field));
  if (def.compare && def.range === 'all') errors.push(C.compareNeedsRange);
  if (def.view === 'line' && def.groupBy?.kind !== 'time') errors.push(C.lineNeedsTime);
  if (def.view === 'donut' && def.groupBy?.kind !== 'field') errors.push(C.donutNeedsField);
  if (def.view === 'bar' && !def.groupBy) errors.push(C.viewNeedsGroup('bar'));
  return errors;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

const asBool = (v: unknown): boolean | null => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null);

function matches(f: KalamField, filter: ReportFilter, raw: RecordValue | undefined): boolean {
  const { operator: op, value } = filter;
  const test = <T>(a: T | null | undefined, b: T): boolean => {
    if (a === null || a === undefined) return op === 'not_equals';
    return op === 'equals' ? a === b : op === 'not_equals' ? a !== b : op === 'greater_than' ? a > b : a < b;
  };
  switch (f.type) {
    case 'number': return test(toNumber(raw), value as number);
    case 'date': return test(parseCivil(raw), parseCivil(value) ?? '');
    case 'boolean': return test(asBool(raw), value as boolean);
    default: return test(raw === null || raw === undefined ? '' : String(raw), String(value));
  }
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

interface Acc { entries: number; sums: number[]; counts: number[] }

function aggregator(metrics: readonly ReportMetric[]) {
  const make = (): Acc => ({ entries: 0, sums: metrics.map(() => 0), counts: metrics.map(() => 0) });
  const add = (acc: Acc, values: ReportRow['values']): void => {
    acc.entries += 1;
    metrics.forEach((m, i) => {
      if (!m.field) return;
      const n = toNumber(values[m.field]); // text, blanks and other non-numbers are ignored
      if (n !== null) { acc.sums[i]! += n; acc.counts[i]! += 1; }
    });
  };
  const merge = (a: Acc, b: Acc): Acc => ({
    entries: a.entries + b.entries, sums: a.sums.map((s, i) => s + b.sums[i]!), counts: a.counts.map((c, i) => c + b.counts[i]!),
  });
  const values = (acc: Acc): Array<number | null> => metrics.map((m, i) => {
    if (m.operation === 'count') return acc.entries;
    if (m.operation === 'sum') return tidy(acc.sums[i]!);
    return acc.counts[i] ? tidy(acc.sums[i]! / acc.counts[i]!) : null;
  });
  return { make, add, merge, values };
}

/** Linear-fit direction of a series. Undefined below 3 values; level when the change is under 10%. */
export function trendOf(series: ReadonlyArray<number | null>): 'up' | 'down' | 'flat' | undefined {
  const pts = series.flatMap((v, i) => (v === null ? [] : [[i, v] as const]));
  if (pts.length < 3) return undefined;
  const mx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
  const my = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
  const den = pts.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  const slope = pts.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / den;
  const scale = pts.reduce((s, [, y]) => s + Math.abs(y), 0) / pts.length;
  if (scale === 0) return 'flat';
  const rel = (slope * (pts[pts.length - 1]![0] - pts[0]![0])) / scale;
  return Math.abs(rel) < 0.1 ? 'flat' : rel > 0 ? 'up' : 'down';
}

export function percentChange(current: number | null, previous: number | null): Pick<ReportComparison, 'percent' | 'direction'> {
  const cur = current ?? 0;
  const prev = previous ?? 0;
  if (prev === 0) return { percent: null, direction: cur === 0 ? 'same' : 'new' };
  const percent = Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
  return { percent, direction: percent > 0 ? 'up' : percent < 0 ? 'down' : 'same' };
}

// ─── Run ─────────────────────────────────────────────────────────────────────

interface Dated { row: ReportRow; date: string }

export function runReport(spec: KalamSpec, input: ReportDefinition, rows: readonly ReportRow[], opts: ReportOptions): ReportOutcome {
  const parsed = reportDefinitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => i.message) };
  const def = parsed.data;
  const errors = validateReport(spec, def);
  if (errors.length) return { ok: false, errors };

  const C = REPORT_COPY;
  const lang = opts.lang ?? spec.lang;
  const col = spec.collections[def.sourceCollection]!;
  const today = civilDate(opts.now, opts.timeZone);
  const agg = aggregator(def.metrics);
  const groupField = def.groupBy?.kind === 'field' ? col.fields[def.groupBy.field] : undefined;
  const unit = def.groupBy?.kind === 'time' ? def.groupBy.unit : undefined;
  const last = def.range === 'all' ? undefined : def.range;
  const needsDate = !!last || !!unit || !!def.compare;

  // 1. Filters.
  const filtered = rows.filter((r) => (def.filters ?? []).every((f) => matches(col.fields[f.field]!, f, r.values[f.field])));

  // 2. Dates (only when the report is about time).
  const dateOf = (r: ReportRow): string | undefined =>
    def.dateField ? parseCivil(r.values[def.dateField])
      : r.createdAt !== undefined && Number.isFinite(r.createdAt) ? civilDate(r.createdAt, opts.timeZone) : undefined;
  let skipped = 0;
  const dated: Dated[] = [];
  for (const row of filtered) {
    const date = needsDate ? dateOf(row) : today;
    if (date) dated.push({ row, date });
    else skipped += 1;
  }

  // 3. Explicit range. "last N" ends today; "all" runs from the first entry to the last one or today.
  let from = last ? startOf(shift(today, last.unit, -(last.last - 1)), last.unit) : undefined;
  let to = today;
  if (!last && needsDate && dated.length) {
    const sorted = dated.map((d) => d.date).sort();
    from = sorted[0];
    if (sorted[sorted.length - 1]! > to) to = sorted[sorted.length - 1]!;
  }
  let buckets: string[] = [];
  if (unit && from) {
    buckets = bucketsBetween(from, to, unit);
    if (buckets.length > MAX_BUCKETS) buckets = buckets.slice(-MAX_BUCKETS);
    if (!last) from = buckets[0];
  }
  const inRange = dated.filter((d) => !needsDate || ((!from || d.date >= from) && d.date <= to));
  const rangeLabel = needsDate && from ? C.range(formatDay(from, lang), formatDay(to, lang)) : C.allTime;

  // 4. Groups.
  const total = agg.make();
  for (const d of inRange) agg.add(total, d.row.values);
  let points: ReportPoint[] = [];
  if (unit) {
    const accs = new Map(buckets.map((k) => [k, agg.make()]));
    for (const d of inRange) {
      const acc = accs.get(startOf(d.date, unit));
      if (acc) agg.add(acc, d.row.values);
    }
    points = buckets.map((k) => ({ key: k, label: bucketLabel(k, unit, lang), values: agg.values(accs.get(k)!), entries: accs.get(k)!.entries }));
  } else if (groupField) {
    points = fieldGroups(groupField, inRange.map((d) => d.row.values), def.groupBy?.kind === 'field' ? def.groupBy.field : '', agg);
  }

  // 5. This period against the same stretch of the one before.
  let comparison: ReportComparison | undefined;
  if (def.compare && last && from) {
    const prevFrom = shift(from, last.unit, -last.last);
    const sameStretch = shift(today, last.unit, -last.last);
    const dayBefore = addDays(from, -1);
    const prevTo = sameStretch < dayBefore ? sameStretch : dayBefore;
    const prev = agg.make();
    for (const d of dated) if (d.date >= prevFrom && d.date <= prevTo) agg.add(prev, d.row.values);
    const current = agg.values(total)[0] ?? null;
    const previous = agg.values(prev)[0] ?? null;
    comparison = { range: C.range(formatDay(prevFrom, lang), formatDay(prevTo, lang)), current, previous, ...percentChange(current, previous) };
  }

  const busyBuckets = points.filter((p) => p.entries > 0).length;
  const status: ReportStatus = rows.length === 0 ? 'empty'
    : inRange.length === 0 ? 'none_in_range'
      : unit && busyBuckets < 2 ? 'not_enough' : 'ok';
  const trend = unit && status === 'ok' ? trendOf(points.map((p) => p.values[0] ?? null)) : undefined;

  let view: ReportView = 'number';
  if (status === 'ok' && def.groupBy) view = def.view ?? (unit ? 'line' : groupField?.type === 'boolean' ? 'donut' : 'bar');
  if (def.view === 'table' && status !== 'empty') view = 'table';

  const result: ReportResult = {
    id: def.id, title: def.title, collection: collectionName(spec, def.sourceCollection), lang,
    metrics: def.metrics.map((m) => {
      const f = m.field ? col.fields[m.field] : undefined;
      return { label: m.label, operation: m.operation, unit: f?.type === 'number' ? f.unit : undefined };
    }),
    group: unit ? 'time' : groupField ? 'field' : 'none',
    unit,
    groupLabel: C.groupHeader(unit, groupField?.label),
    points,
    totals: agg.values(total),
    entries: inRange.length,
    skipped,
    range: { from: needsDate ? from : undefined, to, label: rangeLabel },
    comparison,
    trend,
    status,
    view,
    summary: '',
    details: [],
  };
  return { ok: true, result: { ...result, ...describeResult(result) } };
}

/** Option order (so colours follow the option, not its rank), then Other and Not set when used. */
function fieldGroups(field: KalamField, rows: ReadonlyArray<ReportRow['values']>, fieldId: string, agg: ReturnType<typeof aggregator>): ReportPoint[] {
  const C = REPORT_COPY;
  const order: Array<{ key: string; label: string }> = field.type === 'enum'
    ? field.options.map((o) => ({ key: `opt:${o}`, label: o }))
    : [{ key: 'yes', label: C.yes }, { key: 'no', label: C.no }];
  const otherOption = field.type === 'enum' ? field.options.find((o) => o.toLowerCase() === C.other.toLowerCase()) : undefined;
  const keyOf = (v: RecordValue | undefined): string => {
    if (v === null || v === undefined || v === '') return '~unset';
    if (field.type === 'boolean') {
      const b = asBool(v);
      return b === null ? '~unset' : b ? 'yes' : 'no';
    }
    const s = String(v);
    // A value outside the options is never shown as typed: it is counted under "Other".
    return field.type === 'enum' && field.options.includes(s) ? `opt:${s}` : otherOption ? `opt:${otherOption}` : '~other';
  };
  const accs = new Map<string, Acc>();
  for (const values of rows) {
    const k = keyOf(values[fieldId]);
    const acc = accs.get(k) ?? agg.make();
    agg.add(acc, values);
    accs.set(k, acc);
  }
  const all = [...order, { key: '~other', label: C.other }, { key: '~unset', label: C.notSet }]
    .filter((g) => !g.key.startsWith('~') || accs.has(g.key))
    .map((g) => ({ ...g, acc: accs.get(g.key) ?? agg.make() }));
  let kept = all;
  if (all.length > MAX_GROUPS) {
    // Too many to read: keep the biggest, fold the rest into "Other".
    const used = all.filter((g) => g.acc.entries > 0 && g.key !== '~other').sort((a, b) => (agg.values(b.acc)[0] ?? 0) - (agg.values(a.acc)[0] ?? 0));
    kept = used.slice(0, MAX_GROUPS - 1);
    const rest = [...used.slice(MAX_GROUPS - 1), ...all.filter((g) => g.key === '~other')];
    if (rest.length) kept.push({ key: '~other', label: C.other, acc: rest.reduce((s, g) => agg.merge(s, g.acc), agg.make()) });
  }
  return kept.map((g) => ({ key: g.key, label: g.label, values: agg.values(g.acc), entries: g.acc.entries }));
}
