/** Every user-facing string of the Reports screens, in one place for the later i18n move. */
import type { ReportStatus, TimeUnit } from '@/core/reports';
import { t as gt } from '@/i18n/active';

export const COPY = {
  get button() { return gt('reports.button'); },
  get buttonHint() { return gt('reports.buttonHint'); },
  sheetTitle: (app: string) => gt('reports.sheetTitle', { app }),
  get sheetDescription() { return gt('reports.sheetDescription'); },
  get noCollections() { return gt('reports.noCollections'); },
  get noCollectionsTitle() { return gt('reports.noCollectionsTitle'); },
  get suggested() { return gt('reports.suggested'); },
  get makeYourOwn() { return gt('reports.makeYourOwn'); },
  get hideBuilder() { return gt('reports.hideBuilder'); },
  get list() { return gt('reports.list'); },
  get measure() { return gt('reports.measure'); },
  get splitBy() { return gt('reports.splitBy'); },
  get period() { return gt('reports.period'); },
  get datesFrom() { return gt('reports.datesFrom'); },
  get whenAdded() { return gt('reports.whenAdded'); },
  get count() { return gt('reports.count'); },
  total: (field: string) => gt('reports.total', { field }),
  average: (field: string) => gt('reports.average', { field }),
  get nothing() { return gt('reports.nothing'); },
  unit: { get day() { return gt('reports.unit.day'); }, get week() { return gt('reports.unit.week'); }, get month() { return gt('reports.unit.month'); } } satisfies Record<TimeUnit, string>,
  periods: { get last7() { return gt('reports.periods.last7'); }, get last4w() { return gt('reports.periods.last4w'); }, get last6m() { return gt('reports.periods.last6m'); }, get all() { return gt('reports.periods.all'); } },
  get showReport() { return gt('reports.showReport'); },
  get working() { return gt('reports.working'); },
  get overall() { return gt('reports.overall'); },
  entriesCounted: (n: string) => gt('reports.entriesCounted', { n }),
  get explain() { return gt('reports.explain'); },
  get explaining() { return gt('reports.explaining'); },
  get explanationTitle() { return gt('reports.explanationTitle'); },
  get explainedPlain() { return gt('reports.explainedPlain'); },
  get explainedDevice() { return gt('reports.explainedDevice'); },
  get explainedCloud() { return gt('reports.explainedCloud'); },
  get explainNote() { return gt('reports.explainNote'); },
  get askOnline() { return gt('reports.askOnline'); },
  get askOnlineNote() { return gt('reports.askOnlineNote'); },
  get share() { return gt('reports.share'); },
  get shared() { return gt('reports.shared'); },
  get copied() { return gt('reports.copied'); },
  get shareFailed() { return gt('reports.shareFailed'); },
  get failed() { return gt('reports.failed'); },
  // Chart view.
  get showTable() { return gt('reports.showTable'); },
  get showChart() { return gt('reports.showChart'); },
  tableLabel: (title: string) => gt('reports.tableLabel', { title }),
  chartLabel: (summary: string) => gt('reports.chartLabel', { summary }),
  get tapPoint() { return gt('reports.tapPoint'); },
  pointValue: (label: string, value: string) => gt('reports.pointValue', { label, value }),
  share_of: (pct: string) => gt('reports.share_of', { pct }),
  get empty() { return gt('reports.empty'); },
  get noMatch() { return gt('reports.noMatch'); },
  get nothingInPeriod() { return gt('reports.nothingInPeriod'); },
  get emptyHint() { return gt('reports.emptyHint'); },
  get notEnough() { return gt('reports.notEnough'); },
} as const;

/** Heading for a report with nothing to chart, by status. */
export const STATUS_TITLE = {
  // Getters, so the words follow the language at the moment a heading is drawn, not at the moment the file loaded.
  get empty() { return COPY.empty; }, get filtered_out() { return COPY.noMatch; }, get none_in_range() { return COPY.nothingInPeriod; }, get not_enough() { return COPY.notEnough; },
} as const satisfies Record<Exclude<ReportStatus, 'ok'>, string>;
