import { describe, expect, it } from 'vitest';
import { checkLink, compatibleTargets, isFromBazaar, suggestMappings, typesCompatible } from './contract';
import { describeLink, joinList } from './copy';
import { contractIdFor, linkIdFrom, parseShareLink, SHARE_LIMITS, type ShareLink } from './model';
import { entryTitle, projectValues, valueFits } from './project';
import type { KalamSpec } from '../spec/schema';
import { APP_C, APP_O, customers, orders, specWith } from './test-kit';

const link = (patch: Partial<ShareLink> = {}): ShareLink => ({
  id: 'lnk_abcdef000001',
  contractId: 'customers-orders-v1',
  contractVersion: 1,
  sourceAppId: APP_C,
  sourceCollection: 'customers',
  destinationAppId: APP_O,
  destinationCollection: 'orders',
  fields: [{ source: 'name', target: 'customer_name', type: 'text', label: 'Name' }, { source: 'phone', target: 'phone', type: 'text' }],
  access: 'read',
  status: 'active',
  createdAt: 5,
  audit: [{ at: 5, kind: 'created' }],
  ...patch,
});

describe('link model', () => {
  it('accepts a well formed link and keeps it as is', () => {
    const r = parseShareLink(link());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.link).toEqual(link());
  });

  it.each<[string, unknown]>([
    ['not an object', 'a string'],
    ['an unknown key (links are strict)', { ...link(), script: 'alert(1)' }],
    ['a bad id', link({ id: 'LNK_1' })],
    ['a newer contract version', { ...link(), contractVersion: 2 }],
    ['the same app on both sides', link({ destinationAppId: APP_C })],
    ['no fields', link({ fields: [] })],
    ['too many fields', link({ fields: Array.from({ length: SHARE_LIMITS.fieldsPerLink + 1 }, (_, i) => ({ source: `f${i}`, target: `t${i}`, type: 'text' as const })) })],
    ['a source field used twice', link({ fields: [{ source: 'name', target: 'a', type: 'text' }, { source: 'name', target: 'b', type: 'text' }] })],
    ['a target field used twice', link({ fields: [{ source: 'a', target: 'x', type: 'text' }, { source: 'b', target: 'x', type: 'text' }] })],
    ['a reserved field name', link({ fields: [{ source: 'constructor', target: 'x', type: 'text' }] })],
    ['a field name with a path in it', link({ fields: [{ source: '../etc', target: 'x', type: 'text' }] })],
    ['an unknown field type', { ...link(), fields: [{ source: 'a', target: 'b', type: 'file' }] }],
    ['an unknown access kind', { ...link(), access: 'admin' }],
    ['a turned off link without a time', link({ status: 'revoked' })],
    ['an active link with a turned off time', link({ revokedAt: 9 })],
    ['a function in a field', { ...link(), fields: [{ source: 'a', target: 'b', type: 'text', label: () => 1 }] }],
  ])('rejects %s', (_name, input) => {
    expect(parseShareLink(input).ok).toBe(false);
  });

  it('names what is wrong without repeating what was given', () => {
    const r = parseShareLink({ ...link(), sourceAppId: 'SECRET-VALUE-CAPS' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.issues)).not.toContain('SECRET-VALUE-CAPS');
  });

  it('builds ids from a random string and refuses a short one', () => {
    expect(linkIdFrom('A1B2-C3D4-E5F6-G7H8-I9J0-K1L2')).toBe('lnk_a1b2c3d4e5f6g7h8i9j0');
    expect(linkIdFrom('abc')).toBeUndefined();
    expect(contractIdFor('customer_list', 'orders')).toBe('customer-list-orders-v1');
  });
});

describe('field types', () => {
  it('lets a choice fill a text field and nothing else convert', () => {
    expect(typesCompatible('text', 'text')).toBe(true);
    expect(typesCompatible('enum', 'text')).toBe(true);
    expect(typesCompatible('text', 'enum')).toBe(false);
    expect(typesCompatible('number', 'text')).toBe(false);
    expect(typesCompatible('date', 'text')).toBe(false);
  });

  it('checks a value against the agreed type', () => {
    expect(valueFits('number', 3)).toBe(true);
    expect(valueFits('number', '3')).toBe(false);
    expect(valueFits('number', Number.NaN)).toBe(false);
    expect(valueFits('date', '2026-11-18')).toBe(true);
    expect(valueFits('date', '18/11/2026')).toBe(false);
    expect(valueFits('boolean', false)).toBe(true);
    expect(valueFits('text', null)).toBe(false);
  });

  it('projects only mapped fields and nulls a value of the wrong kind', () => {
    const l = link({ fields: [{ source: 'name', target: 'customer_name', type: 'text' }, { source: 'credit', target: 'amount', type: 'number' }] });
    expect(projectValues(l, { name: 'Asha', credit: 'lots', phone: '99999', secret_note: 'x' })).toEqual({ customer_name: 'Asha', amount: null });
    expect(projectValues(l, { name: 'Asha' })).toEqual({ customer_name: 'Asha', amount: null });
  });

  it('titles an entry from its first mapped values', () => {
    expect(entryTitle(link(), { name: 'Asha', phone: '99' })).toBe('Asha · 99');
    expect(entryTitle(link(), {})).toBe('Entry');
  });
});

