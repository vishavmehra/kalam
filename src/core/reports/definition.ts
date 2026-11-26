/**
 * Report definition (docs/14 §7.4): plain data with a strict schema. It names one collection, the
 * metrics to compute, an optional grouping and an explicit date range. Nothing in it is executed.
 */
import { z } from 'zod';

import { idSchema } from '../spec/schema';
import {
  type ChartComponent, METRIC_OPERATIONS, reportFilterSchema, reportRangeSchema, timeUnitSchema,
} from './chart-component';

export const reportMetricSchema = z
  .object({
    operation: z.enum(METRIC_OPERATIONS),
    /** Number field for sum and average. Count takes none. */
    field: idSchema.optional(),
    /** Same limit as a spec label, so a chart's label always fits. */
    label: z.string().min(1).max(120),
  })
  .strict()
  .refine((m) => (m.operation === 'count') === (m.field === undefined), {
    message: 'Count takes no field. Sum and average need a number field.',
    path: ['field'],
  });

export const reportGroupSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('field'), field: idSchema }).strict(),
  z.object({ kind: z.literal('time'), unit: timeUnitSchema }).strict(),
]);

export const REPORT_VIEWS = ['number', 'bar', 'line', 'donut', 'table'] as const;

export const reportDefinitionSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(120),
    sourceCollection: idSchema,
    filters: z.array(reportFilterSchema).max(5).optional(),
    /** Date field used for the range and time groups. Absent: the time each entry was added. */
    dateField: idSchema.optional(),
    range: reportRangeSchema,
    groupBy: reportGroupSchema.optional(),
    /** Charts draw the first metric only (one axis). The table shows them all. */
    metrics: z.array(reportMetricSchema).min(1).max(3),
    /** Compare this period with the same stretch of the period before it. Needs a `last` range. */
    compare: z.boolean().optional(),
    /** Preferred view. Absent: chosen from the data. */
    view: z.enum(REPORT_VIEWS).optional(),
  })
  .strict();

export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;
export type ReportMetric = z.infer<typeof reportMetricSchema>;
export type ReportGroup = z.infer<typeof reportGroupSchema>;
export type ReportView = (typeof REPORT_VIEWS)[number];

/** The report a chart component stands for. */
export function chartToReport(c: ChartComponent): ReportDefinition {
  return {
    id: c.id,
    title: c.label,
    sourceCollection: c.source,
    filters: c.filters,
    dateField: c.dateField,
    // A time chart with no range shows the last 8 periods; a split by field covers all entries.
    range: c.range ?? (c.period ? { last: 8, unit: c.period } : 'all'),
    groupBy: c.period ? { kind: 'time', unit: c.period } : { kind: 'field', field: c.groupBy ?? '' },
    metrics: [{ operation: c.metric, field: c.valueField, label: c.label }],
    view: c.chart,
  };
}
