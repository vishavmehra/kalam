/**
 * Portable exports that need no Kalam cloud (docs/11 §13.1, §13.4):
 * - One app as JSON, in the `kalam-backup` v1 format that "Import backup" already reads. The design
 *   alone is safe to share; records are added only when the person asks (and confirms) for them.
 * - One collection's records as CSV for spreadsheets (RFC 4180, UTF-8 with BOM, formula-safe).
 */
import type { KalamBackup, KalamRecord, RecordValue, StoredApp } from '../contracts';
import type { KalamCollection } from '../spec/schema';

export interface AppExportOptions {
  /** Include the app's records and saved values (counters, settings inside the app). */
  records?: readonly KalamRecord[];
  state?: Readonly<Record<string, RecordValue>>;
  now?: number;
}

/** The design (and optionally the data) of one app. The original creation prompt is never included. */
export function exportAppJson(app: StoredApp, opts: AppExportOptions = {}): KalamBackup {
  const { id, spec, createdAt, updatedAt, origin } = app;
  return {
    format: 'kalam-backup',
    formatVersion: 1,
    exportedAt: opts.now ?? Date.now(),
    apps: [{ id, spec, createdAt, updatedAt, origin }],
    records: opts.records ? opts.records.filter((r) => r.appId === app.id) : [],
    state: opts.state ? Object.entries(opts.state).map(([key, value]) => ({ appId: app.id, key, value })) : [],
  };
}

export interface RecordsExport {
  format: 'kalam-records';
  formatVersion: 1;
  exportedAt: number;
  app: { id: string; name: string };
  collections: Record<string, {
    label: string;
    fields: Record<string, { label: string; type: string }>;
    records: Array<{ id: string; createdAt: number; updatedAt: number; values: Record<string, RecordValue> }>;
  }>;
}

/** The records of one app as JSON, grouped by list, with field names and types so they stay readable. */
export function exportRecordsJson(app: StoredApp, records: readonly KalamRecord[], now = Date.now()): RecordsExport {
  const collections: RecordsExport['collections'] = {};
  for (const [id, c] of Object.entries(app.spec.collections)) {
    collections[id] = {
      label: c.label ?? id,
      fields: Object.fromEntries(Object.entries(c.fields).map(([f, def]) => [f, { label: def.label ?? f, type: def.type }])),
      records: records
        .filter((r) => r.appId === app.id && r.collectionId === id)
        .map(({ id: rid, createdAt, updatedAt, values }) => ({ id: rid, createdAt, updatedAt, values })),
    };
  }
  return { format: 'kalam-records', formatVersion: 1, exportedAt: now, app: { id: app.id, name: app.spec.name }, collections };
}

// Spreadsheet apps run cells that start with these characters as formulas (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;
const neutralise = (s: string) => (FORMULA_START.test(s) ? `'${s}` : s);
const quote = (s: string) => (/[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-18 14:05" in the device's time zone (no Intl needed, Hermes-safe). */
export function localStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function cell(value: RecordValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  return neutralise(value);
}

/** One row per record, columns in the collection's field order, then when it was added and changed. */
export function collectionToCsv(
  collection: KalamCollection,
  records: readonly KalamRecord[],
  opts: { bom?: boolean } = {},
): string {
  const fields = Object.entries(collection.fields);
  const header = [...fields.map(([id, f]) => neutralise(f.label || id)), 'Added', 'Changed'];
  const rows = records.map((r) => [
    ...fields.map(([id]) => cell(Object.prototype.hasOwnProperty.call(r.values, id) ? r.values[id] : undefined)),
    localStamp(r.createdAt),
    localStamp(r.updatedAt),
  ]);
  const body = [header, ...rows].map((row) => row.map(quote).join(',')).join('\r\n');
  return `${opts.bom === false ? '' : '﻿'}${body}\r\n`;
}

/** "Kirana-credit-book-records.csv": letters, digits, dashes; never a path. */
export function exportFileName(name: string, suffix: string, ext: string): string {
  const base = `${name} ${suffix}`.trim().replace(/[^\p{L}\p{N}\-_ ]+/gu, '').replace(/\s+/g, '-').slice(0, 80) || 'kalam';
  return `${base}.${ext}`;
}
