import { describe, expect, it } from 'vitest';
import { loadFixture, loadFixtures } from '../../../tests/fixtures/specs/load';
import type { AccessModes } from '../contracts';
import {
  brokenTerms, describeSpec, incomingRelations, migrateSpec, moveInLayout, offeredAccessModes, relationDisplayField,
  removeFromLayout, requiredPermissions, statCurrency, SUGGESTED_MODES_KEY, terminologyFor, usesV11, validateSpec,
  type KalamSpec,
} from './index';
import { LIMITS } from './schema';

type Json = Record<string, any>;
const v11 = (name: string, kind: 'valid' | 'invalid' = 'valid'): Json => loadFixture(kind, name, 'v11') as Json;
const v10 = (name: string): Json => loadFixture('valid', name) as Json;
const pairs = (input: unknown) => validateSpec(input).errors.map((e) => [e.code, e.path]);
const codes = (input: unknown) => validateSpec(input).errors.map((e) => e.code);
const spec = (name: string) => validateSpec(v11(name)).spec as KalamSpec;

describe('KalamSpec 1.1 — fixtures', () => {
  for (const { name, json } of loadFixtures('valid', 'v11')) {
    it(`accepts ${name}`, () => {
      const r = validateSpec(json);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.spec?.schemaVersion).toBe('1.1.0');
    });
  }

  it('every 1.0 fixture is still valid and migrates to 1.1 unchanged apart from the number', () => {
    for (const { name, json } of loadFixtures('valid')) {
      const m = migrateSpec(json);
      expect(m, name).toMatchObject({ ok: true, migratedFrom: '1.0.0' });
      expect({ ...(m.spec as Json), schemaVersion: '1.0.0' }).toEqual(json);
      expect(validateSpec(m.spec).ok, name).toBe(true);
      expect(usesV11(validateSpec(json).spec as KalamSpec), name).toBe(false);
    }
  });

  it('rejects broken relations with exact paths', () => {
    const got = pairs(v11('broken-relations', 'invalid'));
    expect(got).toContainEqual(['UNKNOWN_COLLECTION', 'collections.orders.fields.supplier.ref.collection']);
    expect(got).toContainEqual(['UNKNOWN_FIELD', 'collections.orders.fields.agent.ref.display']);
    expect(got).toContainEqual(['FIELD_TYPE_MISMATCH', 'collections.orders.fields.customer.ref.display']);
    expect(got).toContainEqual(['INVALID_RELATION', 'collections.orders.fields.customer.ref.onDelete']);
    expect(got).toContainEqual(['FIELD_TYPE_MISMATCH', 'screens[0].children[1].field']);
    // A link holds a record id: no length cap, default, several lines; a model never fills it.
    for (const prop of ['maxLength', 'defaultValue', 'multiline']) expect(got).toContainEqual(['INVALID_RELATION', `collections.orders.fields.broker.${prop}`]);
    expect(got).toContainEqual(['FIELD_TYPE_MISMATCH', 'screens[0].children[3].titleField']);
    expect(got).toContainEqual(['FIELD_TYPE_MISMATCH', 'aiBlocks.read_order.fields[0]']);
    expect(got).toContainEqual(['FIELD_TYPE_MISMATCH', 'aiBlocks.sum_name.outputField']);
    expect(got).not.toContainEqual(['FIELD_TYPE_MISMATCH', 'aiBlocks.read_order.fields[1]']);
    const warned = validateSpec(v11('broken-relations', 'invalid')).warnings.map((w) => [w.code, w.path]);
    expect(warned).toContainEqual(['IGNORED_PROPERTY', 'collections.orders.fields.broker.placeholder']);
    expect(warned).toContainEqual(['SORT_BY_LINK', 'screens[0].children[4].sort.field']);
  });

  it('accepts a choice field as a reminder title, rejects a signature field', () => {
    const t = v11('tailor-orders-linked');
    expect(validateSpec(t).ok).toBe(true); // titleField: garment, a choice
    t.screens[0].children[4].titleField = 'signature';
    expect(pairs(t)).toContainEqual(['FIELD_TYPE_MISMATCH', 'screens[0].children[4].titleField']);
  });

  it('rejects every broken 1.1 component, layout and section rule', () => {
    const got = pairs(v11('bad-components', 'invalid'));
    const c = (i: number) => `screens[0].children[${i}]`;
    expect(got).toContainEqual(['INVALID_CHART', `${c(0)}.groupBy`]);
    expect(got).toContainEqual(['INVALID_CHART', `${c(1)}.valueField`]);
    expect(got).toContainEqual(['MISSING_DURATION', `${c(2)}.durationSec`]);
    expect(got).toContainEqual(['FIELD_TYPE_MISMATCH', `${c(3)}.field`]);
    expect(got).toContainEqual(['FIELD_TYPE_MISMATCH', `${c(4)}.dateField`]);
    expect(got).toContainEqual(['FIELD_TYPE_MISMATCH', `${c(4)}.doneField`]);
    expect(got).toContainEqual(['UNKNOWN_COLLECTION', `${c(5)}.source`]);
    expect(got).toContainEqual(['FIELD_TYPE_MISMATCH', `${c(6)}.field`]);
    expect(got).toContainEqual(['INVALID_LAYOUT', 'screens[0].layout[0].columns']);
    expect(got).toContainEqual(['INVALID_LAYOUT', 'screens[0].layout[0].children[1]']);
    expect(got).toContainEqual(['INVALID_LAYOUT', 'screens[0].layout[1].title']);
    expect(got).toContainEqual(['INVALID_LAYOUT', 'screens[0].layout[1].children[0]']);
    expect(got).toContainEqual(['INVALID_LAYOUT', 'screens[0].layout']);
    expect(got).toContainEqual(['DUPLICATE_ID', 'permissions[1].kind']);
    expect(got).toContainEqual(['INVALID_TERM', 'localization.terminology[0]']);
    expect(got).toContainEqual(['INVALID_TERM', 'localization.terminology[1]']);
    expect(got).toContainEqual(['DUPLICATE_ID', 'localization.terminology[2].term']);
    expect(validateSpec(v11('bad-components', 'invalid')).warnings.map((w) => w.code)).toContain('PERMISSION_UNUSED');
  });

  it('blocks script and javascript: inside styles and layout titles before reading them', () => {
    const r = validateSpec(v11('style-injection', 'invalid'));
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => [e.code, e.path])).toEqual(expect.arrayContaining([
      ['SECURITY_CONTENT', 'screens[0].children[0].style.backgroundColor'],
      ['SECURITY_CONTENT', 'screens[0].layout[0].title'],
    ]));
    expect(r.errors.every((e) => !e.recoverable)).toBe(true);
  });
});

