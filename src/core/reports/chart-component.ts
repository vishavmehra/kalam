/**
 * PROPOSED KalamSpec v1.1 `chart` component (docs/00 §11.2 "later component additions", docs/14 §7.5,
 * ADR-034). Additive and optional: specs without a chart are unchanged.
 *
 * This file imports only zod, so src/core/spec/schema.ts can import it without an import cycle.
 * The id rule and label limits copy schema.ts (`idSchema`, `LIMITS.labelLength`). A chart is data:
 * it names a collection, one metric and one grouping, and the runtime computes every number.
 */
import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, 'Identifiers use lowercase letters, digits and underscores');
const shortText = z.string().max(120);

export const TIME_UNITS = ['day', 'week', 'month'] as const;
export const timeUnitSchema = z.enum(TIME_UNITS);
export const METRIC_OPERATIONS = ['count', 'sum', 'average'] as const;
export const FILTER_OPERATORS = ['equals', 'not_equals', 'greater_than', 'less_than'] as const;

/** Keep entries where `field` compares to `value`. Dates are written YYYY-MM-DD. */
export const reportFilterSchema = z
  .object({
    field: id,
    operator: z.enum(FILTER_OPERATORS),
    value: z.union([z.string().min(1).max(60), z.number().finite(), z.boolean()]),
  })
  .strict();

/** 'all', or the current period plus the ones before it ("last 4 weeks" = this week and the 3 before). */
export const reportRangeSchema = z.union([
  z.literal('all'),
  z.object({ last: z.number().int().min(1).max(60), unit: timeUnitSchema }).strict(),
]);

export const CHART_KINDS = ['bar', 'line', 'donut'] as const;

export const chartComponentSchema = z
  .object({
    id,
    visible: z.boolean().optional(),
    secondary: z.boolean().optional(),
    a11yLabel: shortText.optional(),
    a11yDescription: z.string().max(300).optional(),
    readAloud: z.string().max(300).optional(),
    type: z.literal('chart'),
    label: z.string().min(1).max(120),
    chart: z.enum(CHART_KINDS),
    /** Collection the chart reads. */
    source: id,
    metric: z.enum(METRIC_OPERATIONS),
    /**
     * Number field of `source` for sum and average. Count takes none. Not called `field`: across
     * the codebase a component's `field` is a binding to the screen form, and a chart binds nothing.
     */
    valueField: id.optional(),
    /** Enum or yes/no field to split by. Use this or `period`, not both. */
    groupBy: id.optional(),
    /** Time bucket to split by. */
    period: timeUnitSchema.optional(),
    /** Date field for periods and ranges. Absent: the time each entry was added. */
    dateField: id.optional(),
    range: reportRangeSchema.optional(),
    filters: z.array(reportFilterSchema).max(3).optional(),
  })
  .strict()
  .refine((c) => (c.groupBy === undefined) !== (c.period === undefined), {
    message: 'A chart is split by a field or by a period, not both and not neither.',
    path: ['groupBy'],
  })
  .refine((c) => (c.metric === 'count') === (c.valueField === undefined), {
    message: 'Count takes no field. Sum and average need a number field.',
    path: ['valueField'],
  });

export type ChartComponent = z.infer<typeof chartComponentSchema>;
export type ChartKind = (typeof CHART_KINDS)[number];
export type TimeUnit = (typeof TIME_UNITS)[number];
export type ReportFilter = z.infer<typeof reportFilterSchema>;
export type ReportRange = z.infer<typeof reportRangeSchema>;
