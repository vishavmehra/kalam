/**
 * `where` shorthand (docs/05 §8.1, ADR-031): count(x where cond) means count(filter(x, cond)), and the
 * same for sum, avg, min and max with a field. It is a parser rewrite, so the evaluator never sees it.
 */
import { describe, expect, it } from 'vitest';
import type { FormulaContext, FormulaScope } from '../contracts';
import { compileFormula, evaluateFormula, formulaDependencies, validateFormula } from './index';

const now = new Date(2026, 10, 17, 10, 30); // local 2026-11-17
const ctx: FormulaContext = {
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
    trips: [
      { where: 'home', km: 4 },
      { where: 'shop', km: 9 },
    ],
  },
  form: { a: 12 },
  state: {},
  now,
};
const scope: FormulaScope = {
  collections: { expenses: ['amount', 'category', 'date'], doses: ['medicine', 'date', 'taken'], trips: ['where', 'km'] },
  formFields: ['a'],
  stateKeys: [],
};
const value = (src: string) => {
  const r = evaluateFormula(src, ctx);
  if (!r.ok) throw new Error(`expected ok for ${src}: ${r.error}`);
  return r.value;
};
const compileErrors = (src: string): string[] => {
  const c = compileFormula(src);
  expect(c.ok, src).toBe(false);
  return c.ok ? [] : c.errors;
};
const ast = (src: string) => {
  const c = compileFormula(src);
  if (!c.ok) throw new Error(`expected ok for ${src}: ${c.errors.join('; ')}`);
  return c.ast;
};

describe('where shorthand', () => {
  it('count(x where cond) gives the same tree as count(filter(x, cond))', () => {
    expect(ast('count(doses where date == today)')).toEqual(ast('count(filter(doses, date == today))'));
    expect(ast("sum(expenses.amount where category == 'Food')")).toEqual(ast("sum(filter(expenses, category == 'Food').amount)"));
  });

  it('counts the way filter() does', () => {
    expect(value('count(doses where date == today)')).toBe(2);
    expect(value('count(doses where date == today && taken)')).toBe(1);
    expect(value('count(doses where !taken)')).toBe(1);
    expect(value("count(expenses where category == 'Travel')")).toBe(1);
    expect(value('count(doses where date == today)')).toBe(value('count(filter(doses, date == today))'));
  });

  it('works for sum, avg, min and max with a field', () => {
    expect(value("sum(expenses.amount where category == 'Food')")).toBe(150);
    expect(value("avg(expenses.amount where category == 'Food')")).toBe(75);
    expect(value("min(expenses.amount where category == 'Food')")).toBe(30);
    expect(value("max(expenses.amount where category == 'Food')")).toBe(120);
    expect(value('sum(expenses.amount where date == today)')).toBe(120);
  });

  it('works on an already filtered list', () => {
    expect(value("count(filter(doses, taken) where medicine == 'A')")).toBe(2);
    expect(value("sum(filter(expenses, date == today).amount where category == 'Food')")).toBe(120);
  });

  it('takes the whole condition after where, including || and comparisons', () => {
    expect(value("count(doses where medicine == 'B' || date == '2026-11-15')")).toBe(2);
    expect(value("count(doses where medicine == 'A' && date != today)")).toBe(1);
    expect(value("count(expenses where amount > 50 || category == 'Travel')")).toBe(2);
  });

  it('is usable inside bigger formulas and more than once', () => {
    expect(value("if(count(doses where taken) > 1, 'many', 'few')")).toBe('many');
    expect(value("count(doses where taken) + count(expenses where category == 'Food')")).toBe(5);
    expect(value("round(sum(expenses.amount where category == 'Food') / count(expenses where category == 'Food'), 1)")).toBe(50);
    expect(value('count(doses where taken) > 1 ? 1 : 0')).toBe(1);
  });

  it('allows a where inside the condition of another where', () => {
    expect(value("count(doses where date == today && count(expenses where category == 'Travel') > 0)")).toBe(2);
  });

  it('keeps a field that is called "where" working as a plain name', () => {
    expect(value("count(filter(trips, where == 'home'))")).toBe(1);
    expect(value("count(trips where where == 'home')")).toBe(1);
    expect(value('sum(trips.km where km > 5)')).toBe(9);
    expect(value("count(filter(doses, medicine == 'where'))")).toBe(0);
  });

  it('does not treat names that merely start with "where" as the keyword', () => {
    expect(compileFormula('count(filter(doses, wherever))').ok).toBe(true);
    // jsep reads a space-separated pair as two arguments, so this is count(doses, wherever) and the scope check rejects it.
    expect(validateFormula('count(doses wherever)', scope).join(' ')).toMatch(/Unknown name "wherever"/);
  });

  it('reports dependencies and passes scope validation like the filter() form', () => {
    expect(formulaDependencies("sum(expenses.amount where category == 'Food')").collections).toEqual(['expenses']);
    expect(validateFormula('count(doses where date == today)', scope)).toEqual([]);
    expect(validateFormula("sum(expenses.amount where category == 'Food')", scope)).toEqual([]);
  });

  it('is checked against the scope exactly like filter()', () => {
    expect(validateFormula('count(nothing where x == 1)', scope).join(' ')).toMatch(/not a collection/);
    expect(validateFormula('count(doses where colour == 1)', scope).join(' ')).toMatch(/Unknown name "colour"/);
    expect(validateFormula('sum(expenses.price where date == today)', scope).join(' ')).toMatch(/no field "price"/);
    expect(validateFormula('count(form.a where a > 1)', scope).join(' ')).toMatch(/not a collection/);
  });
});

