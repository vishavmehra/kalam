import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '@/core/spec';
import { hintFor, specCatalogue, specJsonSchema } from '../src/catalogue';
import { createKalamServer } from '../src/server';
import { explainSpecTool, packageAppTool, specSchemaTool, validateSpecTool } from '../src/tools';
import { connect, data, fixture, NO_DASH_OR_BANG, resourceText } from './helpers';

type Obj = Record<string, unknown>;
type Named = { name: string; required: string[]; description: string };

/** The expense tracker plus every 1.1 part: a link, a chart, a timer, a reminder, a signature, layout, style and sections. */
function spec11(): Obj {
  const s = structuredClone(fixture('expense-tracker')) as Obj & { screens: Obj[]; collections: Obj };
  s.schemaVersion = '1.1.0';
  const expenses = s.collections.expenses as { fields: Obj };
  expenses.fields.vendor = { type: 'text', label: 'Vendor', ref: { collection: 'vendors', display: 'name', onDelete: 'clear' } };
  expenses.fields.signed = { type: 'text', label: 'Signed' };
  s.collections.vendors = { label: 'Vendors', fields: { name: { type: 'text', label: 'Name' } } };
  const home = s.screens[0] as { children: Obj[]; layout?: Obj[] };
  home.children.splice(2, 0, {
    id: 'by_category', type: 'chart', label: 'By category', chart: 'bar', source: 'expenses', metric: 'sum', valueField: 'amount', groupBy: 'category',
  });
  (home.children[1] as Obj).style = { tone: 'primary', emphasis: 'strong' };
  home.layout = [{ type: 'row', children: ['today_total', 'all_total'] }];
  const add = s.screens[1] as { children: Obj[] };
  add.children.splice(2, 0,
    { id: 'vendor_input', type: 'textInput', label: 'Vendor', field: 'vendor' },
    { id: 'work_timer', type: 'timer', label: 'Time spent', mode: 'stopwatch' },
    { id: 'bill_reminder', type: 'reminder', label: 'Remind me', source: 'expenses', dateField: 'date' },
    { id: 'sign_box', type: 'signature', label: 'Sign here', field: 'signed' },
  );
  s.permissions = [{ kind: 'notifications', reason: 'To remind you about bills' }];
  s.settings = { currency: 'INR', timeFormat: '24h' };
  s.accessibility = { summary: 'Write down spending and see totals.', suggestedModes: ['large'] };
  s.localization = { terminology: [{ term: 'Kalam', keep: true }] };
  return s;
}

describe('catalogue: KalamSpec 1.1', () => {
  const catalogue = specCatalogue();
  const components = catalogue.components as Named[];

  it('lists chart, timer, reminder and signature, each with a description and its required properties', () => {
    for (const name of ['chart', 'timer', 'reminder', 'signature']) {
      const c = components.find((x) => x.name === name);
      expect(c, name).toBeDefined();
      expect(c!.description, name).not.toBe('');
      expect(catalogue.known.componentTypes, name).toContain(name);
    }
    expect(components.find((c) => c.name === 'chart')!.required).toEqual(expect.arrayContaining(['id', 'label', 'chart', 'source', 'metric']));
    expect(components.find((c) => c.name === 'timer')!.required).toEqual(expect.arrayContaining(['id', 'label', 'mode']));
    expect(components.find((c) => c.name === 'reminder')!.required).toEqual(expect.arrayContaining(['source', 'dateField']));
    expect(components.find((c) => c.name === 'signature')!.required).toEqual(expect.arrayContaining(['label', 'field']));
  });

  it('describes every component the schema knows (no drift)', () => {
    expect(components.filter((c) => !c.description).map((c) => c.name)).toEqual([]);
  });

  it('describes layout groups, links, style and the new sections from the schema constants', () => {
    const v = catalogue.v11;
    expect(v.summary).toContain(SCHEMA_VERSION);
    expect(v.components).toEqual(['chart', 'timer', 'reminder', 'signature']);
    expect(v.layout.groupProperties.type).toEqual(['row', 'grid', 'card']);
    expect(v.layout.rules).toContain(`${catalogue.limits.layoutNodesPerScreen} groups`);
    expect(Object.keys(v.relations.onDelete)).toEqual(['restrict', 'cascade', 'clear']);
    expect(v.style.properties.tone).toContain('danger');
    expect(v.style.properties.size).toEqual(['small', 'medium', 'large']);
    expect(v.chart.kinds).toEqual(['bar', 'line', 'donut']);
    expect(v.sections.permissions.kinds).toEqual(['camera', 'notifications']);
    expect(v.sections.accessibility.suggestedModes).toEqual(['large', 'highContrast', 'simple', 'readAloud']);
    expect(Object.keys(v.sections)).toEqual(['permissions', 'accessibility', 'settings', 'localization']);
    expect(catalogue.limits.layoutDepth).toBe(3);
  });

  it('is returned by the default kalam_spec_schema call and follows the copy rule', () => {
    expect(data(specSchemaTool({})).catalogue.v11.layout.how).toEqual(expect.any(String));
    expect(JSON.stringify(catalogue.v11)).not.toMatch(NO_DASH_OR_BANG);
  });

  it('has a plain hint for every new validation code', () => {
    const codes = ['INVALID_CHART', 'MISSING_DURATION', 'INVALID_LAYOUT', 'INVALID_RELATION', 'INVALID_TERM', 'PERMISSION_MISSING',
      'PERMISSION_UNUSED', 'SORT_BY_LINK', 'IGNORED_PROPERTY', 'SCHEMA_VERSION_RAISED', 'MISSING_FORM', 'FIELD_NOT_SHOWN', 'NO_OP_UPDATE'];
    for (const code of codes) {
      expect(hintFor(code), code).toEqual(expect.any(String));
      expect(hintFor(code), code).not.toMatch(NO_DASH_OR_BANG);
    }
  });
});

