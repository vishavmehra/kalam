/**
 * Period helpers and the opened entry (eval 2026-11-25: s24 "this week" counted every workout, s21 lost its
 * streak, t17/t20 monthly totals were said to ignore the year, s07/s23 balances covered the whole shop).
 */
import { describe, expect, it } from 'vitest';
import type { FormulaContext, FormulaScope } from '../contracts';
import { evaluateFormula, formulaDependencies, validateFormula } from './index';

const now = new Date(2026, 10, 25, 9, 0); // local Wednesday 2026-11-25
const ctx = (over: Partial<FormulaContext> = {}): FormulaContext => ({
  collections: {
    workouts: [
      { exercise: 'Squat', workout_date: '2026-11-23' }, // Monday this week
      { exercise: 'Run', workout_date: '2026-11-25' },
      { exercise: 'Row', workout_date: '2026-11-22' }, // Sunday last week
      { exercise: 'Swim', workout_date: '2025-11-25' }, // same week day last year
    ],
    logs: [
      { habit: 'Walk', date: '2026-11-25', done: true },
      { habit: 'Walk', date: '2026-11-24', done: true },
      { habit: 'Walk', date: '2026-11-23', done: true },
      { habit: 'Walk', date: '2026-11-21', done: true },
      { habit: 'Water', date: '2026-11-24', done: true },
      { habit: 'Water', date: '2026-11-23', done: true },
      { habit: 'Water', date: '2026-11-22', done: false },
    ],
    attendance: [
      { status: 'Present', shift_date: '2026-11-03' },
      { status: 'Present', shift_date: '2025-11-03' },
    ],
    entries: [
      { customer: 'cus_1', kind: 'Credit', amount: 500 },
      { customer: 'cus_1', kind: 'Payment', amount: 200 },
      { customer: 'cus_2', kind: 'Credit', amount: 900 },
    ],
  },
  form: {},
  state: {},
  now,
  ...over,
});
const value = (src: string, c = ctx()) => {
  const r = evaluateFormula(src, c);
  if (!r.ok) throw new Error(`expected ok for ${src}: ${r.error}`);
  return r.value;
};
const scope: FormulaScope = {
  collections: {
    workouts: ['exercise', 'workout_date'], logs: ['habit', 'date', 'done'], entries: ['customer', 'kind', 'amount'],
  },
  formFields: [],
  stateKeys: [],
};

describe('week()', () => {
  it('names the Monday of the week, so the year is part of it', () => {
    expect(value('week(today)')).toBe('2026-11-23');
    expect(value("week('2026-11-29')")).toBe('2026-11-23');
    expect(value("week('2026-11-22')")).toBe('2026-11-16');
    expect(value("week('2026-12-31')")).toBe('2026-12-28');
    expect(value('week(now)')).toBe('2026-11-23');
    expect(value("week('not a date')")).toBeNull();
  });
  it('"This week" counts only this week (s24)', () => {
    expect(value('count(workouts)')).toBe(4); // what the cloud app showed
    expect(value('count(filter(workouts, week(workout_date) == week(today)))')).toBe(2);
  });
});

describe('month() includes the year (t17, t20)', () => {
  it('this month leaves out the same month last year', () => {
    expect(value('count(filter(attendance, month(shift_date) == month(today)))')).toBe(1);
  });
});

describe('streak()', () => {
  it('counts days in a row up to today (s21)', () => {
    expect(value("streak(filter(logs, habit == 'Walk' && done == true).date)")).toBe(3);
  });
  it('keeps yesterday\'s streak alive while today has no check-in yet', () => {
    expect(value("streak(filter(logs, habit == 'Water' && done == true).date)")).toBe(2);
  });
  it('is 0 with no entries and ignores duplicates and bad dates', () => {
    expect(value("streak(filter(logs, habit == 'Read').date)")).toBe(0);
    expect(value("streak(logs.date)")).toBe(5);
  });
  it('validates like any other function', () => {
    expect(validateFormula("streak(filter(logs, done == true).date)", scope)).toEqual([]);
    expect(validateFormula('streak(1, 2)', scope)).not.toEqual([]);
  });
});

describe('selected', () => {
  it('is the opened entry, so a page can total only its own links (s07, s23)', () => {
    const c = ctx({ selected: 'cus_1' });
    expect(value("sum(filter(entries, customer == selected && kind == 'Credit').amount) - sum(filter(entries, customer == selected && kind == 'Payment').amount)", c)).toBe(300);
    expect(value('count(filter(entries, customer == selected))', c)).toBe(2);
  });
  it('is empty when nothing was opened', () => {
    expect(value('selected')).toBeNull();
    expect(value('count(filter(entries, customer == selected))')).toBe(0);
  });
  it('a record field named selected still wins', () => {
    const c = ctx({ collections: { tasks: [{ selected: true }, { selected: false }] }, selected: 'x' });
    expect(value('count(filter(tasks, selected == true))', c)).toBe(1);
  });
  it('validates and is not a collection dependency', () => {
    expect(validateFormula('count(filter(entries, customer == selected))', scope)).toEqual([]);
    expect(formulaDependencies('count(filter(entries, customer == selected))').collections).toEqual(['entries']);
  });
});