describe('where shorthand errors', () => {
  it('rejects where outside count, sum, avg, min and max', () => {
    expect(compileErrors('doses where taken').join(' ')).toMatch(/"where" can only follow a collection/);
    expect(compileErrors('round(sum(expenses.amount) where amount > 1)').join(' ')).toMatch(/"where" can only follow/);
    expect(compileErrors('len(doses where taken)').join(' ')).toMatch(/"where" can only follow/);
    expect(compileErrors('concat(doses where taken)').join(' ')).toMatch(/"where" can only follow/);
    expect(compileErrors('if(doses where taken, 1, 2)').join(' ')).toMatch(/"where" can only follow/);
  });

  it('rejects a left side that is not a collection or a collection field', () => {
    expect(compileErrors('count(1 where taken)').join(' ')).toMatch(/"where" can only follow/);
    expect(compileErrors("count('a' where taken)").join(' ')).toMatch(/"where" can only follow/);
    expect(compileErrors('count((a + b) where taken)').join(' ')).toMatch(/"where" can only follow/);
    expect(compileErrors('count(sum(expenses.amount) where amount > 1)').join(' ')).toMatch(/"where" can only follow/);
  });

  it('rejects a missing condition and a missing collection', () => {
    expect(compileErrors('count(doses where)').join(' ')).toMatch(/Syntax error/);
    expect(compileErrors('count(doses where )').join(' ')).toMatch(/Syntax error/);
    // With nothing before it, "where" is an ordinary name, so this reads as count(where, taken) and the scope check rejects it.
    expect(validateFormula('count(where taken)', scope).join(' ')).toMatch(/Unknown name "where"/);
  });

  it('rejects chained where in one argument', () => {
    expect(compileErrors('count(doses where taken where medicine == "A")').join(' ')).toMatch(/only one "where"/);
    expect(compileErrors('count(doses where taken || x where y)').join(' ')).toMatch(/only one "where"/);
  });

  it('keeps every other formula rule in force inside a where', () => {
    expect(compileErrors('count(doses where constructor)').join(' ')).toMatch(/not allowed/);
    expect(compileErrors("count(doses where constructor.constructor('x')())").join(' ')).toMatch(/not allowed|Only built-in/);
    expect(compileErrors('count(doses where alert(1))').join(' ')).toMatch(/Function "alert" is not available/);
    expect(compileErrors('count(doses where taken; 1)').length).toBeGreaterThan(0);
    expect(compileErrors("count(doses where doses['x'])").join(' ')).toMatch(/Square-bracket/);
    expect(compileErrors('count(doses where this)').join(' ')).toMatch(/not allowed/);
  });

  it('reports a runtime error for an unknown collection, never a thrown exception', () => {
    const r = evaluateFormula('count(nothing where x == 1)', ctx);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toMatch(/Unknown name/);
  });

  it('never leaves an internal node in a compiled tree', () => {
    for (const src of [
      'count(doses where taken)', "sum(expenses.amount where category == 'Food')", 'count(doses where date == today && taken)',
    ]) expect(JSON.stringify(ast(src))).not.toContain('WhereExpression');
  });

  it('keeps ordinary formulas unchanged', () => {
    expect(value('count(filter(doses, date == today))')).toBe(2);
    expect(value("form.a > 10 ? 'big' : 'small'")).toBe('big');
    expect(compileFormula('a b').ok).toBe(false);
  });
});
