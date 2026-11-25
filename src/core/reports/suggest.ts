/**
 * Reports worth showing for an app, worked out from its collections alone (docs/14 §7.3 step 2),
 * plus the builder that turns a few plain choices into a report definition. No model involved.
 */
import { collectionName, lower } from '../assistant/text';
import type { KalamSpec } from '../spec/schema';
import type { ReportRange, TimeUnit } from './chart-component';
import { REPORT_COPY } from './copy';
import type { ReportDefinition } from './definition';
import { validateReport } from './engine';

/** At most this many suggestions per collection. */
export const SUGGESTIONS_PER_COLLECTION = 8;

export interface ReportChoice {
  collection: string;
  measure: { operation: 'count' } | { operation: 'sum' | 'average'; field: string };
  split: { kind: 'none' } | { kind: 'field'; field: string } | { kind: 'time'; unit: TimeUnit };
  period: ReportRange;
}

const idFor = (cid: string, suffix: string): string => `${cid}_${suffix}`.slice(0, 48);

/** Fields of one collection, by what a report can do with them. Text fields are never used. */
export function reportableFields(spec: KalamSpec, collectionId: string) {
  const fields = Object.entries(spec.collections[collectionId]?.fields ?? {});
  const pick = (types: string[]) => fields.filter(([, f]) => types.includes(f.type)).map(([id, f]) => ({ id, label: f.label }));
  return { numbers: pick(['number']), groups: pick(['enum', 'boolean']), dates: pick(['date']) };
}

/** A plain choice from the builder, as a report definition. */
export function buildReport(spec: KalamSpec, choice: ReportChoice): ReportDefinition {
  const C = REPORT_COPY;
  const fields = spec.collections[choice.collection]?.fields ?? {};
  const label = (id: string) => lower(fields[id]?.label ?? id);
  const m = choice.measure;
  const metricLabel = m.operation === 'count' ? C.countLabel : m.operation === 'sum' ? C.totalLabel(label(m.field)) : C.averageLabel(label(m.field));
  const s = choice.split;
  const title = s.kind === 'field' ? `${metricLabel} by ${label(s.field)}` : s.kind === 'time' ? `${metricLabel} per ${s.unit}` : metricLabel;
  const dateField = reportableFields(spec, choice.collection).dates[0]?.id;
  return {
    id: idFor(choice.collection, 'custom'),
    title,
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
  const out: ReportDefinition[] = [];
  for (const cid of Object.keys(spec.collections)) {
    if (onlyCollection && cid !== onlyCollection) continue;
    const name = collectionName(spec, cid);
    const { numbers, groups, dates } = reportableFields(spec, cid);
    const dateField = dates[0]?.id;
    const count = { operation: 'count' as const, label: C.countLabel };
    const mine: ReportDefinition[] = [
      { id: idFor(cid, 'this_week'), title: C.thisWeek(name), sourceCollection: cid, dateField, range: { last: 1, unit: 'week' }, metrics: [count], compare: true },
      { id: idFor(cid, 'per_week'), title: C.countPer(name, 'week'), sourceCollection: cid, dateField, range: { last: 8, unit: 'week' }, groupBy: { kind: 'time', unit: 'week' }, metrics: [count] },
    ];
    for (const n of numbers.slice(0, 2)) {
      const f = lower(n.label);
      mine.push(
        { id: idFor(cid, `${n.id}_month`), title: C.totalPerMonth(f), sourceCollection: cid, dateField, range: { last: 6, unit: 'month' }, groupBy: { kind: 'time', unit: 'month' }, metrics: [{ operation: 'sum', field: n.id, label: C.totalLabel(f) }] },
        { id: idFor(cid, `${n.id}_avg`), title: C.averageThisMonth(f), sourceCollection: cid, dateField, range: { last: 1, unit: 'month' }, metrics: [{ operation: 'average', field: n.id, label: C.averageLabel(f) }], compare: true },
      );
    }
    for (const g of groups.slice(0, 2)) {
      const boolean = spec.collections[cid]!.fields[g.id]!.type === 'boolean';
      const total = numbers[0] ? [{ operation: 'sum' as const, field: numbers[0].id, label: C.totalLabel(lower(numbers[0].label)) }] : [];
      mine.push({
        id: idFor(cid, `by_${g.id}`),
        title: boolean ? C.yesOrNo(g.label) : C.byField(name, lower(g.label)),
        sourceCollection: cid, dateField, range: 'all', groupBy: { kind: 'field', field: g.id }, metrics: [count, ...total],
      });
    }
    out.push(...mine.filter((d) => validateReport(spec, d).length === 0).slice(0, SUGGESTIONS_PER_COLLECTION));
  }
  return out;
}
