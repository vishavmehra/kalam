/**
 * Reports worth showing for an app, worked out from its collections alone (docs/14 §7.3 step 2),
 * plus the builder that turns a few plain choices into a report definition. No model involved.
 */
import { collectionName, lower } from '../assistant/text';
import type { KalamSpec } from '../spec/schema';
import type { ReportRange, TimeUnit } from './chart-component';
import { REPORT_COPY } from './copy';
import { type ReportDefinition, reportDefinitionSchema } from './definition';
import { validateReport } from './engine';

/** At most this many suggestions per collection. */
export const SUGGESTIONS_PER_COLLECTION = 8;

export interface ReportChoice {
  collection: string;
  measure: { operation: 'count' } | { operation: 'sum' | 'average'; field: string };
  split: { kind: 'none' } | { kind: 'field'; field: string } | { kind: 'time'; unit: TimeUnit };
  period: ReportRange;
  /** Date field for the period. Absent: the first date field. null: when each entry was added. */
  dateField?: string | null;
}

/** Titles and labels fit the definition schema however long the app's own labels are. */
const TEXT_MAX = 120;
const clip = (s: string): string => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 1).trimEnd()}…` : s);

/** Ids are unique in one list of suggestions: a long collection id never cuts off what tells two apart. */
function idMaker() {
  const used = new Set<string>();
  return (cid: string, suffix: string): string => {
    const raw = `${cid}_${suffix}`;
    let id = raw.slice(0, 48);
    for (let n = 2; used.has(id); n += 1) id = `${raw.slice(0, 47 - String(n).length)}_${n}`;
    used.add(id);
    return id;
  };
}

/** Fields of one collection, by what a report can do with them. Text fields are never used. */
export function reportableFields(spec: KalamSpec, collectionId: string) {
  const fields = Object.entries(spec.collections[collectionId]?.fields ?? {});
  const pick = (types: string[]) => fields.filter(([, f]) => types.includes(f.type)).map(([id, f]) => ({ id, label: f.label }));
  return { numbers: pick(['number']), groups: pick(['enum', 'boolean']), dates: pick(['date']) };
}

const usable = (spec: KalamSpec, d: ReportDefinition): boolean =>
  reportDefinitionSchema.safeParse(d).success && validateReport(spec, d).length === 0;

/** A plain choice from the builder, as a report definition. */
export function buildReport(spec: KalamSpec, choice: ReportChoice): ReportDefinition {
  const C = REPORT_COPY;
  const fields = spec.collections[choice.collection]?.fields ?? {};
  const label = (id: string) => lower(fields[id]?.label ?? id);
  const m = choice.measure;
  const metricLabel = clip(m.operation === 'count' ? C.countLabel : m.operation === 'sum' ? C.totalLabel(label(m.field)) : C.averageLabel(label(m.field)));
  const s = choice.split;
  const title = s.kind === 'field' ? `${metricLabel} by ${label(s.field)}` : s.kind === 'time' ? `${metricLabel} per ${s.unit}` : metricLabel;
  const dateField = choice.dateField === null ? undefined : choice.dateField ?? reportableFields(spec, choice.collection).dates[0]?.id;
  return {
    id: idMaker()(choice.collection, 'custom'),
    title: clip(title),
    sourceCollection: choice.collection,
    dateField,
    range: choice.period,
    groupBy: s.kind === 'none' ? undefined : s.kind === 'field' ? { kind: 'field', field: s.field } : { kind: 'time', unit: s.unit },
    metrics: [m.operation === 'count' ? { operation: 'count', label: metricLabel } : { operation: m.operation, field: m.field, label: metricLabel }],
    compare: choice.period !== 'all' && s.kind !== 'time' ? true : undefined,
  };
}

/** Useful reports for every collection (or one): counts over time, totals, averages, splits. */
export function suggestReports(spec: KalamSpec, onlyCollection?: string): ReportDefinition[] {
  const C = REPORT_COPY;
  const idFor = idMaker();
  const out: ReportDefinition[] = [];
  for (const cid of Object.keys(spec.collections)) {
    if (onlyCollection && cid !== onlyCollection) continue;
    const name = collectionName(spec, cid);
    const { numbers, groups, dates } = reportableFields(spec, cid);
    // ponytail: the first date field is the time axis; the builder offers the others.
    const dateField = dates[0]?.id;
    const count = { operation: 'count' as const, label: C.countLabel };
    const mine: ReportDefinition[] = [
      { id: idFor(cid, 'this_week'), title: clip(C.thisWeek(name)), sourceCollection: cid, dateField, range: { last: 1, unit: 'week' }, metrics: [count], compare: true },
      { id: idFor(cid, 'per_week'), title: clip(C.countPer(name, 'week')), sourceCollection: cid, dateField, range: { last: 8, unit: 'week' }, groupBy: { kind: 'time', unit: 'week' }, metrics: [count] },
    ];
    for (const n of numbers.slice(0, 2)) {
      const f = lower(n.label);
      mine.push(
        { id: idFor(cid, `${n.id}_month`), title: clip(C.totalPerMonth(f)), sourceCollection: cid, dateField, range: { last: 6, unit: 'month' }, groupBy: { kind: 'time', unit: 'month' }, metrics: [{ operation: 'sum', field: n.id, label: clip(C.totalLabel(f)) }] },
        { id: idFor(cid, `${n.id}_avg`), title: clip(C.averageThisMonth(f)), sourceCollection: cid, dateField, range: { last: 1, unit: 'month' }, metrics: [{ operation: 'average', field: n.id, label: clip(C.averageLabel(f)) }], compare: true },
      );
    }
    for (const g of groups.slice(0, 2)) {
      const boolean = spec.collections[cid]!.fields[g.id]!.type === 'boolean';
      const total = numbers[0] ? [{ operation: 'sum' as const, field: numbers[0].id, label: clip(C.totalLabel(lower(numbers[0].label))) }] : [];
      mine.push({
        id: idFor(cid, `by_${g.id}`),
        title: clip(boolean ? C.yesOrNo(g.label) : C.byField(name, lower(g.label))),
        sourceCollection: cid, dateField, range: 'all', groupBy: { kind: 'field', field: g.id }, metrics: [count, ...total],
      });
    }
    out.push(...mine.filter((d) => usable(spec, d)).slice(0, SUGGESTIONS_PER_COLLECTION));
  }
  return out;
}
