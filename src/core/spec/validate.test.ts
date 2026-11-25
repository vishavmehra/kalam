import { describe, expect, it } from 'vitest';
import { loadFixture, loadFixtures } from '../../../tests/fixtures/specs/load';
import { validateSpec } from './index';
import { MAX_SPEC_BYTES } from './validate';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test mutation of fixture JSON
const clone = (name: string, kind: 'valid' | 'invalid' = 'valid'): Json => loadFixture(kind, name) as Json;
const codes = (input: unknown) => validateSpec(input).errors.map((e) => e.code);
const warningCodes = (input: unknown) => validateSpec(input).warnings.map((e) => e.code);
const errorAt = (input: unknown, code: string) => validateSpec(input).errors.find((e) => e.code === code);

describe('validateSpec — fixtures', () => {
  for (const { name, json } of loadFixtures('valid')) {
    it(`accepts valid fixture ${name}`, () => {
      const r = validateSpec(json);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.spec?.id).toBe(json.id);
    });
  }

  const expected: Record<string, Array<[string, string]>> = {
    'unknown-component': [['UNKNOWN_COMPONENT_TYPE', 'screens[0].children[1].type']],
    'unknown-action': [['UNKNOWN_ACTION', 'screens[0].children[1].action']],
    'invalid-formula': [['INVALID_FORMULA', 'screens[0].children[1].expr'], ['INVALID_FORMULA', 'screens[0].children[2].expr']],
    'invalid-reference': [['UNKNOWN_COLLECTION', 'screens[0].children[0].source'], ['UNKNOWN_SCREEN', 'actions.go_add.screen']],
    'too-many-screens': [['RESOURCE_LIMIT', 'screens']],
    'eval-injection': [['INVALID_FORMULA', 'screens[0].children[1].expr']],
    'script-injection': [['SECURITY_CONTENT', 'screens[0].children[1].label'], ['SECURITY_CONTENT', 'screens[0].children[2].a11yLabel']],
  };
  for (const { name, json } of loadFixtures('invalid')) {
    it(`rejects invalid fixture ${name}`, () => {
      const r = validateSpec(json);
      expect(r.ok).toBe(false);
      expect(r.spec).toBeUndefined();
      const got = r.errors.map((e) => [e.code, e.path]);
      for (const pair of expected[name] ?? [['?', '?']]) expect(got).toContainEqual(pair);
    });
  }

  it('marks security problems as not recoverable', () => {
    const r = validateSpec(clone('script-injection', 'invalid'));
    expect(r.errors.every((e) => e.code !== 'SECURITY_CONTENT' || !e.recoverable)).toBe(true);
  });

  it('does not mutate its input', () => {
    const input = clone('kirana-credit-book');
    const before = JSON.stringify(input);
    validateSpec(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('validateSpec — layers', () => {
  it('accepts JSON text and reports INVALID_JSON', () => {
    expect(validateSpec(JSON.stringify(clone('habit-counter'))).ok).toBe(true);
    expect(codes('{"id": ')).toEqual(['INVALID_JSON']);
    expect(codes(42)).toEqual(['SCHEMA_INVALID']);
    expect(codes(null)).toEqual(['SCHEMA_INVALID']);
  });

  it('rejects newer major schema versions without interpreting them', () => {
    const s = clone('habit-counter');
    s.schemaVersion = '2.0.0';
    s.screens = 'garbage';
    const r = validateSpec(s);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ code: 'UNSUPPORTED_SCHEMA_VERSION', recoverable: false });
  });

  it('rejects a newer minor version with a clear message, never a warning (ADR-024)', () => {
    const s = clone('habit-counter');
    s.schemaVersion = '1.4.0';
    const r = validateSpec(s);
    expect(r.ok).toBe(false);
    expect(r.spec).toBeUndefined();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ code: 'UNSUPPORTED_SCHEMA_VERSION', path: 'schemaVersion', recoverable: false });
    expect(r.errors[0].message).toContain('Update Kalam');
    expect(r.errors[0].message).toContain('1.4.0');
    expect(r.warnings.map((w) => w.code)).not.toContain('NEWER_SCHEMA_MINOR');
  });

  it('does not read a newer minor document, even when its body is not valid', () => {
    const s = clone('habit-counter');
    s.schemaVersion = '1.1.0';
    s.screens = 'garbage';
    expect(codes(s)).toEqual(['UNSUPPORTED_SCHEMA_VERSION']);
  });

  it('accepts the current minor with any patch number', () => {
    const s = clone('habit-counter');
    s.schemaVersion = '1.0.7';
    expect(validateSpec(s).ok).toBe(true);
    expect(warningCodes(s)).not.toContain('NEWER_SCHEMA_MINOR');
  });

  it('rejects an older major as needing migration', () => {
    const s = clone('habit-counter');
    s.schemaVersion = '0.9.0';
    expect(errorAt(s, 'UNSUPPORTED_SCHEMA_VERSION')?.message).toContain('migrated');
  });

  it('maps Zod problems to readable paths', () => {
    const s = clone('habit-counter');
    s.screens[0].children[0].colour = 'red';
    s.actions.add_glass = { type: 'teleport' };
    s.collections.extra = { fields: { x: { type: 'money', label: 'X' } } };
    const r = validateSpec(s);
    expect(r.errors.map((e) => [e.code, e.path])).toEqual(expect.arrayContaining([
      ['UNKNOWN_PROPERTY', 'screens[0].children[0]'],
      ['UNKNOWN_ACTION_TYPE', 'actions.add_glass.type'],
      ['UNKNOWN_FIELD_TYPE', 'collections.extra.fields.x.type'],
    ]));
  });

  it('enforces resource limits that Zod does not', () => {
    const s = clone('expense-tracker');
    for (let i = 0; i < 10; i++) s.collections[`extra_${i}`] = { fields: { a: { type: 'text', label: 'A' } } };
    expect(errorAt(s, 'RESOURCE_LIMIT')?.path).toBe('collections');
  });

  it('rejects reserved and duplicate ids', () => {
    const s = clone('expense-tracker');
    s.collections.constructor = { fields: { a: { type: 'text', label: 'A' } } };
    s.collections.expenses.fields.today = { type: 'text', label: 'Today' };
    // The reminders feature keeps its rules in app state under this name (N12), so apps may not use it.
    s.collections.kalam_reminders = { fields: { a: { type: 'text', label: 'A' } } };
    s.screens[1].children[1].id = 'amount_input';
    s.screens[1].id = 'home';
    const r = validateSpec(s);
    expect(r.errors.map((e) => [e.code, e.path])).toEqual(expect.arrayContaining([
      ['RESERVED_ID', 'collections.constructor'],
      ['RESERVED_ID', 'collections.expenses.fields.today'],
      ['RESERVED_ID', 'collections.kalam_reminders'],
      ['DUPLICATE_ID', 'screens[1].children[1].id'],
      ['DUPLICATE_ID', 'screens[1].id'],
    ]));
  });

  it('reserves kalam_reminders as a component id too, where a counter could clobber the rules', () => {
    const s = clone('habit-counter');
    s.screens[0].children[0].id = 'kalam_reminders';
    expect(errorAt(s, 'RESERVED_ID')).toMatchObject({ path: 'screens[0].children[0].id' });
  });

  it('checks screen and action references', () => {
    const s = clone('tailor-measurement-book');
    s.initialScreen = 'start';
    s.actions.save_order.then.navigate = 'nowhere';
    s.intents.dance = ['dance'];
    const r = validateSpec(s);
    expect(r.errors.map((e) => [e.code, e.path])).toEqual(expect.arrayContaining([
      ['UNKNOWN_SCREEN', 'initialScreen'],
      ['UNKNOWN_SCREEN', 'actions.save_order.then.navigate'],
      ['UNKNOWN_ACTION', 'intents.dance'],
    ]));
  });

  it('checks input bindings against the screen form collection', () => {
    const s = clone('tailor-measurement-book');
    const kids = s.screens[1].children;
    kids[0].field = 'phone'; // unknown field
    kids[2] = { id: 'chest_input', type: 'textInput', label: 'Chest', field: 'chest' }; // number field via textInput
    kids[1].options = ['kurta', 'saree']; // not a subset
    const r = validateSpec(s);
    expect(r.errors.map((e) => [e.code, e.path])).toEqual(expect.arrayContaining([
      ['UNKNOWN_FIELD', 'screens[1].children[0].field'],
      ['FIELD_TYPE_MISMATCH', 'screens[1].children[2].field'],
      ['INVALID_OPTIONS', 'screens[1].children[1].options'],
    ]));
  });

  it('requires options on a choice without a form collection', () => {
    const s = clone('gst-calculator');
    delete s.screens[0].children[1].options;
    expect(errorAt(s, 'MISSING_OPTIONS')?.path).toBe('screens[0].children[1]');
  });

  it('checks list references', () => {
    const s = clone('medicine-tracker');
    const list = s.screens[0].children[2];
    list.toggleField = 'medicine';
    list.secondary = 'dose_time';
    list.sort = { field: 'when', direction: 'asc' };
    list.detailScreen = 'detail';
    list.filter = 'colour == today';
    const r = validateSpec(s);
    expect(r.errors.map((e) => [e.code, e.path])).toEqual(expect.arrayContaining([
      ['FIELD_TYPE_MISMATCH', 'screens[0].children[2].toggleField'],
      ['UNKNOWN_FIELD', 'screens[0].children[2].secondary'],
      ['UNKNOWN_FIELD', 'screens[0].children[2].sort.field'],
      ['UNKNOWN_SCREEN', 'screens[0].children[2].detailScreen'],
      ['INVALID_FORMULA', 'screens[0].children[2].filter'],
    ]));
  });

  it('checks AI block references and compatibility', () => {
    const s = clone('expense-tracker');
    s.aiBlocks.categorise.inputField = 'description';
    s.actions.suggest_category.aiBlock = 'missing_block';
    s.screens[1].children.push({ id: 'receipt', type: 'photo', label: 'Receipt', aiBlock: 'categorise' });
    s.aiBlocks.receipt_reader = { kind: 'extractFromPhoto', target: 'receipts', prompt: 'Read', verified: 'unverified' };
    const r = validateSpec(s);
    expect(r.errors.map((e) => [e.code, e.path])).toEqual(expect.arrayContaining([
      ['UNKNOWN_FIELD', 'aiBlocks.categorise.inputField'],
      ['UNKNOWN_AI_BLOCK', 'actions.suggest_category.aiBlock'],
      ['INCOMPATIBLE_AI_BLOCK', 'screens[1].children[6].aiBlock'],
      ['UNKNOWN_COLLECTION', 'aiBlocks.receipt_reader.target'],
    ]));
  });

  it('checks counter action targets (counter id or numeric form field)', () => {
    const s = clone('habit-counter');
    s.actions.add_glass.target = 'tea';
    expect(errorAt(s, 'UNKNOWN_TARGET')?.path).toBe('actions.add_glass.target');
    const gst = clone('gst-calculator');
    gst.actions.bump = { type: 'increment', target: 'amount' };
    gst.actions.bad = { type: 'increment', target: 'rate' };
    expect(validateSpec(gst).errors.map((e) => e.path)).toEqual(['actions.bad.target']);
  });

  it('validates stat formulas with screen form fields and counter state keys', () => {
    const s = clone('habit-counter');
    s.screens[0].children[2].expr = 'state.water + state.pushups + form.x';
    expect(errorAt(s, 'INVALID_FORMULA')?.message).toMatch(/form\.x/);
  });

  it('produces the documented warnings', () => {
    const s = clone('notes-app');
    s.collections.archive = { label: 'Archive', fields: { title: { type: 'text', label: 'Title' } } };
    s.screens.push({ id: 'orphan', title: 'Orphan', children: [{ id: 'orphan_text', type: 'text', label: 'Lonely' }] });
    s.screens[1].children.push({ id: 'del_here', type: 'bigButton', label: 'A very long button label that keeps going and going', action: 'delete_note' });
    const w = validateSpec(s).warnings.map((x) => [x.code, x.path]);
    expect(validateSpec(s).ok).toBe(true);
    expect(w).toEqual(expect.arrayContaining([
      ['UNUSED_COLLECTION', 'collections.archive'],
      ['UNREACHABLE_SCREEN', 'screens[3]'],
      ['NO_SELECTED_RECORD', 'screens[1].children[6].action'],
      ['LONG_LABEL', 'screens[1].children[6].label'],
    ]));
    expect(warningCodes(clone('tailor-measurement-book'))).toContain('UNVERIFIED_AI_BLOCK');
  });

  it('blocks script, javascript: and data:text/html anywhere, including keys', () => {
    const s = clone('habit-counter');
    s.description = 'see DATA:text/html;base64,xyz';
    s.meta.tags = ['ok', 'JavaScript :void(0)'];
    expect(validateSpec(s).errors.map((e) => [e.code, e.path])).toEqual(expect.arrayContaining([
      ['SECURITY_CONTENT', 'description'],
      ['SECURITY_CONTENT', 'meta.tags[1]'],
    ]));
  });

  it('never resolves references to Object.prototype members', () => {
    const s = clone('medicine-tracker');
    const [home, add] = s.screens;
    add.form = 'constructor';
    add.children[1].field = 'constructor';
    home.children[2].source = 'constructor';
    home.children[3].action = 'constructor';
    add.children[0].aiBlock = 'constructor';
    s.actions.go_add = { type: 'navigate', screen: 'constructor' };
    s.actions.bump = { type: 'increment', target: 'constructor' };
    s.actions.ai = { type: 'runAI', aiBlock: 'constructor' };
    s.aiBlocks.read_label.target = 'constructor';
    s.intents.constructor = ['hello'];
    s.initialScreen = 'constructor';
    let r: ReturnType<typeof validateSpec> | undefined;
    expect(() => { r = validateSpec(s); }).not.toThrow();
    expect(r?.ok).toBe(false);
    expect(new Set(r?.errors.map((e) => e.code))).toEqual(new Set([
      'UNKNOWN_COLLECTION', 'UNKNOWN_ACTION', 'UNKNOWN_AI_BLOCK', 'UNKNOWN_SCREEN', 'UNKNOWN_TARGET', 'MISSING_OPTIONS',
    ]));
  });

  it('rejects absurdly deep or large input', () => {
    const s = clone('habit-counter');
    let deep: Json = {};
    s.meta.extra = deep;
    for (let i = 0; i < 40; i++) { deep.next = {}; deep = deep.next; }
    expect(codes(s)).toContain('SPEC_TOO_DEEP');
  });

  describe('size cap (docs/11 §11.1, ADR-024: 100 KB)', () => {
    const padded = (bytes: number): string => {
      const wrapper = JSON.stringify({ pad: '' }).length;
      return JSON.stringify({ pad: 'x'.repeat(bytes - wrapper) });
    };

    it('rejects JSON text over 100 KB and says it cannot be recovered', () => {
      expect(MAX_SPEC_BYTES).toBe(100_000);
      expect(codes(padded(100_001))).toEqual(['SPEC_TOO_LARGE']);
      expect(codes('x'.repeat(1_000_001))).toEqual(['SPEC_TOO_LARGE']);
      expect(errorAt(padded(100_001), 'SPEC_TOO_LARGE')?.recoverable).toBe(false);
    });

    it('allows text of exactly 100 KB through to the later layers', () => {
      expect(codes(padded(100_000))).not.toContain('SPEC_TOO_LARGE');
    });

    it('counts UTF-8 bytes, not characters', () => {
      // 34,000 Devanagari letters are 34,000 characters but 102,000 bytes.
      const hindi = JSON.stringify({ pad: 'क'.repeat(34_000) });
      expect(hindi.length).toBeLessThan(MAX_SPEC_BYTES);
      expect(codes(hindi)).toEqual(['SPEC_TOO_LARGE']);
      expect(codes(JSON.stringify({ pad: 'क'.repeat(33_000) }))).not.toContain('SPEC_TOO_LARGE');
    });

    it('caps an object too, since compiler, edit, restore and Bazaar input arrive as objects', () => {
      const big = { ...clone('habit-counter'), pad: 'x'.repeat(100_001) };
      expect(codes(big)).toEqual(['SPEC_TOO_LARGE']);
      expect(errorAt(big, 'SPEC_TOO_LARGE')?.recoverable).toBe(false);
      expect(codes({ ...clone('habit-counter'), pad: 'क'.repeat(34_000) })).toEqual(['SPEC_TOO_LARGE']);
    });

    it('does not throw on an object JSON cannot print', () => {
      const cyclic: Json = {};
      cyclic.self = cyclic;
      expect(() => validateSpec(cyclic)).not.toThrow();
      expect(validateSpec(cyclic).ok).toBe(false);
    });

    it('every valid fixture is well under the cap', () => {
      for (const { json } of loadFixtures('valid')) expect(new TextEncoder().encode(JSON.stringify(json)).length).toBeLessThan(MAX_SPEC_BYTES);
    });
  });
});
