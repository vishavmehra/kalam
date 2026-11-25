import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import { validateSpec } from '../spec';
import type { KalamSpec } from '../spec/schema';
import {
  applyTranslatedView, collectTranslatableLabels, sourceHash, translatedView, type TranslatableLabel,
} from './labels';

const load = (name: string): KalamSpec => {
  const r = validateSpec(loadFixture('valid', name));
  if (!r.ok || !r.spec) throw new Error(`fixture ${name} is invalid`);
  return r.spec;
};
const expenses = load('expense-tracker');
const gst = load('gst-calculator');
const kirana = load('kirana-credit-book');

const fake = (labels: readonly TranslatableLabel[]): Record<string, string> =>
  Object.fromEntries(labels.map((l) => [l.key, `अनुवाद ${l.text}`]));

describe('collectTranslatableLabels', () => {
  const labels = collectTranslatableLabels(expenses);

  it('gives every label a unique, stable key', () => {
    const keys = labels.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(collectTranslatableLabels(expenses).map((l) => l.key)).toEqual(keys);
  });

  it('covers titles, component labels, field labels and action messages', () => {
    const kinds = new Set(labels.map((l) => l.kind));
    expect(kinds).toContain('screen_title');
    expect(kinds).toContain('label');
    expect(kinds).toContain('field_label');
    expect(kinds).toContain('feedback');
    const title = labels.find((l) => l.key === `screen.${expenses.screens[0].id}.title`);
    expect(title?.text).toBe(expenses.screens[0].title);
  });

  it('reads the feedback text of an action and the field labels of a collection', () => {
    expect(labels.find((l) => l.key === 'action.save_expense.then.feedback')?.text).toBe('Expense saved');
    const [collectionId, collection] = Object.entries(expenses.collections)[0];
    const [fieldId, field] = Object.entries(collection.fields)[0];
    expect(labels.find((l) => l.key === `field.${collectionId}.${fieldId}.label`)?.text).toBe(field.label);
  });

  it('never includes ids, formulas, units or intent phrases', () => {
    const texts = new Set(labels.map((l) => l.text));
    for (const stat of expenses.screens.flatMap((s) => s.children).filter((c) => c.type === 'stat')) {
      expect(texts.has(stat.expr)).toBe(false);
    }
    for (const phrases of Object.values(expenses.intents)) for (const p of phrases) expect(texts.has(p)).toBe(false);
    for (const unit of Object.values(expenses.collections).flatMap((c) => Object.values(c.fields)).flatMap((f) => (f.type === 'number' && f.unit ? [f.unit] : []))) {
      expect(labels.some((l) => l.text === unit)).toBe(false);
    }
  });

  it('skips text with no letters, such as the tax rates 5, 12, 18, 28', () => {
    const gstLabels = collectTranslatableLabels(gst);
    expect(gstLabels.some((l) => l.kind === 'option')).toBe(false);
  });

  it('collects each enum option once, even when two fields share it', () => {
    const spec: KalamSpec = JSON.parse(JSON.stringify(expenses)) as KalamSpec;
    const first = Object.values(spec.collections)[0];
    first.fields.kind_a = { type: 'enum', label: 'Kind A', options: ['Cash', 'Card'] };
    first.fields.kind_b = { type: 'enum', label: 'Kind B', options: ['Card', 'Other'] };
    const options = collectTranslatableLabels(spec).filter((l) => l.kind === 'option').map((l) => l.text);
    expect(options.filter((t) => t === 'Card')).toHaveLength(1);
    expect(options).toEqual(expect.arrayContaining(['Cash', 'Card', 'Other']));
  });

  it('keeps keys unique even when an invalid spec repeats a component id', () => {
    const spec: KalamSpec = JSON.parse(JSON.stringify(expenses)) as KalamSpec;
    spec.screens[1].children.push({ ...spec.screens[0].children[0] } as KalamSpec['screens'][number]['children'][number]);
    const keys = collectTranslatableLabels(spec).map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('sourceHash', () => {
  it('is stable for the same labels and ignores their order', () => {
    const labels = collectTranslatableLabels(expenses);
    expect(sourceHash(labels)).toBe(sourceHash(collectTranslatableLabels(expenses)));
    expect(sourceHash([...labels].reverse())).toBe(sourceHash(labels));
  });

  it('changes when a label changes, but not when only the theme or version changes', () => {
    const base = sourceHash(collectTranslatableLabels(expenses));
    const relabelled = JSON.parse(JSON.stringify(expenses)) as KalamSpec;
    relabelled.screens[0].title = 'My spending';
    expect(sourceHash(collectTranslatableLabels(relabelled))).not.toBe(base);

    const recoloured = JSON.parse(JSON.stringify(expenses)) as KalamSpec;
    recoloured.theme.primary = '#112233';
    recoloured.version += 1;
    expect(sourceHash(collectTranslatableLabels(recoloured))).toBe(base);
  });
});

describe('applyTranslatedView', () => {
  const labels = collectTranslatableLabels(expenses);

  it('replaces display text and leaves the original spec untouched', () => {
    const before = JSON.stringify(expenses);
    const view = applyTranslatedView(expenses, fake(labels), 'hi');
    expect(JSON.stringify(expenses)).toBe(before);
    expect(view.screens[0].title).toBe(`अनुवाद ${expenses.screens[0].title}`);
    expect(view.lang).toBe('hi');
    expect(view).not.toBe(expenses);
  });

  it('keeps ids, formulas, action wiring and intents exactly as they were', () => {
    const view = applyTranslatedView(expenses, fake(labels));
    expect(view.screens.map((s) => s.id)).toEqual(expenses.screens.map((s) => s.id));
    expect(view.screens.flatMap((s) => s.children.map((c) => c.id))).toEqual(expenses.screens.flatMap((s) => s.children.map((c) => c.id)));
    expect(view.screens.flatMap((s) => s.children).filter((c) => c.type === 'stat').map((c) => c.expr))
      .toEqual(expenses.screens.flatMap((s) => s.children).filter((c) => c.type === 'stat').map((c) => c.expr));
    expect(Object.keys(view.collections)).toEqual(Object.keys(expenses.collections));
    expect(view.intents).toEqual(expenses.intents);
    expect(view.initialScreen).toBe(expenses.initialScreen);
    const saveBefore = expenses.actions.save_expense;
    const saveAfter = view.actions.save_expense;
    expect(saveAfter.type).toBe(saveBefore.type);
    expect(saveAfter.type === 'insert' && saveAfter.then?.navigate).toBe(saveBefore.type === 'insert' && saveBefore.then?.navigate);
    expect(saveAfter.type === 'insert' && saveAfter.then?.feedback).toBe('अनुवाद Expense saved');
  });

  it('falls back to the original text for missing or empty translations', () => {
    const strings = { ...fake(labels), [`screen.${expenses.screens[0].id}.title`]: '   ' };
    delete (strings as Record<string, string>)[`screen.${expenses.screens[1].id}.title`];
    const view = applyTranslatedView(expenses, strings);
    expect(view.screens[0].title).toBe(expenses.screens[0].title);
    expect(view.screens[1].title).toBe(expenses.screens[1].title);
  });

  it('ignores keys that do not belong to the app', () => {
    const view = applyTranslatedView(expenses, { '__proto__': 'x', 'nope.key': 'y' } as Record<string, string>);
    expect(JSON.stringify(view)).toBe(JSON.stringify(expenses));
  });

  it('still validates as a KalamSpec when translations fit the limits', () => {
    const r = validateSpec(applyTranslatedView(expenses, fake(labels), 'hi'));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('maps enum option display names without touching the stored option values', () => {
    const spec: KalamSpec = JSON.parse(JSON.stringify(expenses)) as KalamSpec;
    const col = Object.values(spec.collections)[0];
    col.fields.mode_of_pay = { type: 'enum', label: 'Paid by', options: ['Cash', 'Card'] };
    const all = collectTranslatableLabels(spec);
    const strings = fake(all);
    const view = translatedView(spec, strings, 'hi');
    const viewCol = Object.values(view.spec.collections)[0];
    const field = viewCol.fields.mode_of_pay;
    expect(field.type === 'enum' && field.options).toEqual(['Cash', 'Card']);
    expect(view.optionLabels.Cash).toBe('अनुवाद Cash');
    expect(view.optionLabels.Card).toBe('अनुवाद Card');
    expect(field.label).toBe('अनुवाद Paid by');
  });

  it('translates the labels of a Hindi app into English the same way', () => {
    const k = collectTranslatableLabels(kirana);
    const view = applyTranslatedView(kirana, Object.fromEntries(k.map((l) => [l.key, `EN ${l.text}`])), 'en');
    expect(view.lang).toBe('en');
    expect(view.screens[0].title).toBe(`EN ${kirana.screens[0].title}`);
  });
});
