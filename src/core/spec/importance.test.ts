/**
 * Simple mode levels (docs/10 §4.3): `importance` is essential, standard or secondary; the 1.0 flag `secondary: true` still
 * means secondary; and the validator keeps "essential functionality must never disappear" by flagging a button or a needed
 * answer that would be folded away.
 */
import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import { IMPORTANCE_LEVELS, importanceOf, usesV11, validateSpec, type KalamSpec } from './index';

type Json = Record<string, any>;
const habit = (): Json => loadFixture('valid', 'habit-counter') as Json;
const expense = (): Json => loadFixture('valid', 'expense-tracker') as Json;
const warningCodes = (s: unknown) => validateSpec(s).warnings.map((w) => w.code);
const errorCodes = (s: unknown) => validateSpec(s).errors.map((e) => e.code);

describe('importanceOf', () => {
  it('reads the level, with standard when nothing is said', () => {
    expect(importanceOf({})).toBe('standard');
    for (const level of IMPORTANCE_LEVELS) expect(importanceOf({ importance: level })).toBe(level);
  });

  it('reads the 1.0 flag as secondary', () => {
    expect(importanceOf({ secondary: true })).toBe('secondary');
    expect(importanceOf({ secondary: false })).toBe('standard');
  });

  it('lets a level win over the flag, so essential is never folded by an old flag', () => {
    expect(importanceOf({ importance: 'essential', secondary: true })).toBe('essential');
    expect(importanceOf({ importance: 'standard', secondary: true })).toBe('standard');
  });

  it('does not read a list second-line field name as the flag', () => {
    expect(importanceOf({ secondary: 'phone' } as never)).toBe('standard');
  });
});

describe('the importance property in the schema', () => {
  it('accepts each level on any component', () => {
    for (const level of IMPORTANCE_LEVELS) {
      const s = habit();
      s.screens[0].children.forEach((c: Json) => (c.importance = level));
      // A button folded away is a warning, never an error, so a stored app still opens.
      expect(errorCodes(s), level).toEqual([]);
    }
  });

  it('refuses a level that does not exist, and a flag that is not true or false', () => {
    const s = habit();
    s.screens[0].children[0].importance = 'urgent';
    expect(errorCodes(s)).toContain('SCHEMA_INVALID');
    const t = habit();
    t.screens[0].children[0].importance = true;
    expect(errorCodes(t)).toContain('SCHEMA_INVALID');
  });

  it('counts as a 1.1 part, so an app that gains it is saved as 1.1 and an older Kalam refuses it clearly', () => {
    const s = habit();
    expect(s.schemaVersion).toBe('1.0.0');
    expect(usesV11(validateSpec(s).spec as KalamSpec)).toBe(false);
    s.screens[0].children[2].importance = 'secondary';
    const result = validateSpec(s);
    expect(result.ok).toBe(true);
    expect(usesV11(result.spec as KalamSpec)).toBe(true);
    expect(result.spec?.schemaVersion).toBe('1.1.0');
    expect(result.warnings.map((w) => w.code)).toContain('SCHEMA_VERSION_RAISED');
  });

  it('is accepted on a chart, whose own schema does not know it', () => {
    const s = loadFixture('valid', 'tailor-orders-linked', 'v11') as Json;
    const chart = s.screens.flatMap((x: Json) => x.children).find((c: Json) => c.type === 'chart');
    chart.importance = 'secondary';
    expect(errorCodes(s)).toEqual([]);
  });
});

describe('the validator and "essential functionality must never disappear"', () => {
  it('lets a stat or a note be secondary without a word', () => {
    const s = habit();
    s.screens[0].children[2].importance = 'secondary';
    expect(warningCodes(s)).not.toContain('SIMPLE_MODE_HIDES_ESSENTIAL');
  });

  it('lets a helper button be secondary while another button on the screen still saves', () => {
    const s = expense();
    const helper = s.screens.flatMap((x: Json) => x.children).find((c: Json) => c.id === 'suggest_button');
    expect(helper.secondary).toBe(true);
    expect(warningCodes(s)).not.toContain('SIMPLE_MODE_HIDES_ESSENTIAL');
  });

  it('warns when every button that saves on a screen would be folded away, by either spelling', () => {
    const level = expense();
    const flag = expense();
    const saves = (s: Json) => {
      const screen = s.screens.find((x: Json) => x.form === 'expenses' && x.children.some((c: Json) => c.type === 'bigButton' && s.actions[c.action]?.type === 'insert'));
      return { screen, buttons: screen.children.filter((c: Json) => c.type === 'bigButton' && ['insert', 'update', 'delete'].includes(s.actions[c.action]?.type)) };
    };
    saves(level).buttons.forEach((c: Json) => (c.importance = 'secondary'));
    saves(flag).buttons.forEach((c: Json) => (c.secondary = true));
    for (const s of [level, flag]) {
      const w = validateSpec(s).warnings.find((x) => x.code === 'SIMPLE_MODE_HIDES_ESSENTIAL');
      expect(w?.message).toContain('Every button that saves');
      expect(w?.path).toMatch(/^screens\[\d+\]\.children\[\d+\]$/);
    }
  });

  it('warns about an input whose answer the form needs, and only that input', () => {
    const s = expense();
    const form = s.screens.find((x: Json) => x.form === 'expenses');
    const inputs = form.children.filter((c: Json) => c.field);
    const required = inputs.find((c: Json) => s.collections.expenses.fields[c.field].required);
    const optional = inputs.find((c: Json) => !s.collections.expenses.fields[c.field].required);
    required.importance = 'secondary';
    optional.importance = 'secondary';
    const w = validateSpec(s).warnings.filter((x) => x.code === 'SIMPLE_MODE_HIDES_ESSENTIAL');
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain(required.id);
  });

  it('says so when the level and the old flag disagree, and the level wins', () => {
    const s = habit();
    s.screens[0].children[2].importance = 'essential';
    s.screens[0].children[2].secondary = true;
    expect(warningCodes(s)).toContain('IMPORTANCE_CONFLICT');
    // Same words twice is not a conflict.
    const same = habit();
    same.screens[0].children[2].importance = 'secondary';
    same.screens[0].children[2].secondary = true;
    expect(warningCodes(same)).not.toContain('IMPORTANCE_CONFLICT');
  });

  it('keeps every stored fixture free of these warnings', () => {
    for (const name of ['habit-counter', 'expense-tracker', 'kirana-credit-book', 'notes-app', 'medicine-tracker']) {
      const codes = warningCodes(loadFixture('valid', name));
      expect(codes, name).not.toContain('SIMPLE_MODE_HIDES_ESSENTIAL');
      expect(codes, name).not.toContain('IMPORTANCE_CONFLICT');
    }
  });
});
