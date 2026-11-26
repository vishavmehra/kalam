import { describe, expect, it } from 'vitest';
import { decodeImportLink } from '@/core/import-link';
import { validateSpec } from '@/core/spec/validate';
import {
  buildFromTemplateTool, checkFormulaTool, classifyRequestTool, computeReportTool, diffSpecsTool, explainFormulaTool,
  explainSpecTool, listTemplatesTool, packageAppTool, specSchemaTool, validateSpecTool,
} from '../src/tools';
import { data, fixture, invalidFixture, text, NO_DASH_OR_BANG } from './helpers';

const expenses = fixture('expense-tracker');
const habits = fixture('habit-counter');

describe('kalam_spec_schema', () => {
  it('returns the JSON Schema and a catalogue read from the Zod schemas', () => {
    const d = data(specSchemaTool({ section: 'all' }));
    expect(d.jsonSchema.type).toBe('object');
    expect(d.jsonSchema.required).toEqual(expect.arrayContaining(['id', 'screens', 'initialScreen']));
    expect(d.catalogue.components.map((c: { name: string }) => c.name)).toContain('bigButton');
    const button = d.catalogue.components.find((c: { name: string }) => c.name === 'bigButton');
    expect(button.required).toEqual(expect.arrayContaining(['id', 'label', 'action']));
    expect(d.catalogue.limits.screens).toBe(8);
    expect(data(specSchemaTool({ section: 'json_schema' })).catalogue).toBeUndefined();
  });
  it('defaults to the compact catalogue, with compact JSON text', () => {
    const r = specSchemaTool({});
    expect(data(r).jsonSchema).toBeUndefined();
    expect(data(r).catalogue.components.length).toBeGreaterThan(5);
    expect(text(r)).toBe(JSON.stringify(data(r)));
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
    expect(text(r)).not.toMatch(NO_DASH_OR_BANG);
    expect(data(r).summary.collections[0].name).toBe('Expenses');
  });
  it('refuses an invalid spec with the errors', () => {
    const r = explainSpecTool({ spec: invalidFixture('unknown-action') });
    expect(r.isError).toBe(true);
    expect(data(r).errors.length).toBeGreaterThan(0);
  });
});

describe('kalam_diff_specs', () => {
  it('describes changes in plain English', () => {
    const r = diffSpecsTool({ before: expenses, after: { ...expenses, name: 'Shop Expenses' } });
    expect(r.isError).toBeFalsy();
    const d = data(r);
    expect(d.changes.length).toBeGreaterThan(0);
    expect(d.changes[0]).toMatchObject({ category: expect.any(String), impact: expect.any(String), text: expect.any(String) });
    expect(d.summary).not.toMatch(NO_DASH_OR_BANG);
    expect(data(diffSpecsTool({ before: expenses, after: expenses })).changes).toEqual([]);
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
    // In a list filter, bare names are fields, so the dependency is the listed collection.
    expect(filter.dependencies.collections).toEqual(['expenses']);
    expect(checkFormulaTool({ formula: 'amount > 1', spec: expenses, screenId: 'nowhere' }).isError).toBe(true);
    expect(checkFormulaTool({ formula: '1', sample: { now: 'not a date' } }).isError).toBe(true);
  });
  it('uses counters as state', () => {
    expect(data(checkFormulaTool({ formula: 'state.water + 1', spec: habits, sample: { state: { water: 2 } } })).result).toEqual({ value: 3 });
  });
});

describe('kalam_explain_formula', () => {
  it('checks the formula and explains it with the labels people see', () => {
    const d = data(explainFormulaTool({ formula: 'sum(expenses.amount)', spec: expenses, screenId: 'home' }));
    expect(d.valid).toBe(true);
    expect(d.explanation).toMatch(/amount/i);
    expect(d.explanation).not.toMatch(/expenses\.amount/);
    expect(data(explainFormulaTool({ formula: 'sum(nope.x)', spec: expenses })).valid).toBe(false);
  });
  it('explains a list filter with the field labels, not raw ids', () => {
    // A label that differs from the field id, so the test can tell them apart.
    const cols = expenses.collections as Record<string, { fields: Record<string, object> }>;
    const fields = { ...cols.expenses.fields, category: { ...cols.expenses.fields.category, label: 'Kind of spend' } };
    const spec = { ...expenses, collections: { ...cols, expenses: { ...cols.expenses, fields } } };
    const d = data(explainFormulaTool({ formula: 'category == "Food"', spec, listCollection: 'expenses' }));
    expect(d.valid).toBe(true);
    expect(d.dependencies.collections).toEqual(['expenses']);
    expect(d.explanation).toMatch(/kind of spend/i);
    expect(d.explanation).not.toMatch(/\bcategory\b/);
    expect(d.explanation).not.toMatch(NO_DASH_OR_BANG);
  });
});

describe('kalam_compute_report', () => {
  const records: Array<{ values: Record<string, string | number | boolean | null> }> = [
    { values: { amount: 120, category: 'Food', date: '2026-11-20', secret: 'dropped' } },
    { values: { amount: 80, category: 'Travel', date: '2026-11-21' } },
    { values: { amount: 40, category: 'Food', date: '2026-11-24' } },
  ];
  it('computes the suggested reports over the records passed in', () => {
    const d = data(computeReportTool({ spec: expenses, collection: 'expenses', records, now: '2026-11-25T10:00:00', timeZone: 'Asia/Kolkata' }));
    expect(d.records).toBe(3);
    expect(d.reports.length).toBeGreaterThan(0);
    const done = d.reports.filter((r: { result?: unknown }) => r.result);
    expect(done.length).toBeGreaterThan(0);
    expect(done[0].text).toEqual(expect.any(String));
    expect(JSON.stringify(d)).not.toContain('dropped');
  });
  it('runs one given definition, and rejects a bad one or a bad input', () => {
    const all = data(computeReportTool({ spec: expenses, collection: 'expenses', records, now: '2026-11-25T10:00:00' }));
    const def = all.reports[0].definition;
    const one = data(computeReportTool({ spec: expenses, collection: 'expenses', records, report: def, now: '2026-11-25T10:00:00' }));
    expect(one.reports).toHaveLength(1);
    expect(computeReportTool({ spec: expenses, collection: 'expenses', records, report: { ...def, metrics: [] } }).isError).toBe(true);
    expect(computeReportTool({ spec: expenses, collection: 'expenses', records, report: { ...def, sourceCollection: 'x' } }).isError).toBe(true);
    expect(computeReportTool({ spec: expenses, collection: 'orders', records: [] }).isError).toBe(true);
    expect(computeReportTool({ spec: expenses, collection: 'expenses', records, timeZone: 'Mars/Base' }).isError).toBe(true);
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
    expect(d.fileBytes).toBe(Buffer.byteLength(d.file));
    expect(d.howToOpen.join(' ')).toMatch(/\/import screen/);
    expect(d.howToOpen.join(' ')).not.toMatch(NO_DASH_OR_BANG);
  });
  it('counts bytes, not characters, and keeps file names ASCII', () => {
    const d = data(packageAppTool({ spec: { ...expenses, name: 'खर्च ट्रैकर' } }));
    expect(d.fileBytes).toBe(Buffer.byteLength(d.file));
    expect(d.fileBytes).toBeGreaterThan(d.file.length);
    expect(d.fileName).toBe(`${String(expenses.id)}.kalam.json`);
  });
  it('refuses an invalid spec', () => {
    expect(packageAppTool({ spec: invalidFixture('script-injection') }).isError).toBe(true);
  });
});