describe('KalamSpec 1.1 — style is named choices only', () => {
  const withStyle = (style: unknown) => {
    const s = v10('habit-counter');
    s.screens[0].children[0].style = style;
    return s;
  };
  it('rejects CSS properties, raw colours and pixel sizes', () => {
    expect(codes(withStyle({ backgroundColor: 'red' }))).toContain('UNKNOWN_PROPERTY');
    expect(codes(withStyle({ tone: '#FF0000' }))).toContain('SCHEMA_INVALID');
    expect(codes(withStyle({ size: '999px' }))).toContain('SCHEMA_INVALID');
    expect(codes(withStyle({ align: 'left; position: fixed' }))).toContain('SCHEMA_INVALID');
  });
  it('accepts the palette tones and raises a 1.0 document that uses them to 1.1', () => {
    const input = withStyle({ tone: 'warning', size: 'large', emphasis: 'strong', align: 'center' });
    const before = JSON.stringify(input);
    const r = validateSpec(input);
    expect(r.ok).toBe(true);
    expect(r.spec?.schemaVersion).toBe('1.1.0');
    expect(r.warnings.map((w) => w.code)).toContain('SCHEMA_VERSION_RAISED');
    expect(JSON.stringify(input)).toBe(before); // the caller's object keeps its 1.0.0
  });
});

describe('KalamSpec 1.1 — versions (ADR-024)', () => {
  it('accepts 1.1.x, rejects 1.2 and 2.0', () => {
    expect(validateSpec({ ...v10('habit-counter'), schemaVersion: '1.1.4' }).ok).toBe(true);
    expect(codes({ ...v11('workout-timer'), schemaVersion: '1.2.0' })).toEqual(['UNSUPPORTED_SCHEMA_VERSION']);
    expect(codes({ ...v11('workout-timer'), schemaVersion: '2.0.0' })).toEqual(['UNSUPPORTED_SCHEMA_VERSION']);
  });
});

