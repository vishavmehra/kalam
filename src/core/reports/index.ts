import type { KalamSpec } from '../spec/schema';
import type { ChartComponent } from './chart-component';
import { chartToReport, reportDefinitionSchema } from './definition';
import { schemaErrors, validateReport } from './engine';
export {
  CHART_KINDS, chartComponentSchema, reportFilterSchema, reportRangeSchema, TIME_UNITS,
  type ChartComponent, type ChartKind, type ReportFilter, type ReportRange, type TimeUnit,
} from './chart-component';
export { REPORT_COPY } from './copy';
export { civilDate } from './dates';
export {
  chartToReport, REPORT_VIEWS, reportDefinitionSchema,
  type ReportDefinition, type ReportGroup, type ReportMetric, type ReportView,
} from './definition';
export { formatPercent, formatValue, plainExplanation, reportToText } from './describe';
export {
  MAX_BUCKETS, MAX_GROUPS, percentChange, runReport, schemaErrors, timeSplitFits, trendOf, validateReport,
  type ReportComparison, type ReportMetricInfo, type ReportOptions, type ReportOutcome, type ReportPoint,
  type ReportResult, type ReportRow, type ReportStatus,
} from './engine';
export { aggregatesText, EXPLANATION_MAX, explainReport, type ExplainContext, type ReportExplanation } from './explain';
export { barFractions, barPath, donutArcs, lineGeometry, niceMax, type DonutArc, type LinePoint } from './geometry';
export { createReportService, type ReportService, type ReportServiceDeps } from './service';
export { buildReport, reportableFields, suggestReports, type ReportChoice } from './suggest';

/**
 * Checks for a v1.1 chart component, for src/core/spec/validate.ts: the report it stands for must
 * parse and its references must hold, so a chart that validates also renders. Empty means valid.
 */
export function validateChartComponent(spec: KalamSpec, c: ChartComponent): string[] {
  const parsed = reportDefinitionSchema.safeParse(chartToReport(c));
  return parsed.success ? validateReport(spec, parsed.data) : schemaErrors(parsed.error.issues);
}
