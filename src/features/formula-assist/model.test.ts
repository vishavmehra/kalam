import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FormulaAssistResult } from '@/core/formula-assist';
import { applyPatchOps } from '@/core/edit';
import { validateSpec } from '@/core/spec/validate';
import { editForUse, helperReducer, parseTyped, statChoices, statLabel } from './model';

const spec = (() => {
  const r = validateSpec(JSON.parse(readFileSync(new URL('../../../tests/fixtures/specs/valid/expense-tracker.json', import.meta.url), 'utf8')));
  if (!r.ok || !r.spec) throw new Error('fixture invalid');
  return r.spec;
})();

const good: FormulaAssistResult = {
  ok: true, formula: 'count(expenses)', explanation: 'Shows the number of expenses.', references: ['Expenses'], warnings: [],
  sampleValues: { kind: 'examples', label: 'Example only. These are made-up entries, not yours.', inputs: [], result: 5, resultText: '5' },
  source: 'deterministic', badge: 'Calculated on this device',
};
const bad: FormulaAssistResult = { ok: false, reason: 'cannot_answer', message: 'No.', source: 'on_device', warnings: [] };

describe('helper state', () => {
  it('goes idle, working, done, and back to idle', () => {
    let s = helperReducer({ phase: 'idle' }, { type: 'start', id: 1 });
    expect(s).toEqual({ phase: 'working', id: 1 });
    s = helperReducer(s, { type: 'finish', id: 1, request: 'how many', result: good });
    expect(s).toMatchObject({ phase: 'done', request: 'how many' });
    expect(helperReducer(s, { type: 'clear' })).toEqual({ phase: 'idle' });
  });

  it('drops an answer that arrives after a newer request or after Clear', () => {
    const second = helperReducer(helperReducer({ phase: 'idle' }, { type: 'start', id: 1 }), { type: 'start', id: 2 });
    expect(helperReducer(second, { type: 'finish', id: 1, request: 'old', result: good })).toEqual({ phase: 'working', id: 2 });
    const cleared = helperReducer(second, { type: 'clear' });
    expect(helperReducer(cleared, { type: 'finish', id: 2, request: 'late', result: good })).toEqual({ phase: 'idle' });
  });
});

describe('editing by hand', () => {
  it('ignores a check that was started for an older suggestion', () => {
    const first = helperReducer(helperReducer({ phase: 'idle' }, { type: 'start', id: 1 }), { type: 'finish', id: 1, request: 'a', result: good });
    const second = helperReducer(helperReducer(first, { type: 'start', id: 2 }), { type: 'finish', id: 2, request: 'b', result: { ...good, formula: 'count(expenses) * 2' } });
    // A slow check of the first suggestion arrives after the second suggestion is on screen.
    expect(helperReducer(second, { type: 'replace', id: 1, result: { ...good, formula: 'count(expenses) + 1' } })).toBe(second);
  });

  it('swaps in a checked formula, and ignores a failed check or a check with nothing on screen', () => {
    const done = helperReducer(helperReducer({ phase: 'idle' }, { type: 'start', id: 1 }), { type: 'finish', id: 1, request: 'how many', result: good });
    const edited = { ...good, formula: 'count(expenses) + 1' };
    expect(helperReducer(done, { type: 'replace', id: 1, result: edited })).toMatchObject({ phase: 'done', request: 'how many', result: { formula: 'count(expenses) + 1' } });
    expect(helperReducer(done, { type: 'replace', id: 1, result: bad })).toBe(done);
    expect(helperReducer({ phase: 'idle' }, { type: 'replace', id: 1, result: edited })).toEqual({ phase: 'idle' });
  });
});

describe('choosing a number', () => {
  it('lists the stats of the app in order, with the screen they are on', () => {
    expect(statChoices(spec).map((c) => [c.id, c.label, c.expr])).toEqual([
      ['today_total', 'Spent today', 'sum(filter(expenses, date == today).amount)'],
      ['all_total', 'Spent in total', 'sum(expenses.amount)'],
    ]);
    expect(statChoices(spec)[0]?.screen).toBe('Expenses');
  });
});

describe('Use this', () => {
  it('builds the existing set-property op for the stat and a plain summary', () => {
    const edit = editForUse(spec, 'all_total', good);
    expect(edit?.ops).toEqual([{ op: 'setComponentProperty', component: 'all_total', property: 'expr', value: 'count(expenses)' }]);
    expect(edit?.summary).toBe('Changed what “Spent in total” shows');
    const applied = applyPatchOps(spec, edit?.ops ?? []);
    expect(applied.ok).toBe(true);
    expect(applied.spec?.screens.flatMap((s) => s.children).find((c) => c.id === 'all_total')).toMatchObject({ expr: 'count(expenses)' });
  });

  it('offers nothing for a failure or before there is an answer', () => {
    expect(editForUse(spec, 'all_total', bad)).toBeUndefined();
    expect(editForUse(spec, 'all_total', undefined)).toBeUndefined();
  });

  it('names the stat, with a fallback for one that is not there', () => {
    expect(statLabel(spec, 'today_total')).toBe('Spent today');
    expect(statLabel(spec, 'nope')).toBe('this number');
  });
});

describe('example values the person types', () => {
  it('reads plain numbers, with commas and spaces, and leaves out anything else', () => {
    expect(parseTyped({ a: '250', b: '1,000.50', c: ' 12 ', d: '-3' })).toEqual({ a: 250, b: 1000.5, c: 12, d: -3 });
    expect(parseTyped({ a: '', b: 'abc', c: '1e5', d: '12px', e: '1.2.3' })).toEqual({});
  });
});