describe('KalamSpec 1.1 — malicious and oversized input', () => {
  it('stops a 30-deep layout at the depth scan, before Zod recursion', () => {
    const s = v10('habit-counter');
    let node: Json = { type: 'card', children: [s.screens[0].children[0].id] };
    for (let i = 0; i < 30; i++) node = { type: 'card', children: [node] };
    s.screens[0].layout = [node];
    expect(codes(s)).toContain('SPEC_TOO_DEEP');
  });

  it('rejects a layout one level too deep with a plain message', () => {
    const s = v10('habit-counter');
    const id = s.screens[0].children[0].id;
    s.screens[0].layout = [{ type: 'card', children: [{ type: 'row', children: [{ type: 'grid', children: [{ type: 'card', children: [id] }] }] }] }];
    const r = validateSpec(s);
    expect(r.errors).toContainEqual(expect.objectContaining({ code: 'INVALID_LAYOUT', path: 'screens[0].layout', message: expect.stringContaining(`${LIMITS.layoutDepth} deep`) }));
  });

  it('caps groups per screen, children per group, terms and reminders', () => {
    const s = v10('habit-counter');
    const id = s.screens[0].children[0].id;
    s.screens[0].layout = Array.from({ length: LIMITS.layoutNodesPerScreen + 1 }, () => ({ type: 'row', children: [id] }));
    expect(codes(s)).toContain('SCHEMA_INVALID');

    const wide = v10('habit-counter');
    wide.screens[0].layout = [{ type: 'row', children: Array.from({ length: LIMITS.layoutChildren + 1 }, () => wide.screens[0].children[0].id) }];
    expect(codes(wide)).toContain('SCHEMA_INVALID');

    const nested = v10('habit-counter');
    const nid = nested.screens[0].children[0].id;
    nested.screens[0].layout = [{ type: 'card', children: Array.from({ length: 9 }, () => ({ type: 'row', children: [{ type: 'grid', children: [nid] }] })) }];
    expect(codes(nested)).toContain('RESOURCE_LIMIT');

    const terms = v11('workout-timer');
    terms.localization = { terminology: Array.from({ length: LIMITS.terminology + 1 }, (_, i) => ({ term: `t${i}`, keep: true })) };
    expect(codes(terms)).toContain('SCHEMA_INVALID');

    const many = v11('tailor-orders-linked');
    const r = many.screens[0].children.find((c: Json) => c.type === 'reminder');
    for (let i = 0; i < LIMITS.reminders; i++) many.screens[0].children.push({ ...r, id: `extra_reminder_${i}` });
    expect(pairs(many)).toContainEqual(['RESOURCE_LIMIT', 'screens']);
  });

  it('never resolves a link or a layout id through Object.prototype', () => {
    const s = v11('tailor-orders-linked');
    s.collections.orders.fields.customer.ref = { collection: 'constructor' };
    s.screens[0].layout = [{ type: 'row', children: ['constructor'] }];
    const got = codes(s);
    expect(got).toContain('UNKNOWN_COLLECTION');
    expect(got).toContain('INVALID_LAYOUT');
  });
});

