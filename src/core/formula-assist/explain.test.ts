import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORMULA_FUNCTIONS } from '../formula';
import type { KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { DESCRIBED_FUNCTIONS, describeFormula, explainFormula } from './index';

const FIXTURES = new URL('../../../tests/fixtures/specs/valid/', import.meta.url);
const load = (name: string): KalamSpec => {
  const r = validateSpec(JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8')));
  if (!r.ok || !r.spec) throw new Error(`fixture ${name} is invalid`);
  return r.spec;
};
const expenses = load('expense-tracker');
const gst = load('gst-calculator');
const habit = load('habit-counter');

const say = (f: string, spec = expenses, screenId?: string): string => explainFormula(f, spec, { screenId });

describe('coverage of the formula grammar', () => {
  it('describes every function the parser accepts', () => {
    expect([...DESCRIBED_FUNCTIONS].sort()).toEqual([...FORMULA_FUNCTIONS].sort());
  });

  it('collections, fields and the average, lowest and highest of a field', () => {
    expect(say('sum(expenses.amount)')).toBe('Shows the total amount of expenses.');
    expect(say('avg(expenses.amount)')).toBe('Shows the average amount of expenses.');
    expect(say('min(expenses.amount)')).toBe('Shows the lowest amount of expenses.');
    expect(say('max(expenses.amount)')).toBe('Shows the highest amount of expenses.');
    expect(say('min(expenses.date)')).toBe('Shows the earliest date of expenses.');
    expect(say('max(expenses.date)')).toBe('Shows the latest date of expenses.');
    expect(say('count(expenses)')).toBe('Shows the number of expenses.');
    expect(say('count(expenses.amount)')).toBe('Shows the number of amount values filled in for expenses.');
    expect(say('expenses')).toBe('Shows all expenses.');
    expect(say('expenses.amount')).toBe('Shows the amount of every entry in expenses.');
  });

  it('filters, with today, this month and several conditions', () => {
    expect(say("sum(filter(expenses, category == 'Food').amount)")).toBe('Shows the total amount of expenses where category is “Food”.');
    expect(say('count(filter(expenses, date == today))')).toBe('Shows the number of expenses where date is today.');
    expect(say('sum(filter(expenses, month(date) == month(today)).amount)')).toBe('Shows the total amount of expenses where date is in this month.');
    expect(say("count(filter(filter(expenses, category == 'Food'), date == today))")).toBe('Shows the number of expenses where category is “Food” and date is today.');
    expect(say("filter(expenses, category != 'Food')")).toBe('Shows the expenses where category is not “Food”.');
    expect(say("count(filter(expenses, (category == 'Food' || category == 'Travel') && amount > 100))"))
      .toBe('Shows the number of expenses where (category is “Food” or category is “Travel”) and amount is more than 100.');
    expect(say('count(filter(expenses, month(date) != month(today)))')).toBe('Shows the number of expenses where date is not in this month.');
    expect(say('count(filter(expenses, month(date) == month(now)))')).toBe('Shows the number of expenses where date is in this month.');
    expect(say('count(filter(expenses, month(date) == month(note)))')).toBe('Shows the number of expenses where date and note are in the same month.');
  });

  it('the where shorthand reads the same as filter()', () => {
    expect(say("count(expenses where category == 'Food')")).toBe(say("count(filter(expenses, category == 'Food'))"));
    expect(say("sum(expenses.amount where category == 'Food')")).toBe(say("sum(filter(expenses, category == 'Food').amount)"));
    expect(say('count(expenses where date == today)')).toBe('Shows the number of expenses where date is today.');
    expect(say('sum(expenses.amount where month(date) == month(today))')).toBe('Shows the total amount of expenses where date is in this month.');
  });

  it('every binary operator, with brackets only where the order needs them', () => {
    expect(say('1 + 2')).toBe('Shows 1 plus 2.');
    expect(say('5 - 2 - 1')).toBe('Shows 5 minus 2 minus 1.');
    expect(say('5 - (2 - 1)')).toBe('Shows 5 minus (2 minus 1).');
    expect(say('2 * 3 + 4')).toBe('Shows 2 times 3 plus 4.');
    expect(say('2 * (3 + 4)')).toBe('Shows 2 times (3 plus 4).');
    expect(say('10 / 4')).toBe('Shows 10 divided by 4.');
    expect(say('10 / (4 / 2)')).toBe('Shows 10 divided by (4 divided by 2).');
    expect(say('10 % 3')).toBe('Shows the remainder of 10 divided by 3.');
    expect(say('1 == 1')).toBe('Shows 1 is 1.');
    expect(say('1 === 1')).toBe('Shows 1 is 1.');
    expect(say('1 != 2')).toBe('Shows 1 is not 2.');
    expect(say('1 !== 2')).toBe('Shows 1 is not 2.');
    expect(say('1 < 2')).toBe('Shows 1 is less than 2.');
    expect(say('1 <= 2')).toBe('Shows 1 is at most 2.');
    expect(say('3 > 2')).toBe('Shows 3 is more than 2.');
    expect(say('3 >= 2')).toBe('Shows 3 is at least 2.');
    expect(say('true && false')).toBe('Shows yes and no.');
    expect(say('true || false')).toBe('Shows yes or no.');
    expect(say('(true || false) && true')).toBe('Shows (yes or no) and yes.');
  });

  it('unary operators and every kind of literal', () => {
    expect(say('-5')).toBe('Shows -5.');
    expect(say('-(2 + 3)')).toBe('Shows minus (2 plus 3).');
    expect(say('+3')).toBe('Shows 3.');
    expect(say('!true')).toBe('Shows not yes.');
    expect(say("'hello'")).toBe('Shows “hello”.');
    expect(say('null')).toBe('Shows nothing.');
    expect(say('1000.5')).toBe('Shows 1,000.5.');
    expect(say('today')).toBe('Shows today.');
    expect(say('now')).toBe('Shows the current time.');
  });

  it('if, the ? : form, round, abs, len, concat and month', () => {
    expect(say("if(sum(expenses.amount) > 1000, 'High', 'Low')")).toBe('Shows “High” when the total amount of expenses is more than 1,000, otherwise “Low”.');
    expect(say("sum(expenses.amount) > 1000 ? 'High' : 'Low'")).toBe(say("if(sum(expenses.amount) > 1000, 'High', 'Low')"));
    expect(say('round(sum(expenses.amount) / 3, 2)')).toBe('Shows the total amount of expenses divided by 3, rounded to 2 decimal places.');
    expect(say('round(2.5)')).toBe('Shows 2.5, rounded to a whole number.');
    expect(say('round(2.55, 1)')).toBe('Shows 2.55, rounded to 1 decimal place.');
    expect(say('round(2.5, 0)')).toBe('Shows 2.5, rounded to a whole number.');
    // The engine keeps the digits between 0 and 10, and the sentence says what the engine does.
    expect(say('round(2.5, -1)')).toBe('Shows 2.5, rounded to a whole number.');
    expect(say('round(2.5, 15)')).toBe('Shows 2.5, rounded to 10 decimal places.');
    expect(say('round(2.5, 2.9)')).toBe('Shows 2.5, rounded to 2 decimal places.');
    expect(say('abs(5 - 8)')).toBe('Shows 5 minus 8, ignoring any minus sign.');
    expect(say('len(expenses)')).toBe('Shows the number of expenses.');
    expect(say("len(filter(expenses, date == today))")).toBe('Shows the number of expenses where date is today.');
    expect(say('len(expenses.note)')).toBe('Shows the number of note values in expenses.');
    expect(say("len('abc')")).toBe('Shows the number of characters in “abc”.');
    expect(say("concat('Total: ', sum(expenses.amount))")).toBe('Shows “Total: ” and the total amount of expenses joined into one text.');
    expect(say('concat(1 + 2, 3)')).toBe('Shows (1 plus 2) and 3 joined into one text.');
    expect(say('month(today)')).toBe('Shows the month of today.');
    expect(say('sum(1, 2, 3)')).toBe('Shows the total of 1, 2 and 3.');
    expect(say('avg(1 + 1, 2)')).toBe('Shows the average of (1 plus 1) and 2.');
    expect(say('count(1, 2)')).toBe('Shows the number of values filled in among 1 and 2.');
  });

  it('typed values and counters use the labels people see', () => {
    expect(say('round(form.amount * form.rate / 100, 2)', gst, 'calc'))
      .toBe('Shows price before tax times GST rate (%) divided by 100, rounded to 2 decimal places.');
    expect(say('form.amount + 1', gst, 'calc')).toBe('Shows price before tax plus 1.');
    // Without the screen the label is not known, so it falls back to the field name.
    expect(say('form.amount + 1', gst)).toBe('Shows amount plus 1.');
    expect(say("if(state.water >= 8, 'Done', 'Keep going')", habit)).toBe('Shows “Done” when the glasses of water counter is at least 8, otherwise “Keep going”.');
  });
});

describe('what it does not know', () => {
  it('uses a safe generic phrase for a name that is not in the app', () => {
    expect(say('sum(orders.amount)')).toBe('Shows the total of something that cannot be put into words.');
    expect(say('count(orders)')).toBe('Shows the number of values filled in among orders.');
    expect(say('state.nothing')).toBe('Shows the nothing counter.');
    expect(say('expenses.nothing + 1')).toBe('Shows the nothing of every entry in expenses plus 1.');
  });

  it('says so when the formula cannot be read at all', () => {
    for (const bad of ['', 'eval("1")', 'bogus(1)', 'sum(', 'this', 'a.b.c', '[1, 2]', 'x = 1']) {
      const out = describeFormula(bad, expenses);
      expect(out.explanation, bad).toBe('This formula cannot be read, so it cannot be put into words.');
      expect(out.references).toEqual([]);
    }
  });
});

describe('references and wording', () => {
  it('lists the collections and fields a formula reads', () => {
    const out = describeFormula("sum(filter(expenses, category == 'Food').amount)", expenses);
    expect(out.references).toEqual(expect.arrayContaining(['Expenses', 'Expenses: Amount', 'Expenses: Category']));
    expect(describeFormula('form.amount * form.rate', gst, { screenId: 'calc' }).references).toEqual(['Price before tax', 'GST rate (%)']);
  });

  it('describes every formula in every fixture app in plain words', () => {
    let seen = 0;
    for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith('.json'))) {
      const spec = load(file.replace('.json', ''));
      for (const screen of spec.screens) {
        for (const c of screen.children) {
          const formulas = c.type === 'stat' ? [c.expr] : c.type === 'list' && c.filter ? [c.filter] : [];
          for (const f of formulas) {
            const text = explainFormula(f, spec, { screenId: screen.id });
            expect(text, `${file}: ${f}`).toMatch(/^Shows .+\.$/);
            expect(text, `${file}: ${f}`).not.toContain('cannot be put into words');
            expect(text, `${file}: ${f}`).not.toMatch(/[—–!]/);
            seen += 1;
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(5);
  });
});