describe('the JSON Schema and the schema resource', () => {
  it('knows the 1.1 parts', () => {
    const text = JSON.stringify(specJsonSchema());
    for (const part of ['"chart"', '"timer"', '"reminder"', '"signature"', '"layout"', '"onDelete"', '"style"', '"permissions"', '"terminology"']) {
      expect(text, part).toContain(part);
    }
  });
  it('serves the same schema as kalam://schema', async () => {
    const client = await connect(createKalamServer());
    const served = JSON.parse(resourceText(await client.readResource({ uri: 'kalam://schema' })));
    expect(served.title).toBe(`KalamSpec ${SCHEMA_VERSION}`);
    expect(JSON.stringify(served)).toContain('"signature"');
    await client.close();
  });
});

describe('a spec that uses the 1.1 parts', () => {
  it('validates, explains and packages', () => {
    const spec = spec11();
    const v = data(validateSpecTool({ spec }));
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(data(explainSpecTool({ spec })).text).toEqual(expect.any(String));
    const pkg = packageAppTool({ spec });
    expect(pkg.isError).toBeFalsy();
    expect(JSON.stringify(data(pkg))).toContain('1.1.0');
  });

  it('gives a repair hint for every 1.1 mistake', () => {
    const s = spec11() as Obj & { screens: Array<{ children: Obj[]; layout?: Obj[] }>; collections: { expenses: { fields: Obj } }; permissions: Obj[]; localization: Obj };
    const home = s.screens[0]!;
    const add = s.screens[1]!;
    home.children.find((c) => c.id === 'by_category')!.period = 'week'; // groupBy and period together
    add.children.find((c) => c.id === 'work_timer')!.mode = 'countdown'; // no durationSec
    home.layout = [{ type: 'row', children: ['today_total', 'nope'] }];
    s.collections.expenses.fields.vendor = { type: 'text', label: 'Vendor', required: true, ref: { collection: 'vendors', display: 'name', onDelete: 'clear' } }; // required link that clears
    s.collections.expenses.fields.owner = { type: 'text', label: 'Owner', ref: { collection: 'ghosts' } };
    s.localization = { terminology: [{ term: 'Kalam' }] };
    s.permissions = [{ kind: 'camera', reason: 'To take photos' }];
    const v = data(validateSpecTool({ spec: s }));
    expect(v.ok).toBe(false);
    const all = [...v.errors, ...v.warnings] as Array<{ code: string; hint?: string }>;
    const codes = new Set(all.map((i) => i.code));
    for (const code of ['INVALID_CHART', 'MISSING_DURATION', 'INVALID_LAYOUT', 'INVALID_RELATION', 'UNKNOWN_COLLECTION', 'INVALID_TERM', 'PERMISSION_UNUSED', 'PERMISSION_MISSING']) {
      expect(codes, code).toContain(code);
    }
    expect(all.filter((i) => !i.hint).map((i) => i.code)).toEqual([]);
  });

  it('refuses raw CSS in a style, because a spec is data', () => {
    const s = spec11() as Obj & { screens: Array<{ children: Obj[] }> };
    s.screens[0]!.children[1]!.style = { color: 'red' };
    const v = data(validateSpecTool({ spec: s }));
    expect(v.ok).toBe(false);
    expect(v.errors[0].hint).toEqual(expect.any(String));
  });
});