describe('KalamSpec 1.1 — helpers', () => {
  const modes: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: true };

  it('only offers suggested Access Modes; nothing is switched on for the person', () => {
    const w = spec('workout-timer');
    expect(offeredAccessModes(w, modes)).toEqual(['large']);
    expect(offeredAccessModes(w, { ...modes, large: true })).toEqual([]);
    expect(offeredAccessModes(w, modes, { [SUGGESTED_MODES_KEY]: 'dismissed' })).toEqual([]);
    const plain = validateSpec(v10('habit-counter')).spec as KalamSpec;
    expect(offeredAccessModes(plain, modes)).toEqual([]);
  });

  it('shows money in the stat currency, else the app setting, else INR', () => {
    const t = spec('tailor-orders-linked');
    expect(statCurrency(t, { currency: 'USD' })).toBe('USD');
    expect(statCurrency({ settings: { currency: 'EUR' } }, {})).toBe('EUR');
    expect(statCurrency({}, {})).toBe('INR');
  });

  it('removes and moves grouped components in the layout, so edits keep the app valid', () => {
    const t = structuredClone(spec('tailor-orders-linked'));
    const home = t.screens[0];
    removeFromLayout(home, 'add_customer');
    home.children = home.children.filter((c) => c.id !== 'add_customer');
    expect(home.layout?.[2]).toEqual({ type: 'card', title: 'Shortcuts', style: { tone: 'primary', emphasis: 'strong' }, children: [{ type: 'row', children: ['add_order'] }] });
    expect(validateSpec(t).errors).toEqual([]);
    // A group left empty goes, and so does an empty layout.
    removeFromLayout(home, 'add_order');
    expect(home.layout).toHaveLength(2);
    for (const id of ['open_orders', 'advance_total', 'advance_chart', 'garment_chart']) removeFromLayout(home, id);
    expect(home.layout).toBeUndefined();

    const m = structuredClone(spec('tailor-orders-linked')).screens[0];
    expect(moveInLayout(m, 'advance_total', 'up')).toBe(true);
    expect(m.layout?.[0].children).toEqual(['advance_total', 'open_orders']);
    expect(moveInLayout(m, 'advance_total', 'up')).toBe(true); // at the edge: stays
    expect(m.layout?.[0].children).toEqual(['advance_total', 'open_orders']);
    expect(moveInLayout(m, 'order_list', 'up')).toBe(false); // not grouped: the caller moves it
  });

  it('finds incoming links and the field a link shows', () => {
    const t = spec('tailor-orders-linked');
    expect(incomingRelations(t, 'customers')).toEqual([{ collection: 'orders', field: 'customer', rule: 'cascade' }]);
    expect(incomingRelations(t, 'orders')).toEqual([{ collection: 'payments', field: 'order', rule: 'clear' }]);
    expect(relationDisplayField(t, { collection: 'customers' })).toBe('name');
    expect(relationDisplayField(t, { collection: 'orders', display: 'garment' })).toBe('garment');
    expect(relationDisplayField(t, { collection: 'nowhere' })).toBeUndefined();
  });

  it('derives permissions from components only', () => {
    expect(requiredPermissions(spec('tailor-orders-linked'))).toEqual(['notifications']);
    expect(requiredPermissions(spec('workout-timer'))).toEqual([]);
  });

  it('applies terminology rules per language and checks a translation deterministically', () => {
    const t = spec('tailor-orders-linked');
    const hi = terminologyFor(t, 'hi-IN');
    expect(hi).toEqual({ keep: ['Kurta'], fixed: [{ term: 'Advance', text: 'अग्रिम' }] });
    expect(terminologyFor(t, 'ta').fixed).toEqual([]);
    expect(brokenTerms(hi, 'Kurta advance', 'कुर्ता अग्रिम')).toEqual(['Kurta']);
    expect(brokenTerms(hi, 'Kurta advance', 'Kurta अग्रिम')).toEqual([]);
    expect(brokenTerms(hi, 'Shirt', 'शर्ट')).toEqual([]);
  });

  it('matches whole words only, the same on every device', () => {
    const rules = { keep: ['Sew', 'Art'], fixed: [] };
    expect(brokenTerms(rules, 'Sew', 'sewing class')).toEqual(['Sew']); // inside a longer word is not kept
    expect(brokenTerms(rules, 'Smart shop', 'Smart dukaan')).toEqual([]); // "Art" never was in the source
    expect(brokenTerms(rules, 'Sew it', 'SEW करें')).toEqual([]);
    expect(brokenTerms({ keep: ['दर'], fixed: [] }, 'दर', 'दर्जी')).toEqual(['दर']); // a combining sign continues the word
    expect(brokenTerms({ keep: ['दर'], fixed: [] }, 'दर', 'नई दर, आज')).toEqual([]);
    expect(brokenTerms({ keep: ['東京'], fixed: [] }, '東京', '東京都')).toEqual([]); // no spaces: substring
  });

  it('describes the new parts in plain words', () => {
    const d = describeSpec(spec('tailor-orders-linked'));
    const items = d.screens.flatMap((s) => s.items);
    expect(items).toContain('Chart: Advance by month');
    expect(items).toContain('Reminder: Delivery reminder (off until you switch it on)');
    expect(items).toContain('Signature: Customer signature');
    expect(d.collections.find((c) => c.id === 'orders')?.fields[0].type).toBe('Linked to one of customers');
    expect(describeSpec(spec('workout-timer')).screens[1].items).toContain('Stopwatch: Session');
  });
});
