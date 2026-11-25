import { describe, expect, it } from 'vitest';
import { decodeImportLink } from '@/core/import-link';
import { validateSpec } from '@/core/spec/validate';
import { optional } from '../src/optional';
import {
  buildFromTemplateTool, checkFormulaTool, classifyRequestTool, computeReportTool, diffSpecsTool, explainFormulaTool,
  explainSpecTool, listTemplatesTool, packageAppTool, specSchemaTool, validateSpecTool,
} from '../src/tools';
import { data, fixture, invalidFixture, text } from './helpers';

const expenses = fixture('expense-tracker');
const habits = fixture('habit-counter');

describe('kalam_spec_schema', () => {
  it('returns the JSON Schema and a catalogue read from the Zod schemas', () => {
    const d = data(specSchemaTool({}));
    expect(d.jsonSchema.type).toBe('object');
    expect(d.jsonSchema.required).toEqual(expect.arrayContaining(['id', 'screens', 'initialScreen']));
    expect(d.catalogue.components.map((c: { name: string }) => c.name)).toContain('bigButton');
    const button = d.catalogue.components.find((c: { name: string }) => c.name === 'bigButton');
    expect(button.required).toEqual(expect.arrayContaining(['id', 'label', 'action']));
    expect(d.catalogue.limits.screens).toBe(8);
    expect(data(specSchemaTool({ section: 'catalogue' })).jsonSchema).toBeUndefined();
  });
});

describe('kalam_validate_spec', () => {
  it('passes a valid spec', () => {
    const d = data(validateSpecTool({ spec: expenses }));
    expect(d.ok).toBe(true);
    expect(d.errors).toEqual([]);
  });
  it('gives path-level errors with a repair hint', () => {
    for (const name of ['unknown-component', 'invalid-reference', 'script-injection', 'too-many-screens']) {
      const d = data(validateSpecTool({ spec: invalidFixture(name) }));
      expect(d.ok, name).toBe(false);
      expect(d.errors[0].hint, name).toEqual(expect.any(String));
      expect(typeof d.errors[0].path).toBe('string');
    }
    expect(data(validateSpecTool({ spec: '{not json' })).errors[0].code).toBe('INVALID_JSON');
  });
});

describe('templates', () => {
  it('lists templates, ranked for a request, with parameter schemas', () => {
    const d = data(listTemplatesTool({ request: 'a simple counter for push ups' }));
    expect(d.templates.length).toBeGreaterThan(5);
    expect(d.templates[0].id).toBe('counter');
    expect(d.templates[0].params.type).toBe('object');
  });
  it('builds a valid spec without a model', () => {
    const r = buildFromTemplateTool({ templateId: 'expense_tracker', request: 'track my shop expenses in rupees', lang: 'en' });
    expect(r.isError).toBeFalsy();
    const d = data(r);
    expect(validateSpec(d.spec).ok).toBe(true);
    expect(d.source).toBe('template');
    expect(d.spec.id).toMatch(/^app_[0-9a-f]{8}$/);
  });
  it('rejects bad overrides', () => {
    const r = buildFromTemplateTool({ templateId: 'counter', params: { name: 42 } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/could not be built/);
  });
});

describe('kalam_classify_request', () => {
  it('names a template for a simple request', () => {
    const d = data(classifyRequestTool({ request: 'a checklist for packing' }));
    expect(d.classification.method).toBe('deterministic');
    expect(d.modelCalls).toBe(0);
    expect(d.classification.matchingTemplate).toBe('checklist');
    expect(d.next).toMatch(/kalam_build_from_template/);
  });
  it('sends a complex request to writing a spec', () => {
    const d = data(classifyRequestTool({
      request: 'clinic app with patients, doctors, appointments, payments, staff roles and monthly reports per doctor',
    }));
    expect(d.classification.complexity).not.toBe('simple');
    expect(d.next).toMatch(/Write a spec/);
  });
  it('classifies an edit and refuses an invalid existing spec', () => {
    expect(data(classifyRequestTool({ request: 'make the button blue', existingSpec: expenses })).templates).toEqual([]);
    expect(classifyRequestTool({ request: 'make it blue', existingSpec: { id: 'x' } }).isError).toBe(true);
  });
});

describe('kalam_explain_spec', () => {
  it('summarises in plain English without em dashes', () => {
    const r = explainSpecTool({ spec: expenses });
    expect(text(r)).toMatch(/^Daily Expenses: /);
    expect(text(r)).toMatch(/Screens:/);
    expect(text(r)).not.toMatch(/—/);
    expect(data(r).summary.collections[0].name).toBe('Expenses');
  });
  it('refuses an invalid spec with the errors', () => {
    const r = explainSpecTool({ spec: invalidFixture('unknown-action') });
    expect(r.isError).toBe(true);
    expect(data(r).errors.length).toBeGreaterThan(0);
  });
});

describe('kalam_diff_specs', () => {
  it('describes changes when src/core/history is in the build, and says so when it is not', () => {
    const after = { ...expenses, name: 'Shop Expenses' };
    const r = diffSpecsTool({ before: expenses, after });
    if (optional.describeSpecChanges) {
      expect(r.isError).toBeFalsy();
      expect(Array.isArray(data(r).changes)).toBe(true);
    } else {
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/not in this build/);
    }
    expect(diffSpecsTool({ before: expenses, after: { nope: true } }).isError).toBe(true);
  });
});

