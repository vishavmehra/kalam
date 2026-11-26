import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createFakeAI, type FakeReply } from '../../../tests/fixtures/compiler/fake-ai';
import { TASK_POLICIES } from '../ai/routing';
import type { KalamRecord, RecordRepository, RecordValue } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import {
  aggregatesText, barFractions, buildReport, chartComponentSchema, chartToReport, createReportService, donutArcs, explainReport,
  lineGeometry, MAX_BUCKETS, MAX_GROUPS, niceMax, type ReportDefinition, type ReportResult, type ReportRow, reportToText, runReport,
  suggestReports, timeSplitFits, trendOf, validateChartComponent, validateReport,
} from './index';

const FIXTURES = new URL('../../../tests/fixtures/specs/valid/', import.meta.url);
const load = (name: string): KalamSpec => {
  const r = validateSpec(JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8')));
  if (!r.ok || !r.spec) throw new Error(`fixture ${name} is invalid`);
  return r.spec;
};
const expenses = load('expense-tracker');
const attendance = load('attendance-register');
const ledger = load('kirana-credit-book');
const notes = load('notes-app');

const UTC = 'UTC';
const at = (iso: string): Date => new Date(`${iso}T12:00:00Z`);
const rows = (list: Array<Record<string, RecordValue>>, createdAt?: (i: number) => number): ReportRow[] =>
  list.map((values, i) => ({ values, createdAt: createdAt?.(i) ?? i }));
const ok = (o: ReturnType<typeof runReport>): ReportResult => {
  if (!o.ok) throw new Error(o.errors.join('; '));
  return o.result;
};

const sumPerMonth = (last: number): ReportDefinition => ({
  id: 'spend_month', title: 'Spend per month', sourceCollection: 'expenses', dateField: 'date',
  range: { last, unit: 'month' }, groupBy: { kind: 'time', unit: 'month' },
  metrics: [{ operation: 'sum', field: 'amount', label: 'Total amount' }],
});

describe('suggested reports', () => {
  it('suggests counts over time, totals, averages and splits, and never uses text fields', () => {
    const list = suggestReports(expenses);
    expect(list.map((d) => d.title)).toEqual([
      'Expenses this week', 'Expenses per week', 'Total amount per month', 'Average amount this month', 'Expenses by category',
    ]);
    for (const d of list) {
      expect(validateReport(expenses, d)).toEqual([]);
      expect(JSON.stringify(d)).not.toContain('"note"');
    }
    expect(list.find((d) => d.groupBy?.kind === 'field')?.metrics.map((m) => m.operation)).toEqual(['count', 'sum']);
  });

  it('splits yes/no fields and skips number reports when there are no number fields', () => {
    expect(suggestReports(attendance).map((d) => d.title)).toContain('Present: yes or no');
    const titles = suggestReports(notes).map((d) => d.title);
    expect(titles.some((t) => /total|average/i.test(t))).toBe(false);
    expect(titles).toContain('Notes by tag');
  });

  it('builds a valid report from plain builder choices', () => {
    const def = buildReport(expenses, { collection: 'expenses', measure: { operation: 'sum', field: 'amount' }, split: { kind: 'field', field: 'category' }, period: { last: 4, unit: 'week' } });
    expect(def).toMatchObject({ title: 'Total amount by category', dateField: 'date', compare: true });
    expect(validateReport(expenses, def)).toEqual([]);
  });
});

describe('bucketing with an injected now', () => {
  it('splits months at the month boundary and keeps empty months as zero', () => {
    const r = ok(runReport(expenses, sumPerMonth(3), rows([
      { amount: 10, category: 'Food', date: '2026-09-30' },
      { amount: 20, category: 'Food', date: '2026-10-31' },
      { amount: 5, category: 'Food', date: '2026-11-01' },
      { amount: 7, category: 'Food', date: '2026-11-02' },
      { amount: 99, category: 'Food', date: '2026-08-31' }, // before the range
    ]), { now: at('2026-11-02'), timeZone: UTC, lang: 'en' }));
    expect(r.points.map((p) => [p.key, p.values[0]])).toEqual([['2026-09-01', 10], ['2026-10-01', 20], ['2026-11-01', 12]]);
    expect(r.range).toMatchObject({ from: '2026-09-01', to: '2026-11-02', label: 'Sep 1, 2026 to Nov 2, 2026' });
    expect(r.totals[0]).toBe(42);
    expect(r.view).toBe('line');
  });

  it('starts weeks on Monday', () => {
    const def: ReportDefinition = {
      id: 'per_week', title: 'Per week', sourceCollection: 'expenses', dateField: 'date', range: { last: 3, unit: 'week' },
      groupBy: { kind: 'time', unit: 'week' }, metrics: [{ operation: 'count', label: 'Entries' }],
    };
    const r = ok(runReport(expenses, def, rows([
      { amount: 1, date: '2026-11-01' }, // Sunday: week of 26 Oct
      { amount: 1, date: '2026-11-02' }, // Monday
      { amount: 1, date: '2026-11-15' }, // Sunday
      { amount: 1, date: '2026-11-16' }, // Monday
      { amount: 1, date: '2026-11-18' },
    ]), { now: at('2026-11-18'), timeZone: UTC, lang: 'en' }));
    // Sunday 15 Nov closes the week of 9 Nov; Sunday 1 Nov belongs to the week of 26 Oct, before the range.
    expect(r.points.map((p) => [p.key, p.values[0]])).toEqual([['2026-11-02', 1], ['2026-11-09', 1], ['2026-11-16', 2]]);
    expect(r.entries).toBe(4);
    expect(r.groupLabel).toBe('Week starting');
  });

  it('uses the given time zone for the time an entry was added and for today', () => {
    const def: ReportDefinition = {
      id: 'added', title: 'Added', sourceCollection: 'expenses', range: { last: 2, unit: 'month' },
      groupBy: { kind: 'time', unit: 'month' }, metrics: [{ operation: 'count', label: 'Entries' }],
    };
    const lateNov = Date.UTC(2026, 10, 30, 20, 0); // 1 Dec 01:30 in India
    const data = rows([{ amount: 1 }, { amount: 2 }], (i) => (i === 0 ? lateNov : Date.UTC(2026, 10, 10)));
    const now = new Date(Date.UTC(2026, 10, 30, 21, 0));
    const utc = ok(runReport(expenses, def, data, { now, timeZone: UTC }));
    const india = ok(runReport(expenses, def, data, { now, timeZone: 'Asia/Kolkata' }));
    expect(utc.points.map((p) => [p.key, p.values[0]])).toEqual([['2026-10-01', 0], ['2026-11-01', 2]]);
    expect(india.points.map((p) => [p.key, p.values[0]])).toEqual([['2026-11-01', 1], ['2026-12-01', 1]]);
  });

  it('leaves out entries without a date and says so', () => {
    const r = ok(runReport(expenses, sumPerMonth(1), rows([{ amount: 5, date: '2026-11-03' }, { amount: 9 }, { amount: 9, date: 'soon' }]), { now: at('2026-11-18'), timeZone: UTC }));
    expect(r.totals[0]).toBe(5);
    expect(r.skipped).toBe(2);
    expect(r.details).toContain('2 entries have no date, so they are left out.');
  });
});

describe('empty and thin data', () => {
  const opts = { now: at('2026-11-18'), timeZone: UTC, lang: 'en' };
  it('has a clear state for an empty collection', () => {
    const r = ok(runReport(expenses, sumPerMonth(6), [], opts));
    expect(r).toMatchObject({ status: 'empty', view: 'number', points: expect.any(Array) });
    expect(r.summary).toBe('There are no entries in Expenses yet.');
  });

  it('says when nothing falls in the period', () => {
    const r = ok(runReport(expenses, sumPerMonth(1), rows([{ amount: 5, date: '2025-01-01' }]), opts));
    expect(r.status).toBe('none_in_range');
    expect(r.summary).toBe('There are no entries in Expenses for Nov 1, 2026 to Nov 18, 2026.');
  });

  it('asks for more data before drawing a trend', () => {
    const r = ok(runReport(expenses, sumPerMonth(6), rows([{ amount: 5, date: '2026-11-03' }]), opts));
    expect(r.status).toBe('not_enough');
    expect(r.view).toBe('number');
    expect(r.details).toContain('Add entries on at least two different months to see a trend.');
  });
});

describe('numbers', () => {
  const opts = { now: at('2026-11-18'), timeZone: UTC, lang: 'en' };
  it('ignores values that are not numbers when adding up and averaging', () => {
    const def: ReportDefinition = {
      id: 'mix', title: 'Mix', sourceCollection: 'expenses', range: 'all',
      metrics: [{ operation: 'count', label: 'Entries' }, { operation: 'sum', field: 'amount', label: 'Total' }, { operation: 'average', field: 'amount', label: 'Average' }],
    };
    const r = ok(runReport(expenses, def, rows([{ amount: 10 }, { amount: '20' }, { amount: 'abc' }, { amount: '' }, { amount: null }, { amount: true }]), opts));
    expect(r.totals).toEqual([6, 30, 15]);
    const none = ok(runReport(expenses, def, rows([{ amount: 'abc' }]), opts));
    expect(none.totals).toEqual([1, 0, null]);
  });

  it('groups by option order and counts unknown values under the app\'s own "Other"', () => {
    const def: ReportDefinition = {
      id: 'by_cat', title: 'By category', sourceCollection: 'expenses', range: 'all', groupBy: { kind: 'field', field: 'category' },
      metrics: [{ operation: 'sum', field: 'amount', label: 'Total amount' }],
    };
    const r = ok(runReport(expenses, def, rows([
      { amount: 100, category: 'Food' }, { amount: 50, category: 'Travel' }, { amount: 7, category: 'SENTINEL-typed-category' }, { amount: 3 },
    ]), opts));
    expect(r.points.map((p) => [p.label, p.values[0]])).toEqual([['Food', 100], ['Travel', 50], ['Bills', 0], ['Shopping', 0], ['Other', 7], ['Not set', 3]]);
    expect(r.summary).toBe('Total amount for all time: Food is highest with 100, out of 4 groups.');
    expect(r.view).toBe('bar');
  });

  it('applies filters with the right types', () => {
    const def: ReportDefinition = {
      id: 'credit', title: 'Credit given', sourceCollection: 'ledger', range: 'all',
      filters: [{ field: 'kind', operator: 'equals', value: 'Credit' }, { field: 'amount', operator: 'greater_than', value: 10 }],
      metrics: [{ operation: 'sum', field: 'amount', label: 'Total' }],
    };
    const r = ok(runReport(ledger, def, rows([{ kind: 'Credit', amount: 100 }, { kind: 'Credit', amount: 5 }, { kind: 'Payment', amount: 70 }]), opts));
    expect(r.totals).toEqual([100]);
  });

  it('compares with the same stretch of the previous period', () => {
    const def: ReportDefinition = {
      id: 'month', title: 'This month', sourceCollection: 'expenses', dateField: 'date', range: { last: 1, unit: 'month' }, compare: true,
      metrics: [{ operation: 'sum', field: 'amount', label: 'Total amount' }],
    };
    const r = ok(runReport(expenses, def, rows([
      { amount: 150, date: '2026-11-10' }, { amount: 100, date: '2026-10-05' }, { amount: 900, date: '2026-10-25' }, // after 18 Oct: not the same stretch
    ]), opts));
    expect(r.comparison).toMatchObject({ current: 150, previous: 100, percent: 50, direction: 'up', range: 'Oct 1, 2026 to Oct 18, 2026' });
    expect(r.details[0]).toBe('That is up 50% compared with Oct 1, 2026 to Oct 18, 2026.');
  });

  it('gives no percent when the previous period is zero', () => {
    const def: ReportDefinition = {
      id: 'week', title: 'This week', sourceCollection: 'expenses', dateField: 'date', range: { last: 1, unit: 'week' }, compare: true,
      metrics: [{ operation: 'count', label: 'Entries' }],
    };
    const r = ok(runReport(expenses, def, rows([{ amount: 1, date: '2026-11-17' }]), opts));
    expect(r.comparison).toMatchObject({ previous: 0, percent: null, direction: 'new' });
    expect(r.details[0]).toBe('There was nothing for Nov 9, 2026 to Nov 11, 2026, so there is no percent change.');
    expect(ok(runReport(expenses, def, rows([{ amount: 1, date: '2026-01-01' }]), opts)).comparison).toMatchObject({ current: 0, previous: 0, direction: 'same' });
  });

  it('finds the trend direction', () => {
    expect(trendOf([1, 2, 3, 4])).toBe('up');
    expect(trendOf([9, 7, 4, 1])).toBe('down');
    expect(trendOf([5, 5, 5.1, 5])).toBe('flat');
    expect(trendOf([1, null, 2])).toBeUndefined();
    expect(trendOf([0, 0, 0])).toBe('flat');
  });
});

describe('validation', () => {
  const base: ReportDefinition = { id: 'r', title: 'R', sourceCollection: 'expenses', range: 'all', metrics: [{ operation: 'count', label: 'Entries' }] };
  it('rejects invalid field references and wrong field kinds', () => {
    expect(validateReport(expenses, { ...base, sourceCollection: 'orders' })).toEqual(['This app has no list called "orders".']);
    expect(validateReport(expenses, { ...base, metrics: [{ operation: 'sum', field: 'note', label: 'x' }] })[0]).toContain('not a number field');
    expect(validateReport(expenses, { ...base, metrics: [{ operation: 'sum', field: 'price', label: 'x' }] })[0]).toContain('"price" is not a field');
    expect(validateReport(expenses, { ...base, groupBy: { kind: 'field', field: 'note' } })[0]).toContain('cannot be used to split');
    expect(validateReport(expenses, { ...base, dateField: 'amount' })[0]).toContain('not a date field');
    expect(validateReport(expenses, { ...base, filters: [{ field: 'category', operator: 'equals', value: 'Rent' }] })[0]).toContain('filter on "category"');
    expect(validateReport(expenses, { ...base, compare: true })).toContain('A comparison needs a period such as the last 4 weeks.');
    expect(validateReport(expenses, { ...base, view: 'line' })).toHaveLength(1);
  });

  it('rejects a malformed definition through the schema', () => {
    const bad = { ...base, metrics: [{ operation: 'count', field: 'amount', label: 'x' }] };
    const out = runReport(expenses, bad as ReportDefinition, [], { now: at('2026-11-18') });
    expect(out.ok).toBe(false);
    expect(runReport(expenses, { ...base, extra: 1 } as unknown as ReportDefinition, [], { now: at('2026-11-18') }).ok).toBe(false);
  });
});

describe('chart component (proposed v1.1)', () => {
  const chart = { id: 'spend_chart', type: 'chart', label: 'Spend by category', chart: 'bar', source: 'expenses', metric: 'sum', valueField: 'amount', groupBy: 'category' } as const;
  it('accepts a valid chart and rejects ambiguous ones', () => {
    expect(chartComponentSchema.safeParse(chart).success).toBe(true);
    expect(chartComponentSchema.safeParse({ ...chart, period: 'week' }).success).toBe(false);
    expect(chartComponentSchema.safeParse({ ...chart, metric: 'count' }).success).toBe(false);
    expect(chartComponentSchema.safeParse({ ...chart, onPress: 'x' }).success).toBe(false);
    // Fits the component union of schema.ts.
    const union = z.discriminatedUnion('type', [z.object({ id: z.string(), type: z.literal('text'), label: z.string() }).strict(), chartComponentSchema]);
    expect(union.safeParse(chart).success).toBe(true);
  });

  it('renders through the report engine and checks references', () => {
    const r = ok(runReport(expenses, chartToReport(chartComponentSchema.parse(chart)), rows([{ amount: 4, category: 'Bills' }]), { now: at('2026-11-18') }));
    expect(r.view).toBe('bar');
    expect(validateChartComponent(expenses, { ...chart, groupBy: 'colour' })).toEqual(['"colour" is not a field in this list.']);
  });
});

describe('geometry', () => {
  it('builds round scales, bars, lines and donut slices', () => {
    expect([niceMax(0), niceMax(7), niceMax(23), niceMax(180)]).toEqual([1, 10, 25, 200]);
    expect(barFractions([5, 10, null, -2])).toEqual([0.5, 1, 0, 0]);
    const line = lineGeometry([0, 10, null, 5], { width: 100, height: 60, padX: 10, padTop: 5, padBottom: 5 });
    expect(line.points.map((p) => p.index)).toEqual([0, 1, 3]);
    expect(line.path.match(/M/g)).toHaveLength(2); // the gap starts a new segment
    const arcs = donutArcs([3, 0, 1], 100, 20);
    expect(arcs.map((a) => [a.index, a.fraction])).toEqual([[0, 0.75], [2, 0.25]]);
    expect(donutArcs([5], 100, 20)[0]?.path).toContain('A50,50 0 1 1');
  });
});

// ─── Explanations ────────────────────────────────────────────────────────────

const SENTINELS = ['SENTINEL-note-biryani', 'SENTINEL-customer-ramesh', 'SENTINEL-typed-category', 'SENTINEL-ledger-note'];
const NOW = new Date(Date.UTC(2026, 10, 18, 12));
const DAY = 86_400_000;

function repo() {
  const reads: string[] = [];
  const data: Record<string, Array<Record<string, RecordValue>>> = {
    expenses: Array.from({ length: 40 }, (_, i) => ({
      amount: 50 + ((i * 37) % 200), category: i % 7 === 0 ? SENTINELS[2]! : ['Food', 'Travel', 'Bills'][i % 3]!,
      date: new Date(NOW.getTime() - i * 4 * DAY).toISOString().slice(0, 10), note: `${SENTINELS[0]} ${i}`,
    })),
    ledger: Array.from({ length: 12 }, (_, i) => ({
      customer: SENTINELS[1]!, amount: 100 + i, kind: i % 2 ? 'Credit' : 'Payment',
      date: new Date(NOW.getTime() - i * 9 * DAY).toISOString().slice(0, 10), note: SENTINELS[3]!,
    })),
  };
  const records: Pick<RecordRepository, 'list'> = {
    async list(appId, collectionId): Promise<KalamRecord[]> {
      reads.push(collectionId);
      return (data[collectionId] ?? []).map((values, i) => ({ id: `r${i}`, appId, collectionId, createdAt: NOW.getTime() - i * DAY, updatedAt: 0, values }));
    },
  };
  return { records, reads };
}

const say = (explanation: unknown): FakeReply => ({ raw: { explanation } });

describe('explanations', () => {
  it('reads only the report\'s own collection, and never for a bad definition', async () => {
    const { records, reads } = repo();
    const service = createReportService({ ai: createFakeAI(), records, now: () => NOW, timeZone: UTC });
    expect((await service.run(expenses, { ...sumPerMonth(2), sourceCollection: 'orders' })).ok).toBe(false);
    expect(reads).toEqual([]);
    expect((await service.run(expenses, sumPerMonth(2))).ok).toBe(true);
    expect(reads).toEqual(['expenses']);
  });

  it('falls back to the plain sentence offline, with no model call and a deterministic event', async () => {
    const { records } = repo();
    const ai = createFakeAI({ online: false, onDevice: 'unavailable', respond: () => say('Should not run') });
    const service = createReportService({ ai, records, now: () => NOW, timeZone: UTC });
    const out = await service.run(expenses, sumPerMonth(6));
    if (!out.ok) throw new Error('report failed');
    const e = await service.explain(out.result, { appId: 'app_1' });
    expect(e).toMatchObject({ source: 'deterministic', plain: true });
    expect(e.text).toBe([out.result.summary, ...out.result.details].join(' '));
    expect(ai.calls).toHaveLength(0);
    expect(ai.events).toEqual([expect.objectContaining({ taskType: 'summarize', route: 'deterministic', escalationReason: 'reports: offline, plain sentence' })]);
  });

  it('asks Gemini Nano first, in the mode the orchestrator gives one cloud fallback', async () => {
    expect(TASK_POLICIES.summarize).toMatchObject({ onDevice: true, cloudFallback: true });
    const { records } = repo();
    const ai = createFakeAI({ onDevice: 'available', respond: () => say('Spending rose over the last few months.') });
    const service = createReportService({ ai, records, now: () => NOW, timeZone: UTC });
    const out = await service.run(expenses, sumPerMonth(6));
    if (!out.ok) throw new Error('report failed');
    const e = await service.explain(out.result);
    expect(e).toMatchObject({ source: 'on_device', plain: false, text: 'Spending rose over the last few months.' });
    expect(ai.calls[0]?.req).toMatchObject({ taskType: 'summarize', mode: 'prefer_on_device' });
    expect((await service.explain(out.result, { onDeviceOnly: true })).source).toBe('on_device');
    expect(ai.calls[1]?.req.mode).toBe('only_on_device');
  });

  it('rejects bad model output with Zod and keeps the computed sentence', async () => {
    const { records } = repo();
    const service = (reply: FakeReply) => createReportService({ ai: createFakeAI({ onDevice: 'available', respond: () => reply }), records, now: () => NOW, timeZone: UTC });
    const out = await service(say('x')).run(expenses, sumPerMonth(6));
    if (!out.ok) throw new Error('report failed');
    for (const reply of [say(42), say(''), say('a'.repeat(400)), { raw: { text: 'wrong key' } }, { raw: 'just text' }, say('You spent 123456 this month.')]) {
      const e = await service(reply).explain(out.result);
      expect(e).toMatchObject({ source: 'deterministic', plain: true });
      expect(e.text).toBe([out.result.summary, ...out.result.details].join(' '));
    }
    // A number that is in the report is fine.
    const total = String(out.result.totals[0]);
    expect((await service(say(`The total is ${total}.`)).explain(out.result)).plain).toBe(false);
  });

  it('never puts a raw record value into a model prompt', async () => {
    const { records } = repo();
    const ai = createFakeAI({ onDevice: 'available', respond: () => say('It went up.') });
    const service = createReportService({ ai, records, now: () => NOW, timeZone: UTC });
    for (const spec of [expenses, ledger]) {
      for (const def of suggestReports(spec)) {
        const out = await service.run(spec, def);
        if (!out.ok) throw new Error(out.errors.join('; '));
        await service.explain(out.result);
        expect(reportToText(out.result)).not.toMatch(/SENTINEL/);
      }
    }
    expect(ai.calls.length).toBeGreaterThan(5);
    for (const call of ai.calls) {
      const sent = `${call.req.system ?? ''}\n${call.req.prompt}`;
      for (const s of SENTINELS) expect(sent).not.toContain(s);
      expect(sent).not.toContain('ramesh');
    }
  });

  it('explains empty reports without a model', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: () => say('x') });
    const r = ok(runReport(expenses, sumPerMonth(3), [], { now: NOW, timeZone: UTC }));
    expect((await explainReport(ai, r)).text).toBe('There are no entries in Expenses yet.');
    expect(ai.calls).toHaveLength(0);
    expect(ai.events[0]?.escalationReason).toBe('reports: nothing to explain, plain sentence');
  });
});