describe('checkLink', () => {
  const src = specWith(APP_C, 'Customer Book', { customers });
  const dst = specWith(APP_O, 'Order Book', { orders });
  const codes = (l: ShareLink, s: KalamSpec | undefined, d: KalamSpec | undefined) => {
    const h = checkLink(l, s, d);
    return h.ok ? [] : h.problems.map((p) => p.code);
  };

  it('passes when both apps still fit', () => {
    expect(checkLink(link(), src, dst)).toEqual({ ok: true });
  });

  it('reports a missing app, list and field', () => {
    expect(codes(link(), undefined, dst)).toEqual(['source_app_missing']);
    expect(codes(link(), src, undefined)).toEqual(['destination_app_missing']);
    expect(codes(link(), specWith(APP_C, 'Customer Book', {}), dst)).toEqual(['source_collection_missing']);
    expect(codes(link(), src, specWith(APP_O, 'Order Book', {}))).toEqual(['destination_collection_missing']);
    const noPhone = { ...customers, fields: { name: customers.fields.name } };
    expect(codes(link(), specWith(APP_C, 'Customer Book', { customers: noPhone }), dst)).toEqual(['source_field_missing']);
  });

  it('says plainly which field went and which app lost it', () => {
    const noName = { ...customers, fields: { phone: customers.fields.phone } };
    const h = checkLink(link(), specWith(APP_C, 'Customer Book', { customers: noName }), dst);
    expect(h.ok).toBe(false);
    if (!h.ok) {
      expect(h.problems[0].message).toBe('Customer Book no longer has the field "Name".');
      expect(h.problems[0].message).not.toMatch(/[—–!]/);
    }
  });

  it('pauses the link when a field changes type, either side', () => {
    const phoneNumber = { ...customers, fields: { ...customers.fields, phone: { type: 'number' as const, label: 'Phone' } } };
    expect(codes(link(), specWith(APP_C, 'Customer Book', { customers: phoneNumber }), dst)).toEqual(['source_type_changed']);
    const targetNumber = { ...orders, fields: { ...orders.fields, phone: { type: 'number' as const, label: 'Phone' } } };
    expect(codes(link(), src, specWith(APP_O, 'Order Book', { orders: targetNumber }))).toEqual(['destination_type_changed']);
  });

  it('turned off links are never usable', () => {
    expect(codes(link({ status: 'revoked', revokedAt: 9 }), src, dst)).toEqual(['revoked']);
  });

  it('a write link needs the destination to accept every choice the source offers', () => {
    const l = link({ access: 'write', fields: [{ source: 'city', target: 'city', type: 'enum' }] });
    const dstChoice = { ...orders, fields: { ...orders.fields, city: { type: 'enum' as const, label: 'City', options: ['Delhi'] } } };
    expect(codes(l, src, specWith(APP_O, 'Order Book', { orders: dstChoice }))).toEqual(['destination_choices_missing']);
    // A read link only displays, so it does not care.
    expect(codes({ ...l, access: 'read' }, src, specWith(APP_O, 'Order Book', { orders: dstChoice }))).toEqual([]);
  });

  it('recognises an app installed from the Bazaar', () => {
    expect(isFromBazaar(specWith('app_b', 'B', {}, { source: 'import', basedOn: 'bazaar:l0123456789abcdefghi' }))).toBe(true);
    expect(isFromBazaar(specWith('app_b', 'B', {}, { source: 'remix', basedOn: 'app_other' }))).toBe(false);
    expect(isFromBazaar(specWith('app_b', 'B', {}, { source: 'import' }))).toBe(false);
    expect(isFromBazaar(undefined)).toBe(false);
  });
});

describe('suggestions', () => {
  it('pairs by name first, then by label, each field once, and skips types that do not fit', () => {
    const got = suggestMappings(customers, orders);
    expect(got.map((g) => [g.source, g.target, g.reason])).toEqual([
      ['phone', 'phone', 'same_name'],
      ['city', 'city', 'same_name'],
    ]);
    const labelled = suggestMappings(
      { fields: { who: { type: 'text', label: 'Customer Name' }, n: { type: 'number', label: 'Amount' } } },
      orders,
    );
    expect(labelled.map((g) => [g.source, g.target, g.reason])).toEqual([['who', 'customer_name', 'same_label'], ['n', 'amount', 'same_label']]);
  });

  it('lists the destination fields a source field may fill', () => {
    expect(compatibleTargets(orders, 'text')).toEqual(['customer_name', 'phone', 'city']);
    expect(compatibleTargets(orders, 'enum')).toEqual(['customer_name', 'phone', 'city']);
    expect(compatibleTargets(orders, 'number')).toEqual(['amount']);
    expect(compatibleTargets(orders, 'boolean')).toEqual([]);
  });
});

describe('copy', () => {
  it('joins names in plain English', () => {
    expect(joinList(['A'])).toBe('A');
    expect(joinList(['A', 'B'])).toBe('A and B');
    expect(joinList(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('explains both kinds of link without dashes or exclamation marks', () => {
    for (const access of ['read', 'write'] as const) {
      const text = describeLink({
        access, source: 'Customer Book', destination: 'Order Book', sourceList: 'Customers', destinationList: 'Orders', fields: ['Name', 'Phone'],
      }).join(' ');
      expect(text).toContain('Name and Phone');
      expect(text).not.toMatch(/[—–!]/);
      expect(text).toMatch(/device/);
    }
  });
});
