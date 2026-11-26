import { describe, expect, it } from 'vitest';
import type { KalamRecord, RecordValue } from '../contracts';
import { instantiateCatalogEntry } from '../templates/catalog';
import {
  exportedFields, recordFileName, recordTitle, recordToCsv, recordToJson, recordToText, type RecordExportContext,
} from './index';

const spec = (() => {
  const r = instantiateCatalogEntry('kirana_credit_book', { appId: 'app_book', now: 1, lang: 'en' });
  if (!r.ok) throw new Error(r.error);
  return r.value.spec;
})();

const rec = (id: string, collectionId: string, values: Record<string, RecordValue>): KalamRecord =>
  ({ id, appId: 'app_book', collectionId, createdAt: Date.UTC(2026, 10, 18, 9, 5), updatedAt: Date.UTC(2026, 10, 19, 9, 5), values });

const customer = rec('c1', 'customers', { name: 'Ramesh Kumar', phone: '98xxxxxx01' });
const entry = rec('e1', 'entries', { customer: 'c1', kind: 'Credit given', amount: 850, date: '2026-11-09', note: 'Rice and oil' });
const ctx: RecordExportContext = { related: { customers: [customer], entries: [entry] } };

describe('one entry as JSON', () => {
  const json = recordToJson({ id: 'app_book', spec }, entry, ctx, 123);

  it('says what it is and where it came from', () => {
    expect(json).toMatchObject({
      format: 'kalam-record', formatVersion: 1, exportedAt: 123,
      app: { id: 'app_book', name: 'Kirana Credit Book' }, collection: { id: 'entries', label: 'Entries' },
      record: { id: 'e1' },
    });
  });

  it('keeps every field in the order of the design with its label, type, stored value and readable text', () => {
    expect(json.record.fields.map((f) => f.id)).toEqual(['customer', 'kind', 'amount', 'date', 'note']);
    expect(json.record.fields[0]).toMatchObject({ label: 'Customer', value: 'c1', text: 'Ramesh Kumar' }); // the link reads as a name
    expect(json.record.fields[2]).toMatchObject({ type: 'number', value: 850, text: '850 ₹' });
  });

  it('is plain JSON', () => {
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});

describe('one entry as CSV', () => {
  it('has a header row and one row, with the link written as a name', () => {
    const lines = recordToCsv(spec, entry, ctx).replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Customer,Type,Amount (₹),Date,Note,Added,Changed');
    expect(lines[1]!.startsWith('Ramesh Kumar,Credit given,850,2026-11-09,Rice and oil,')).toBe(true);
  });

  it('writes numbers as numbers, so a spreadsheet can add and sort them, with the unit in the header', () => {
    const negative = rec('e2', 'entries', { customer: 'c1', kind: 'Payment received', amount: -25.5, date: '2026-11-10' });
    const line = recordToCsv(spec, negative, ctx).trim().split('\r\n')[1]!;
    expect(line.startsWith('Ramesh Kumar,Payment received,-25.5,2026-11-10,')).toBe(true); // not "'-25.5 ₹"
  });

  it('is safe to open in a spreadsheet: a value that starts like a formula is neutralised', () => {
    const risky = rec('c2', 'customers', { name: '=HYPERLINK("http://example.test")', phone: '+91 1' });
    const line = recordToCsv(spec, risky).trim().split('\r\n')[1]!;
    expect(line.startsWith(`"'=HYPERLINK(""http://example.test"")"`)).toBe(true);
    expect(line).toContain("'+91 1");
  });

  it('quotes commas and line breaks', () => {
    const note = rec('c3', 'customers', { name: 'Anil, Traders', note: 'line one\nline two' });
    const csv = recordToCsv(spec, note);
    expect(csv).toContain('"Anil, Traders"');
    expect(csv).toContain('"line one\nline two"');
  });
});

describe('one entry as text', () => {
  it('reads like a card: app, list, label and value per filled-in field, then when it was added', () => {
    const text = recordToText(spec, entry, ctx);
    expect(text.split('\n')).toEqual([
      'Kirana Credit Book', 'Entries', '',
      'Customer: Ramesh Kumar', 'Type: Credit given', 'Amount: 850 ₹', 'Date: 2026-11-09', 'Note: Rice and oil',
      '', expect.stringMatching(/^Added 2026-11-\d\d \d\d:\d\d$/),
    ]);
  });

  it('leaves out fields that have no value', () => {
    const text = recordToText(spec, rec('c4', 'customers', { name: 'Sunita' }));
    expect(text).toContain('Name: Sunita');
    expect(text).not.toContain('Phone');
  });
});

describe('names and edge cases', () => {
  it('titles an entry by its first filled-in text, then falls back to the list name', () => {
    expect(recordTitle(spec, customer)).toBe('Ramesh Kumar');
    expect(recordTitle(spec, entry, ctx)).toBe('Ramesh Kumar');
    expect(recordTitle(spec, rec('c5', 'customers', {}))).toBe('Customers');
  });

  it('builds a safe file name', () => {
    expect(recordFileName(spec, customer, 'csv')).toBe('Kirana-Credit-Book-Ramesh-Kumar.csv');
    expect(recordFileName(spec, rec('c6', 'customers', { name: '../../etc/passwd' }), 'json')).not.toMatch(/[\\/]|\.\./);
  });

  it('a missing link reads as empty, never as an id', () => {
    const lost = rec('e9', 'entries', { customer: 'gone', kind: 'Credit given', amount: 1, date: '2026-11-09' });
    expect(exportedFields(spec, lost, ctx)[0]).toMatchObject({ value: 'gone', text: '' });
    expect(recordToText(spec, lost, ctx)).not.toContain('gone');
  });

  it('an entry of a list the design does not have exports nothing', () => {
    const ghost = rec('g', 'ghosts', { a: 1 });
    expect(exportedFields(spec, ghost)).toEqual([]);
    expect(recordToCsv(spec, ghost)).toBe('');
  });

  it('never exports a picture or a signature, only that one exists', () => {
    const fake = structuredClone(spec);
    fake.collections.customers!.fields.photo = { type: 'image', label: 'Photo' };
    const r = rec('c7', 'customers', { name: 'A', photo: 'local:abc123' });
    const f = exportedFields(fake, r).find((x) => x.id === 'photo')!;
    expect(f).toMatchObject({ value: null, text: '' });
    expect(JSON.stringify(recordToJson({ id: 'x', spec: fake }, r))).not.toContain('local:abc123');
    expect(recordToText(fake, r)).not.toContain('abc123');
  });
});
