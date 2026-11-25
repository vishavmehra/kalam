/**
 * Plain-English wording of a computed report. Deterministic: this is the explanation shown when no
 * model runs, offline, and as the one-sentence chart summary.
 */
import { formatNumber } from '../assistant/text';
import { REPORT_COPY } from './copy';
import type { ReportMetricInfo, ReportResult } from './engine';

/** 1240.5 with unit "kg" → "1,240.5 kg". Nothing to average → "no value". */
export function formatValue(v: number | null | undefined, metric: Pick<ReportMetricInfo, 'unit'> | undefined, lang: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return REPORT_COPY.noValue;
  const n = formatNumber(v, lang);
  return metric?.unit ? `${n} ${metric.unit}` : n;
}

export const formatPercent = (p: number, lang: string): string => `${formatNumber(Math.abs(p), lang)}%`;

export function describeResult(r: ReportResult): Pick<ReportResult, 'summary' | 'details'> {
  const C = REPORT_COPY;
  const m = r.metrics[0]!;
  const range = r.range.from ? r.range.label : C.allTimeInSentence;
  const fmt = (v: number | null | undefined) => formatValue(v, m, r.lang);
  if (r.status === 'empty') return { summary: C.empty(r.collection), details: [] };
  if (r.status === 'none_in_range') return { summary: C.noneInRange(r.collection, range), details: r.skipped ? [C.skipped(r.skipped)] : [] };

  let summary = C.single(m.label, range, fmt(r.totals[0]));
  const top = r.points.reduce<ReportResult['points'][number] | undefined>(
    (best, p) => ((p.values[0] ?? -Infinity) > (best?.values[0] ?? -Infinity) ? p : best), undefined,
  );
  if (r.status === 'ok' && top && r.group === 'field') {
    summary = C.byGroup(m.label, top.label, fmt(top.values[0]), r.points.filter((p) => p.entries > 0).length, range);
  } else if (r.status === 'ok' && top && r.group === 'time') {
    summary = C.perTime(m.label, range, top.label, fmt(top.values[0]));
  }

  const details: string[] = [];
  const cmp = r.comparison;
  if (cmp) {
    const pct = cmp.percent === null ? '' : formatPercent(cmp.percent, r.lang);
    details.push(cmp.direction === 'up' ? C.up(pct, cmp.range) : cmp.direction === 'down' ? C.down(pct, cmp.range)
      : cmp.direction === 'new' ? C.fromNothing(cmp.range) : C.same(cmp.range));
  }
  if (r.status === 'not_enough' && r.unit) details.push(C.notEnough(r.unit));
  if (r.trend) details.push(C.trend[r.trend]);
  if (r.skipped) details.push(C.skipped(r.skipped));
  return { summary, details };
}

/** The deterministic explanation: summary plus details. */
export const plainExplanation = (r: ReportResult): string => [r.summary, ...r.details].join(' ');

/** Exportable plain-text summary (docs/14 §7.2). Aggregates only, never single entries. */
export function reportToText(r: ReportResult): string {
  const lines = [r.title, r.range.label, '', plainExplanation(r)];
  if (r.points.length) {
    lines.push('', `${r.groupLabel}: ${r.metrics.map((m) => m.label).join(' | ')}`);
    for (const p of r.points) lines.push(`${p.label}: ${p.values.map((v, i) => formatValue(v, r.metrics[i], r.lang)).join(' | ')}`);
  }
  lines.push('', `${REPORT_COPY.entries}: ${formatValue(r.entries, undefined, r.lang)}`);
  return lines.join('\n');
}
