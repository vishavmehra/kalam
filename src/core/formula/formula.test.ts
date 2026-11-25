import { describe, expect, it } from 'vitest';
import type { FormulaContext, FormulaScope } from '../contracts';
import { evaluateFormula, formulaDependencies, validateFormula } from './index';

const now = new Date(2026, 10, 17, 10, 30); // local 2026-11-17
const ctx = (over: Partial<FormulaContext> = {}): FormulaContext => ({
  collections: {
    expenses: [
      { amount: 120, category: 'Food', date: '2026-11-17' },
      { amount: 80.5, category: 'Travel', date: '2026-11-16' },
      { amount: null, category: 'Food', date: '2026-11-17' },
      { amount: '30', category: 'Food', date: '2026-11-10' },
    ],
    doses: [
      { medicine: 'A', date: '2026-11-17', taken: true },
      { medicine: 'B', date: '2026-11-17', taken: false },
      { medicine: 'A', date: '2026-11-15', taken: true },
    ],
  },
  form: { a: 12, b: '3', name: 'Asha', empty: null },
  state: { cups: 4 },
  now,
  ...over,
});
const value = (src: string, c = ctx()) => {
  const r = evaluateFormula(src, c);
  if (!r.ok) throw new Error(`expected ok for ${src}: ${r.error}`);
  return r.value;
};
const fails = (src: string, c = ctx()) => {
  const r = evaluateFormula(src, c);
  expect(r.ok, src).toBe(false);
  return r.ok ? '' : r.error;
};

describe('evaluateFormula', () => {
  it('aggregates collections', () => {
    expect(value('count(expenses)')).toBe(4);
    expect(value('sum(expenses.amount)')).toBe(230.5);
    expect(value('count(expenses.amount)')).toBe(3);
    expect(value('avg(expenses.amount)')).toBeCloseTo(76.833, 2);
    expect(value('min(expenses.amount)')).toBe(30);
    expect(value('max(expenses.amount)')).toBe(120);
    expect(value('max(expenses.date)')).toBe('2026-11-17');
    expect(value('sum(1, 2, 3)')).toBe(6);
  });

  it('filters with record predicates, today and filtered field lists', () => {
    expect(value('count(filter(doses, date == today))')).toBe(2);
    expect(value('count(filter(doses, date == today && taken))')).toBe(1);
    expect(value("sum(filter(expenses, category == 'Food').amount)")).toBe(150);
    expect(value('count(filter(filter(doses, taken), medicine == "A"))')).toBe(2);
    expect(value('count(filter(doses, !taken))')).toBe(1);
  });

  it('evaluates list predicates with ctx.record', () => {
    expect(value('taken && date == today', ctx({ record: { taken: true, date: '2026-11-17' } }))).toBe(true);
    expect(value('missing == null', ctx({ record: { taken: true } }))).toBe(true);
  });

  it('handles form, state, arithmetic and null safety', () => {
    expect(value('form.a + form.b')).toBe(15);
    expect(value('form.a * form.b')).toBe(36);
    expect(value('form.a / 0')).toBeNull();
    expect(value('form.a % 0')).toBeNull();
    expect(value('form.a + form.empty')).toBeNull();
    expect(value('form.missing * 2')).toBeNull();
    expect(value('state.cups + 1')).toBe(5);
    expect(value('-form.a')).toBe(-12);
    expect(value("'Hi ' + form.name")).toBe('Hi Asha');
    expect(value('round(10 / 3, 2)')).toBe(3.33);
    expect(value('round(1.005, 2)')).toBe(1.01);
    expect(value('round(2.5)')).toBe(3);
    expect(value('abs(-4)')).toBe(4);
    expect(value("len('kalam')")).toBe(5);
    expect(value("concat('Total: ', sum(expenses.amount), ' INR')")).toBe('Total: 230.5 INR');
  });

  it('supports comparisons, if() and the ternary operator', () => {
    expect(value("if(sum(expenses.amount) > 0, 'Credit', 'Debit')")).toBe('Credit');
    expect(value("form.a > 10 ? 'big' : 'small'")).toBe('big');
    expect(value("'2026-11-16' < today")).toBe(true);
    expect(value('form.b == 3')).toBe(true);
    expect(value('form.empty == null')).toBe(true);
    expect(value('form.empty > 1')).toBe(false);
    expect(value('form.a === 12')).toBe(true);
    expect(value('now')).toBe(now.getTime());
    expect(value('today')).toBe('2026-11-17');
  });

  it('only evaluates the chosen if() branch', () => {
    expect(value('if(true, 1, unknown_thing)')).toBe(1);
  });

  it('rejects unknown names at evaluation time', () => {
    expect(fails('count(nothing)')).toMatch(/Unknown name/);
  });

  describe('security', () => {
    const attacks = [
      "constructor.constructor('return 1')()",
      'constructor',
      '__proto__',
      'expenses.__proto__',
      'form.constructor',
      'this',
      'window.alert(1)',
      'alert(1)',
      'globalThis',
      'x.y.z',
      'expenses.amount.length',
      "expenses['amount']",
      'form.a.toString()',
      'sum.call(1)',
      '[1, 2]',
      'a, b',
      'a; b',
      'a ?? b',
      '1 << 2',
      '~1',
      'count(expenses)(1)',
      'eval("1")',
      'Function("x")',
      'process.exit()',
      'require("fs")',
    ];
    for (const src of attacks) {
      it(`rejects ${src}`, () => {
        fails(src);
        expect(validateFormula(src, { collections: { expenses: ['amount'] }, formFields: ['a'], stateKeys: [] }).length).toBeGreaterThan(0);
      });
    }

    it('does not leak prototype values through own-property lookups', () => {
      const c = ctx({ form: Object.create({ inherited: 5 }) as Record<string, unknown> });
      expect(value('form.inherited')).toBeNull();
      expect(evaluateFormula('form.inherited', c)).toEqual({ ok: true, value: null });
    });

    it('stops runaway formulas at the step limit', () => {
      const big = Array.from({ length: 300 }, (_, i) => ({ v: i }));
      const c = ctx({ collections: { big } });
      expect(fails('count(filter(big, count(filter(big, v >= 0)) > 0))', c)).toMatch(/too complex/);
      expect(value('count(filter(big, v >= 0))', c)).toBe(300);
    });

    it('rejects over-long and deeply nested formulas', () => {
      fails('1+'.repeat(200) + '1');
      expect(value('('.repeat(40) + '1' + ')'.repeat(40))).toBe(1); // grouping adds no AST depth
      fails('!'.repeat(40) + '1');
      fails('abs('.repeat(40) + '1' + ')'.repeat(40));
    });

    it('reports syntax errors without throwing', () => {
      expect(fails('sum(')).toMatch(/Syntax error/);
      expect(fails('')).toMatch(/empty/);
    });
  });
});

