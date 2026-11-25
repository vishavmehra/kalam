/**
 * Every sentence and label the report engine produces. Plain English, kept in one place so the
 * i18n migration can move it. UI strings live in src/features/reports/copy.ts.
 */
import type { TimeUnit } from './chart-component';

const UNIT_WORD: Record<TimeUnit, [string, string]> = { day: ['day', 'days'], week: ['week', 'weeks'], month: ['month', 'months'] };
export const unitWord = (unit: TimeUnit, n = 1): string => UNIT_WORD[unit][n === 1 ? 0 : 1];

export const REPORT_COPY = {
  other: 'Other',
  notSet: 'Not set',
  yes: 'Yes',
  no: 'No',
  entries: 'Entries',
  noValue: 'no value',
  allTime: 'All time',
  allTimeInSentence: 'all time',
  range: (from: string, to: string) => (from === to ? from : `${from} to ${to}`),
  groupHeader: (unit: TimeUnit | undefined, fieldLabel: string | undefined) =>
    unit === 'week' ? 'Week starting' : unit === 'month' ? 'Month' : unit === 'day' ? 'Day' : fieldLabel ?? '',

  // Titles of suggested reports.
  countPer: (collection: string, unit: TimeUnit) => `${collection} per ${unitWord(unit)}`,
  totalPerMonth: (field: string) => `Total ${field} per month`,
  averageThisMonth: (field: string) => `Average ${field} this month`,
  thisWeek: (collection: string) => `${collection} this week`,
  byField: (collection: string, field: string) => `${collection} by ${field}`,
  yesOrNo: (field: string) => `${field}: yes or no`,
  countLabel: 'Number of entries',
  totalLabel: (field: string) => `Total ${field}`,
  averageLabel: (field: string) => `Average ${field}`,

  // Deterministic sentences.
  empty: (collection: string) => `There are no entries in ${collection} yet.`,
  noneInRange: (collection: string, range: string) => `There are no entries in ${collection} for ${range}.`,
  single: (metric: string, range: string, value: string) => `${metric} for ${range}: ${value}.`,
  byGroup: (metric: string, top: string, value: string, groups: number, range: string) =>
    `${metric} for ${range}: ${top} is highest with ${value}, out of ${groups} groups.`,
  perTime: (metric: string, range: string, top: string, value: string) =>
    `${metric} for ${range}: the highest is ${value}, in ${top}.`,
  notEnough: (unit: TimeUnit) => `Add entries on at least two different ${unitWord(unit, 2)} to see a trend.`,
  up: (pct: string, range: string) => `That is up ${pct} compared with ${range}.`,
  down: (pct: string, range: string) => `That is down ${pct} compared with ${range}.`,
  same: (range: string) => `That is the same as ${range}.`,
  fromNothing: (range: string) => `There was nothing for ${range}, so there is no percent change.`,
  trend: { up: 'The trend is going up.', down: 'The trend is going down.', flat: 'The trend is about level.' },
  skipped: (n: number) => (n === 1 ? '1 entry has no date, so it is left out.' : `${n} entries have no date, so they are left out.`),

  // Validation messages (reports are rejected, never guessed).
  unknownCollection: (id: string) => `This app has no list called "${id}".`,
  unknownField: (id: string) => `"${id}" is not a field in this list.`,
  needsNumber: (id: string) => `"${id}" is not a number field, so it cannot be added up or averaged.`,
  needsDate: (id: string) => `"${id}" is not a date field.`,
  needsGroupable: (id: string) => `"${id}" cannot be used to split entries. Use a choice or yes/no field.`,
  badFilter: (id: string) => `The filter on "${id}" does not match the kind of field it is.`,
  compareNeedsRange: 'A comparison needs a period such as the last 4 weeks.',
  viewNeedsGroup: (view: string) => `A ${view} chart needs the entries split into groups.`,
  lineNeedsTime: 'A line chart needs the entries split by day, week or month.',
  donutNeedsField: 'A donut chart needs the entries split by a choice or yes/no field.',
  noData: "This app's entries can't be read from here.",
  invalid: 'This report is not set up correctly.',
} as const;
