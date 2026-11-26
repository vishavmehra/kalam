/**
 * Export or share ONE entry (docs/01 §3.3 "export or share information", docs/11 §13): as JSON, as a one-row CSV for a
 * spreadsheet, or as a short plain-text card that can go into a message. A link to another entry is written as that
 * entry's name, a picture is left out (it is a local file), and CSV cells are made safe for spreadsheets.
 * Pure TypeScript: the caller decides how the text leaves the device.
 */
import { collectionToCsv, exportFileName, localStamp } from '../backup/exports';
import type { KalamRecord, RecordValue } from '../contracts';
import type { KalamCollection, KalamSpec } from '../spec/schema';
import { isSignatureField, relationDisplayField, relationOf } from '../spec/v11';

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export interface RecordExportContext {
  /** Every entry of the app by list, so a link can be written as the linked entry's name. */
  related?: Readonly<Record<string, readonly KalamRecord[]>>;
}

export interface ExportedField {
  id: string;
  label: string;
  type: string;
  /** The value as stored. A picture or a signature is null: neither can leave the device inside a text file. */
  value: RecordValue;
  /** The value as a person reads it: a linked entry's name, Yes or No, a number with its unit. Empty when there is none. */
  text: string;
}

const READS_AS_EMPTY = (v: RecordValue | undefined): boolean => v === undefined || v === null || v === '';

/** How one stored value reads. Empty string when there is nothing to show. */
function textOf(spec: KalamSpec, collection: string, fid: string, v: RecordValue | undefined, ctx: RecordExportContext): string {
  if (READS_AS_EMPTY(v)) return '';
  const def = spec.collections[collection]?.fields[fid];
  if (!def || def.type === 'image') return '';
  if (isSignatureField(spec, collection, fid)) return 'Signed';
  const relation = relationOf(spec, collection, fid);
  if (relation && typeof v === 'string') {
    const field = relationDisplayField(spec, relation);
    const hit = ctx.related?.[relation.collection]?.find((r) => r.id === v);
    const name = hit && field ? hit.values[field] : undefined;
    return READS_AS_EMPTY(name) ? '' : String(name);
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return def.type === 'number' && def.unit ? `${v} ${def.unit}` : String(v);
  return String(v);
}

/** Every field of the entry in the order of the design, with the value as stored and as read. */
export function exportedFields(spec: KalamSpec, record: KalamRecord, ctx: RecordExportContext = {}): ExportedField[] {
  const collection = own(spec.collections, record.collectionId) ? spec.collections[record.collectionId] : undefined;
  if (!collection) return [];
  return Object.entries(collection.fields).map(([id, f]) => {
    const raw = own(record.values, id) ? record.values[id] : null;
    const hidden = f.type === 'image' || isSignatureField(spec, record.collectionId, id);
    return { id, label: f.label || id, type: f.type, value: hidden || raw === undefined ? null : raw, text: textOf(spec, record.collectionId, id, raw, ctx) };
  });
}

/** A short name for the entry: its first filled-in text, else its list's name. */
export function recordTitle(spec: KalamSpec, record: KalamRecord, ctx: RecordExportContext = {}): string {
  const label = spec.collections[record.collectionId]?.label ?? record.collectionId;
  for (const f of exportedFields(spec, record, ctx)) if ((f.type === 'text' || f.type === 'enum') && f.text) return f.text;
  return label;
}

export interface RecordJson {
  format: 'kalam-record';
  formatVersion: 1;
  exportedAt: number;
  app: { id: string; name: string };
  collection: { id: string; label: string };
  record: { id: string; createdAt: number; updatedAt: number; fields: ExportedField[] };
}

export function recordToJson(
  app: { id: string; spec: KalamSpec }, record: KalamRecord, ctx: RecordExportContext = {}, now: number = Date.now(),
): RecordJson {
  const { spec } = app;
  return {
    format: 'kalam-record', formatVersion: 1, exportedAt: now,
    app: { id: app.id, name: spec.name },
    collection: { id: record.collectionId, label: spec.collections[record.collectionId]?.label ?? record.collectionId },
    record: { id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt, fields: exportedFields(spec, record, ctx) },
  };
}

/**
 * One header row and one entry, with the same cell rules as the whole-list export. A number is written as a number and a
 * date as a date, so a spreadsheet can sort and add them; the unit goes in the header ("Amount (₹)"). A link is written
 * as the linked entry's name and a yes or no as Yes or No.
 */
export function recordToCsv(spec: KalamSpec, record: KalamRecord, ctx: RecordExportContext = {}): string {
  const collection: KalamCollection | undefined = own(spec.collections, record.collectionId) ? spec.collections[record.collectionId] : undefined;
  if (!collection) return '';
  const fields = exportedFields(spec, record, ctx);
  const values: Record<string, RecordValue> = {};
  const readable: KalamCollection = {
    ...collection,
    fields: Object.fromEntries(Object.entries(collection.fields).map(([id, f]) => {
      const unit = f.type === 'number' && f.unit ? ` (${f.unit})` : '';
      return [id, { type: 'text' as const, label: `${f.label || id}${unit}` }];
    })),
  };
  for (const f of fields) {
    values[f.id] = (f.type === 'number' && typeof f.value === 'number') || (f.type === 'date' && typeof f.value === 'string') ? f.value : f.text;
  }
  return collectionToCsv(readable, [{ ...record, values }]);
}

/** A card for a message: the app and list name, then "Label: value" per filled-in field, then when it was added. */
export function recordToText(spec: KalamSpec, record: KalamRecord, ctx: RecordExportContext = {}): string {
  const label = spec.collections[record.collectionId]?.label ?? record.collectionId;
  const lines = exportedFields(spec, record, ctx).filter((f) => f.text).map((f) => `${f.label}: ${f.text}`);
  return [spec.name, label, '', ...lines, '', `Added ${localStamp(record.createdAt)}`].join('\n');
}

/** "Kirana-Credit-Book-Ramesh-Kumar.csv": letters, digits and dashes, never a path. */
export function recordFileName(spec: KalamSpec, record: KalamRecord, ext: 'json' | 'csv' | 'txt', ctx: RecordExportContext = {}): string {
  return exportFileName(spec.name, recordTitle(spec, record, ctx), ext);
}