describe('month()', () => {
  const nov = ctx({
    collections: {
      expenses: [
        { amount: 100, date: '2026-11-01' },
        { amount: 50, date: '2026-11-30' },
        { amount: 70, date: '2026-10-31' },
        { amount: 9, date: null },
        { amount: 5, date: 'soon' },
      ],
    },
  });
  it('turns dates, today and now into YYYY-MM', () => {
    expect(value('month(today)')).toBe('2026-11');
    expect(value('month(now)')).toBe('2026-11');
    expect(value("month('2026-02-03')")).toBe('2026-02');
    expect(value("month('2026-02-03T10:00:00Z')")).toBe('2026-02');
    expect(value("month('next week')")).toBeNull();
    expect(value('month(form.empty)')).toBeNull();
    expect(value('month(true)')).toBeNull();
  });
  it('totals this month only (the expense tracker stat)', () => {
    expect(value('sum(filter(expenses, month(date) == month(today)).amount)', nov)).toBe(150);
    expect(value('count(filter(expenses, month(date) == month(today)))', nov)).toBe(2);
  });
  it('validates arity and scope', () => {
    const scope: FormulaScope = { collections: { expenses: ['amount', 'date'] }, formFields: [], stateKeys: [] };
    expect(validateFormula('sum(filter(expenses, month(date) == month(today)).amount)', scope)).toEqual([]);
    expect(validateFormula('month()', scope)[0]).toMatch(/month\(\) takes 1 argument/);
    expect(validateFormula('month(today, now)', scope)[0]).toMatch(/takes 1 argument/);
    expect(validateFormula('month(dates)', scope)[0]).toMatch(/Unknown name "dates"/);
  });
});

describe('validateFormula', () => {
  const scope: FormulaScope = {
    collections: { orders: ['customer', 'amount', 'delivery', 'done'], payments: ['amount'] },
    formFields: ['a', 'b'],
    stateKeys: ['cups'],
  };
  it('accepts valid formulas', () => {
    for (const src of [
      'count(orders)', 'sum(orders.amount) - sum(payments.amount)', 'form.a + form.b', 'state.cups * 2',
      'count(filter(orders, delivery >= today && !done))', "sum(filter(orders, customer == 'Asha').amount)",
      "if(count(orders) > 0, 'yes', 'no')",
    ]) expect(validateFormula(src, scope), src).toEqual([]);
  });
  it('flags unknown references with helpful messages', () => {
    expect(validateFormula('count(order)', scope)[0]).toMatch(/Unknown name "order"/);
    expect(validateFormula('sum(orders.total)', scope)[0]).toMatch(/no field "total"/);
    expect(validateFormula('form.c', scope)[0]).toMatch(/Unknown form field/);
    expect(validateFormula('state.tea', scope)[0]).toMatch(/Unknown counter/);
    expect(validateFormula('count(filter(orders, colour == 1))', scope)[0]).toMatch(/not a field/);
    expect(validateFormula('sum(orders)', scope)[0]).toMatch(/needs a field/);
    expect(validateFormula('filter(form, a)', scope)[0]).toMatch(/not a collection/);
    expect(validateFormula('form', scope)[0]).toMatch(/form\.<name>/);
  });
  it('resolves bare identifiers to record fields for list predicates', () => {
    expect(validateFormula('done == false', { ...scope, recordFields: ['done'] })).toEqual([]);
    expect(validateFormula('done == false', scope).length).toBe(1);
  });
});

describe('formulaDependencies', () => {
  it('lists collections, form and state names', () => {
    expect(formulaDependencies("sum(filter(orders, customer == form.q).amount) + state.cups + count(payments)")).toEqual({
      collections: ['orders', 'payments'], form: ['q'], state: ['cups'],
    });
    expect(formulaDependencies('sum(')).toEqual({ collections: [], form: [], state: [] });
  });
});