describe('kalam_check_formula', () => {
  it('checks syntax alone, then names against the app', () => {
    expect(data(checkFormulaTool({ formula: 'sum(expenses.amount)' })).valid).toBe(true);
    expect(data(checkFormulaTool({ formula: 'sum(expenses.amount' })).valid).toBe(false);
    const good = data(checkFormulaTool({ formula: 'sum(expenses.amount)', spec: expenses, screenId: 'home' }));
    expect(good).toMatchObject({ valid: true, dependencies: { collections: ['expenses'] } });
    const bad = data(checkFormulaTool({ formula: 'sum(orders.total)', spec: expenses, screenId: 'home' }));
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
  });
  it('rejects code and unknown functions instead of running them', () => {
    for (const formula of ['constructor.constructor("x")()', 'eval("1")', 'process.exit(1)', 'fetch("x")']) {
      expect(data(checkFormulaTool({ formula, spec: expenses })).valid, formula).toBe(false);
    }
  });
  it('calculates on sample data, list filters included', () => {
    const d = data(checkFormulaTool({
      formula: 'sum(filter(expenses, date == today).amount)', spec: expenses, screenId: 'home',
      sample: { collections: { expenses: [{ amount: 5, date: '2026-11-25' }, { amount: 7, date: '2026-11-24' }] }, now: '2026-11-25T10:00:00' },
    }));
    expect(d.result).toEqual({ value: 5 });
    const filter = data(checkFormulaTool({ formula: 'category == "Food"', spec: expenses, listCollection: 'expenses' }));
    expect(filter.valid).toBe(true);
    expect(checkFormulaTool({ formula: 'amount > 1', spec: expenses, screenId: 'nowhere' }).isError).toBe(true);
    expect(checkFormulaTool({ formula: '1', sample: { now: 'not a date' } }).isError).toBe(true);
  });
  it('uses counters as state', () => {
    expect(data(checkFormulaTool({ formula: 'state.water + 1', spec: habits, sample: { state: { water: 2 } } })).result).toEqual({ value: 3 });
  });
});

describe('kalam_explain_formula', () => {
  it('returns the check, plus an explanation when src/core/formula-assist is in the build', () => {
    const d = data(explainFormulaTool({ formula: 'sum(expenses.amount)', spec: expenses }));
    expect(d.valid).toBe(true);
    if (optional.explainFormula) expect(d.explanation).toBeTruthy();
    else expect(d.note).toMatch(/not in this build/);
  });
});

describe('kalam_compute_report', () => {
  it('checks the collection and records, and guards a missing report engine', () => {
    expect(computeReportTool({ spec: expenses, collection: 'orders', records: [] }).isError).toBe(true);
    const r = computeReportTool({ spec: expenses, collection: 'expenses', records: [{ values: { amount: 3, secret: 'x' } }] });
    if (optional.computeReport) expect(r.isError).toBeFalsy();
    else expect(text(r)).toMatch(/not in this build/);
  });
});

describe('kalam_package_app', () => {
  it('makes the single-app export file and an Open in Kalam link that decodes', () => {
    const r = packageAppTool({ spec: expenses }, { webBase: 'https://kalam.example.com', now: () => 1_800_000_000_000 });
    const d = data(r);
    const file = JSON.parse(d.file);
    expect(file).toMatchObject({ format: 'kalam-backup', formatVersion: 1, records: [], state: [] });
    expect(file.apps).toHaveLength(1);
    expect(file.apps[0].origin).toEqual({ route: 'import' });
    expect(file.apps[0].spec.aiBlocks.categorise.verified).toBe('unverified');
    expect(d.fileName).toBe('Daily-Expenses.kalam.json');
    expect(d.openInKalam).toMatch(/^kalam:\/\/import#k1\./);
    expect(d.webLink).toMatch(/^https:\/\/kalam\.example\.com\/import#k1\./);
    const back = decodeImportLink(d.webLink);
    expect(back.ok && back.spec.name).toBe('Daily Expenses');
  });
  it('refuses an invalid spec', () => {
    expect(packageAppTool({ spec: invalidFixture('script-injection') }).isError).toBe(true);
  });
});
