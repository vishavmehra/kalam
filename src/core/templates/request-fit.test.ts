/**
 * Templates follow what the person asked (eval 2026-11-25): t01 a bill splitter is not a+b, ma05 a typed
 * "Call it Daily Walk" and the spoken habits are kept, counters never read "Counts count", habit apps
 * show streaks and this week, and "this month" leaves out last year.
 */
import { describe, expect, it } from 'vitest';
import { createFakeAI } from '../../../tests/fixtures/compiler/fake-ai';
import type { FormulaContext } from '../contracts';
import { evaluateFormula } from '../formula';
import { createApplicationPipeline } from '../pipeline/create-application';
import type { KalamComponent, KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { instantiateTemplate, matchTemplates } from './index';

const opts = { appId: 'app_fit00001', now: 1, lang: 'en' };
const build = (id: Parameters<typeof instantiateTemplate>[0], text: string): KalamSpec => {
  const r = instantiateTemplate(id, text, opts);
  if (!r.ok) throw new Error(r.error);
  const v = validateSpec(r.value.spec);
  expect(v.errors).toEqual([]);
  return v.spec!;
};
const stat = (spec: KalamSpec, id: string) =>
  spec.screens.flatMap((s) => s.children).find((c): c is Extract<KalamComponent, { type: 'stat' }> => c.type === 'stat' && c.id === id)!;
const now = new Date(2026, 10, 25, 10, 0);
const run = (expr: string, ctx: Partial<FormulaContext>) => {
  const r = evaluateFormula(expr, { collections: {}, form: {}, state: {}, now, ...ctx });
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('t01: a bill splitter', () => {
  const request = 'Make a calculator for splitting a restaurant bill between friends';
  it('is the calculator template in bill-split mode, with each person\'s share', () => {
    expect(matchTemplates(request)[0]?.templateId).toBe('calculator');
    const spec = build('calculator', request);
    expect(spec.name).toBe('Bill Splitter');
    const per = stat(spec, 'per_person');
    expect(run(per.expr, { form: { bill: 1200, people: 4, tip: 10 } })).toBe(330);
    expect(run(per.expr, { form: { bill: 1200, people: 0, tip: 0 } })).toBe('Enter the number of people');
    expect(per).toMatchObject({ format: 'currency', currency: 'INR' });
    expect(JSON.stringify(spec)).not.toContain('form.a');
  });
  it('a plain calculator request still gets a+b', () => {
    expect(build('calculator', 'calculator with addition and subtraction').screens[0].children.map((c) => c.id)).toContain('add_result');
  });
});

describe('ma05: typed and spoken instructions together', () => {
  it('keeps the typed app name and the spoken habits as said', async () => {
    const res = await createApplicationPipeline({ ai: createFakeAI() })({
      text: 'Call it Daily Walk', audioTranscript: 'a habit tracker for walking and drinking water every day',
      modalities: ['text', 'audio'], images: [],
    });
    expect(res.route).toBe('template');
    expect(res.spec?.name).toBe('Daily Walk');
    expect(res.spec?.collections.logs.fields.habit).toMatchObject({ options: ['Walking', 'Drinking water'] });
    expect(res.spec?.description).not.toMatch(/every day every day/);
  });
});

describe('counters say what they count', () => {
  it('t02: "how many people come in" counts people', () => {
    const spec = build('counter', 'A counter to tally how many people come into my shop today');
    expect(spec.screens[0].children[0]).toMatchObject({ type: 'counter', label: 'People' });
    expect(spec.description).toBe('Counts people with one tap.');
  });
  it('with nothing named, never "Counts count"', () => {
    const spec = build('counter', 'a simple counter');
    expect(spec.description).not.toMatch(/count count/i);
    expect(spec.screens[0].children[0]).toMatchObject({ a11yLabel: 'Counter' });
  });
});

describe('periods in templates', () => {
  it('habit tracker: a streak and this week per habit', () => {
    const spec = build('habit_tracker', 'habit tracker for walking and reading');
    const logs = [
      { habit: 'Walking', date: '2026-11-25', done: true }, { habit: 'Walking', date: '2026-11-24', done: true },
      { habit: 'Walking', date: '2026-11-20', done: true }, { habit: 'Reading', date: '2026-11-24', done: true },
    ];
    expect(run(stat(spec, 'habit_streak_1').expr, { collections: { logs } })).toBe(2);
    expect(run(stat(spec, 'habit_week_1').expr, { collections: { logs } })).toBe(2);
    expect(run(stat(spec, 'habit_streak_2').expr, { collections: { logs } })).toBe(1);
  });
  it('expense tracker: "this month" leaves out the same month last year (t17, t20)', () => {
    const spec = build('expense_tracker', 'track my expenses');
    const month = spec.screens.flatMap((s) => s.children).find((c) => c.type === 'stat' && /month\(/.test(c.expr)) as { expr: string };
    const expenses = [{ amount: 100, date: '2026-11-02' }, { amount: 50, date: '2025-11-02' }];
    expect(run(month.expr, { collections: { expenses } })).toBe(100);
  });
  it('money defaults to rupees, never dollars nobody asked for', () => {
    for (const id of ['calculator', 'expense_tracker', 'inventory'] as const) {
      expect(JSON.stringify(build(id, id === 'calculator' ? 'gst calculator' : `my ${id.replace('_', ' ')}`))).not.toContain('USD');
    }
  });
});
