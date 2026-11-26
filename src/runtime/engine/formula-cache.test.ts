import { describe, expect, it } from 'vitest';
import type { FormulaResult } from '@/core/contracts';
import { evaluate, formulaContext, formulaReads, type CollectionValues } from './data';
import { createFormulaCache, formulaCacheFor } from './formula-cache';

const day = (d: number) => new Date(2026, 10, d, 12);
const rows = (...amounts: number[]): CollectionValues['x'] => amounts.map((amount, i) => ({ id: `r${i}`, amount }));
const value = (r: FormulaResult) => (r.ok ? r.value : `error: ${r.error}`);

describe('formula cache (docs/09 §8.6)', () => {
  it('reuses an answer while nothing it reads has changed, even when the rows are rebuilt', () => {
    const cache = createFormulaCache('a1', 1);
    const first = cache.evaluate('sum(orders.amount)', formulaContext({ orders: rows(1, 2) }, {}, {}, day(1)));
    const again = cache.evaluate('sum(orders.amount)', formulaContext({ orders: rows(1, 2) }, {}, {}, day(1)));
    expect(value(first)).toBe(3);
    expect(again).toBe(first);
    expect(cache.stats).toEqual({ hits: 1, misses: 1 });
  });

  it('recalculates when a collection it names changes, and not when another one does', () => {
    const cache = createFormulaCache('a1', 1);
    const ctx = (orders: CollectionValues['x'], notes: CollectionValues['x']) => formulaContext({ orders, notes }, {}, {}, day(1));
    expect(value(cache.evaluate('sum(orders.amount)', ctx(rows(1, 2), rows(9))))).toBe(3);
    expect(value(cache.evaluate('sum(orders.amount)', ctx(rows(1, 2), rows(9, 9))))).toBe(3);
    expect(cache.stats.hits).toBe(1);
    expect(value(cache.evaluate('sum(orders.amount)', ctx(rows(1, 5), rows(9, 9))))).toBe(6);
    expect(cache.stats.misses).toBe(2);
    // An edit that keeps the number of rows is still a change.
    expect(value(cache.evaluate('sum(orders.amount)', ctx(rows(1, 6), rows(9, 9))))).toBe(7);
  });

  it('sees a collection used inside a filter test (formulaDependencies alone would miss it)', () => {
    const cache = createFormulaCache('a1', 1);
    const f = 'count(filter(a, amount == count(b)))';
    const ctx = (b: CollectionValues['x']) => formulaContext({ a: rows(2, 2, 3), b }, {}, {}, day(1));
    expect(value(cache.evaluate(f, ctx(rows(1, 1))))).toBe(2);
    expect(value(cache.evaluate(f, ctx(rows(1, 1, 1))))).toBe(1);
  });

  it('keys on the form and counter values the formula reads, not on the others', () => {
    const cache = createFormulaCache('a1', 1);
    const ctx = (form: Record<string, number>, state: Record<string, number> = {}) => formulaContext({}, form, state, day(1));
    expect(value(cache.evaluate('form.a + form.b', ctx({ a: 1, b: 2, c: 1 })))).toBe(3);
    expect(value(cache.evaluate('form.a + form.b', ctx({ a: 1, b: 2, c: 99 })))).toBe(3);
    expect(cache.stats.hits).toBe(1);
    expect(value(cache.evaluate('form.a + form.b', ctx({ a: 5, b: 2 })))).toBe(7);
    expect(value(cache.evaluate('state.n * 2', ctx({}, { n: 4 })))).toBe(8);
    expect(value(cache.evaluate('state.n * 2', ctx({}, { n: 5 })))).toBe(10);
  });

  it('keys on the opened entry only when the formula reads `selected`', () => {
    const cache = createFormulaCache('a1', 1);
    const entries = [{ id: 'c1', customer: 'u1', amount: 5 }, { id: 'c2', customer: 'u2', amount: 7 }];
    const ctx = (selected: string) => formulaContext({ entries }, {}, {}, day(1), selected);
    expect(value(cache.evaluate('sum(filter(entries, customer == selected).amount)', ctx('u1')))).toBe(5);
    expect(value(cache.evaluate('sum(filter(entries, customer == selected).amount)', ctx('u2')))).toBe(7);
    expect(value(cache.evaluate('sum(entries.amount)', ctx('u1')))).toBe(12);
    expect(value(cache.evaluate('sum(entries.amount)', ctx('u2')))).toBe(12);
    expect(cache.stats.hits).toBe(1);
  });

  it('keys `today` by the date, and never caches `now`', () => {
    const cache = createFormulaCache('a1', 1);
    const at = (d: number) => formulaContext({}, {}, {}, day(d));
    expect(value(cache.evaluate('today', at(1)))).toBe('2026-11-01');
    expect(value(cache.evaluate('today', at(1)))).toBe('2026-11-01');
    expect(value(cache.evaluate('today', at(2)))).toBe('2026-11-02');
    expect(cache.stats).toEqual({ hits: 1, misses: 2 });
    cache.evaluate('now', at(1));
    cache.evaluate('now', at(1));
    expect(cache.size).toBe(2);
  });

  it('never serves a stale streak after the date changes (the date is read inside the evaluator)', () => {
    const cache = createFormulaCache('a1', 1);
    const habits = [{ id: 'h1', date: '2026-11-24' }];
    const at = (d: number) => formulaContext({ habits }, {}, {}, day(d));
    const cached = (d: number) => value(cache.evaluate('streak(habits.date)', at(d)));
    const fresh = (d: number) => value(evaluate('streak(habits.date)', at(d)));
    expect(cached(25)).toBe(1);
    expect(cached(25)).toBe(1);
    expect(cache.stats.hits).toBe(1);
    expect(cached(28)).toBe(0);
    for (const d of [24, 25, 26, 28]) expect(cached(d)).toBe(fresh(d));
  });

  it('keeps an error as an error and does not cache list tests', () => {
    const cache = createFormulaCache('a1', 1);
    const ctx = formulaContext({}, {}, {}, day(1));
    expect(value(cache.evaluate('missing.amount', ctx))).toMatch(/^error:/);
    cache.evaluate('amount > 1', { ...ctx, record: { amount: 2 } });
    cache.evaluate('amount > 1', { ...ctx, record: { amount: 0 } });
    expect(cache.size).toBe(1);
  });

  it('drops the oldest answer past its limit and can be cleared', () => {
    const cache = createFormulaCache('a1', 1, 2);
    const ctx = formulaContext({}, {}, {}, day(1));
    cache.evaluate('1 + 1', ctx);
    cache.evaluate('2 + 2', ctx);
    cache.evaluate('3 + 3', ctx);
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('retires an app cache when its spec version changes', () => {
    const v1 = formulaCacheFor('app_x', 1);
    expect(formulaCacheFor('app_x', 1)).toBe(v1);
    const v2 = formulaCacheFor('app_x', 2);
    expect(v2).not.toBe(v1);
    expect(formulaCacheFor('app_x', 2)).toBe(v2);
    expect(formulaCacheFor('app_y', 2)).not.toBe(v2);
  });
});

describe('formulaReads (from the parsed formula)', () => {
  it('reports what a formula reads', () => {
    expect(formulaReads('form.a + 1')).toEqual({ form: true, state: false, selected: false });
    expect(formulaReads('state.n')).toEqual({ form: false, state: true, selected: false });
    expect(formulaReads('sum(filter(e, c == selected).amount)')).toEqual({ form: false, state: false, selected: true });
    expect(formulaReads("count(filter(e, note == 'form.x'))")).toEqual({ form: false, state: false, selected: false });
  });
});