// ─── Review fixes ────────────────────────────────────────────────────────────

const daysBack = (n: number, end = '2026-11-18'): string => new Date(Date.parse(`${end}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
const countBy = (range: ReportDefinition['range'], unit: 'day' | 'week' | 'month'): ReportDefinition => ({
  id: 'count', title: 'Count', sourceCollection: 'expenses', dateField: 'date', range, groupBy: { kind: 'time', unit }, metrics: [{ operation: 'count', label: 'Entries' }],
});
const opts18 = { now: at('2026-11-18'), timeZone: UTC, lang: 'en' };

describe('ranges and buckets', () => {
  it('moves the range start when old buckets are left out, so totals match the chart', () => {
    const data = rows(Array.from({ length: 171 }, (_, i) => ({ amount: 1, date: daysBack(i) }))); // 1 Jun to 18 Nov
    const r = ok(runReport(expenses, countBy({ last: 6, unit: 'month' }, 'day'), data, opts18));
    expect(r.points).toHaveLength(MAX_BUCKETS);
    expect(r.range).toMatchObject({ from: '2026-09-20', to: '2026-11-18', label: 'Sep 20, 2026 to Nov 18, 2026' });
    expect(r.totals[0]).toBe(60);
    expect(r.entries).toBe(r.points.reduce((s, p) => s + p.entries, 0));
    expect(r.trimmed).toBe(true);
    expect(r.details).toContain('Only the last 60 days fit in one chart, so earlier entries are left out.');
  });

  it('rejects a split longer than the period, and the builder never offers one', () => {
    expect(validateReport(expenses, countBy({ last: 7, unit: 'day' }, 'month'))).toEqual(['A report over the last few days cannot be split by month. Split it by day.']);
    expect(validateReport(expenses, countBy({ last: 6, unit: 'month' }, 'week'))).toEqual([]);
    expect((['day', 'week', 'month'] as const).filter((u) => timeSplitFits({ last: 4, unit: 'week' }, u))).toEqual(['day', 'week']);
    expect(timeSplitFits('all', 'month')).toBe(true);
  });

  it('leaves out entries dated after today instead of stretching the range to them', () => {
    const data = rows([{ amount: 1, date: '2026-10-05' }, { amount: 1, date: '2026-11-03' }, { amount: 1, date: '2062-01-01' }]);
    const r = ok(runReport(expenses, countBy('all', 'month'), data, opts18));
    expect(r).toMatchObject({ status: 'ok', entries: 2, future: 1 });
    expect(r.range).toMatchObject({ from: '2026-10-01', to: '2026-11-18' });
    expect(r.points.map((p) => [p.key, p.values[0]])).toEqual([['2026-10-01', 1], ['2026-11-01', 1]]);
    expect(r.details).toContain('1 entry is dated after today, so it is left out.');
  });

  it('stays fast with far-away dates', () => {
    const started = Date.now();
    const data = rows([{ amount: 1, date: '1900-01-01' }, { amount: 1, date: '2026-11-18' }, { amount: 1, date: '9999-12-31' }]);
    const r = ok(runReport(expenses, countBy('all', 'day'), data, opts18));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r).toMatchObject({ future: 1, trimmed: true });
    expect(r.points).toHaveLength(MAX_BUCKETS);
    expect(r.range.from).toBe('2026-09-20');
  });

  it('leaves the period still running out of the trend', () => {
    const month = (m: string, n: number, amount = 10) => Array.from({ length: n }, () => ({ amount, date: `2026-${m}-10` }));
    const steady = rows([...['06', '07', '08', '09', '10'].flatMap((m) => month(m, 10)), { amount: 10, date: '2026-11-02' }]);
    const r = ok(runReport(expenses, sumPerMonth(6), steady, opts18));
    expect(r.points.map((p) => p.values[0])).toEqual([100, 100, 100, 100, 100, 10]);
    expect(r.trend).toBe('flat');
    expect(r.details).toEqual(expect.arrayContaining(['The trend is about level.', 'This month is not over yet, so the trend leaves it out.']));
    expect(aggregatesText(r)).toContain('Trend over finished months: flat');
    const rising = rows(['06', '07', '08', '09', '10'].flatMap((m, i) => month(m, i + 1)));
    expect(ok(runReport(expenses, sumPerMonth(6), rising, opts18)).trend).toBe('up');
  });

  it('names where the dates come from', () => {
    const r = ok(runReport(expenses, sumPerMonth(2), rows([{ amount: 1, date: '2026-11-01' }]), opts18));
    expect(r.details).toContain('Dates come from the Date field.');
    const added = ok(runReport(expenses, { ...sumPerMonth(2), dateField: undefined }, rows([{ amount: 1 }], () => Date.UTC(2026, 10, 2)), opts18));
    expect(added.details).toContain('Dates are when each entry was added.');
  });
});

describe('groups', () => {
  const tags: ReportDefinition = { id: 'tags', title: 'Tags', sourceCollection: 'notes', range: 'all', groupBy: { kind: 'field', field: 'tag' }, metrics: [{ operation: 'count', label: 'Entries' }] };

  it('counts a value outside the options under Other when the app has no Other option', () => {
    const r = ok(runReport(notes, tags, rows([{ tag: 'Work' }, { tag: 'SENTINEL-typed-category' }, { tag: '' }]), opts18));
    expect(r.points.map((p) => [p.key, p.label, p.values[0]])).toEqual([
      ['opt:Personal', 'Personal', 0], ['opt:Work', 'Work', 1], ['opt:Ideas', 'Ideas', 0], ['~other', 'Other', 1], ['~unset', 'Not set', 1],
    ]);
  });

  it('folds the smallest groups into Other past MAX_GROUPS', () => {
    const options = Array.from({ length: 14 }, (_, i) => `o${i + 1}`);
    const col = notes.collections.notes!;
    const wide = { ...notes, collections: { notes: { ...col, fields: { ...col.fields, tag: { type: 'enum', label: 'Tag', options } } } } } as KalamSpec;
    const data = rows(options.flatMap((o, i) => Array.from({ length: 14 - i }, () => ({ tag: o }))));
    const r = ok(runReport(wide, tags, data, opts18));
    expect(r.points).toHaveLength(MAX_GROUPS);
    expect(r.points[0]).toMatchObject({ label: 'o1', values: [14] });
    expect(r.points.at(-1)).toMatchObject({ key: '~other', values: [3 + 2 + 1] });
  });

  it('splits by yes or no and shows it as parts of a whole', () => {
    const def: ReportDefinition = { id: 'present', title: 'Present', sourceCollection: 'attendance', range: 'all', groupBy: { kind: 'field', field: 'present' }, metrics: [{ operation: 'count', label: 'Entries' }] };
    const r = ok(runReport(attendance, def, rows([{ present: true }, { present: 'false' }, { present: false }, {}]), opts18));
    expect(r.points.map((p) => [p.label, p.values[0]])).toEqual([['Yes', 1], ['No', 2], ['Not set', 1]]);
    expect(r.view).toBe('donut');
  });

  it('says when the filter matches nothing, not that the list is empty', () => {
    const def: ReportDefinition = {
      id: 'credit', title: 'Credit', sourceCollection: 'ledger', range: 'all',
      filters: [{ field: 'kind', operator: 'equals', value: 'Credit' }], metrics: [{ operation: 'count', label: 'Entries' }],
    };
    const r = ok(runReport(ledger, def, rows([{ kind: 'Payment', amount: 5 }]), opts18));
    expect(r.status).toBe('filtered_out');
    expect(r.summary).toBe('No entries in Entries match this report\'s filter.');
  });
});

describe('labels, ids and errors', () => {
  it('keeps every suggestion runnable and unique with long ids and labels', () => {
    const cid = 'a_very_long_collection_identifier_for_expenses';
    const col = expenses.collections.expenses!;
    const label = 'Amount paid to the supplier including every tax, fee and delivery charge we agreed on with them';
    const long = { ...expenses, collections: { [cid]: { ...col, fields: { ...col.fields, amount: { ...col.fields.amount!, label } } } } } as KalamSpec;
    const list = suggestReports(long);
    expect(list).toHaveLength(5);
    expect(new Set(list.map((d) => d.id)).size).toBe(list.length);
    for (const d of list) ok(runReport(long, d, [], opts18));
    const built = buildReport(long, { collection: cid, measure: { operation: 'sum', field: 'amount' }, split: { kind: 'field', field: 'category' }, period: 'all' });
    ok(runReport(long, built, [], opts18));
  });

  it('renders any chart that validates, and turns schema problems into plain sentences', () => {
    const chart = { id: 'c', type: 'chart', label: 'L'.repeat(80), chart: 'bar', source: 'expenses', metric: 'count', groupBy: 'category' } as const;
    expect(validateChartComponent(expenses, chart)).toEqual([]);
    expect(runReport(expenses, chartToReport(chart), [], opts18).ok).toBe(true);
    expect(validateChartComponent(expenses, { ...chart, groupBy: undefined, period: 'month', range: { last: 7, unit: 'day' } })[0]).toContain('cannot be split by month');
    const base: ReportDefinition = { id: 'r', title: 'R', sourceCollection: 'expenses', range: 'all', metrics: [{ operation: 'count', label: 'Entries' }] };
    expect(runReport(expenses, { ...base, metrics: [] }, [], opts18)).toEqual({ ok: false, errors: ['This report is not set up correctly.'] });
    expect(runReport(expenses, { ...base, metrics: [{ operation: 'count', field: 'amount', label: 'x' }] }, [], opts18))
      .toEqual({ ok: false, errors: ['Count takes no field. Sum and average need a number field.'] });
  });

  it('builds with the date field the person picked, or when entries were added', () => {
    const choice = { collection: 'expenses', measure: { operation: 'count' as const }, split: { kind: 'none' as const }, period: { last: 4, unit: 'week' as const } };
    expect(buildReport(expenses, choice).dateField).toBe('date');
    expect(buildReport(expenses, { ...choice, dateField: null }).dateField).toBeUndefined();
  });
});

describe('cloud consent for explanations', () => {
  it('stays on this device until asked, then offers Gemini online only when it can be reached', async () => {
    const r = ok(runReport(expenses, sumPerMonth(6), rows([{ amount: 5, date: '2026-10-03' }, { amount: 9, date: '2026-11-03' }]), opts18));
    const online = createFakeAI({ onDevice: 'unavailable', respond: () => say('Should not run') });
    expect(await explainReport(online, r, { onDeviceOnly: true })).toMatchObject({ plain: true, cloudOffer: true });
    expect(online.calls).toHaveLength(0);
    const offline = createFakeAI({ online: false, onDevice: 'unavailable' });
    expect((await explainReport(offline, r, { onDeviceOnly: true })).cloudOffer).toBeUndefined();
    const asked = createFakeAI({ onDevice: 'unavailable', respond: () => say('Spending went up.') });
    expect(await explainReport(asked, r)).toMatchObject({ source: 'cloud', plain: false });
  });
});
