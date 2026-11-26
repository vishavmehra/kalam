/**
 * Record values are validated against the app's collection definition before every write
 * (docs/09 §10.5): field membership, types, required, enum options, min/max, length, dates.
 */
import type { RecordValue } from '@/core/contracts';
import { limitsPolicy } from '@/core/limits/policy';
import { LOCAL_MEDIA_REF, type KalamCollection, type KalamField } from '@/core/spec/schema';

export interface RecordIssue { field: string; message: string }

export class RecordValidationError extends Error {
  readonly code = 'record_invalid';
  constructor(readonly issues: RecordIssue[]) {
    super(`Invalid record: ${issues.map((i) => `${i.field}: ${i.message}`).join('; ')}`);
    this.name = 'RecordValidationError';
  }
}

const DEFAULT_TEXT_LIMIT = limitsPolicy.data.recordTextLength;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function isValidDate(v: string): boolean {
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function checkField(field: KalamField, v: unknown): string | undefined {
  switch (field.type) {
    case 'text':
      if (typeof v !== 'string') return 'Must be text';
      return v.length > (field.maxLength ?? DEFAULT_TEXT_LIMIT) ? 'Text is too long' : undefined;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'Must be a number';
      if (field.min !== undefined && v < field.min) return `Must be at least ${field.min}`;
      return field.max !== undefined && v > field.max ? `Must be at most ${field.max}` : undefined;
    case 'date':
      return typeof v === 'string' && isValidDate(v) ? undefined : 'Must be a date (YYYY-MM-DD)';
    case 'boolean':
      return typeof v === 'boolean' ? undefined : 'Must be yes or no';
    case 'enum':
      return typeof v === 'string' && field.options.includes(v) ? undefined : 'Not one of the allowed options';
    case 'image':
      return typeof v === 'string' && LOCAL_MEDIA_REF.test(v) ? undefined : 'Must be a photo kept on this device';
  }
}

export interface ValidateOptions {
  /**
   * Carry values whose field has since left the design (the editor keeps them so an older design can come back,
   * docs/14 §11.6), instead of rejecting them as unknown. Used when restoring or importing a backup, which holds
   * rows exactly as stored. A carried value must still be plain text, a number, yes or no, or empty, so a hostile
   * file cannot smuggle in anything else; such a record is rejected as before.
   */
  keepStale?: boolean;
}

/**
 * Validates a complete record. Unknown fields are rejected (or carried, see `keepStale`); missing optional
 * fields are omitted; empty optional values are stored as null ('' is kept for text).
 */
export function validateRecordValues(
  collection: KalamCollection,
  values: unknown,
  options: ValidateOptions = {},
): { ok: true; values: Record<string, RecordValue> } | { ok: false; issues: RecordIssue[] } {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return { ok: false, issues: [{ field: '*', message: 'Values must be an object' }] };
  }
  const input = values as Record<string, unknown>;
  const issues: RecordIssue[] = [];
  const out: Record<string, RecordValue> = {};
  const stale: Record<string, RecordValue> = {};
  for (const key of Object.keys(input)) {
    if (has(collection.fields, key)) continue;
    const v = input[key];
    if (options.keepStale && isRecordValue(v) && (typeof v !== 'string' || v.length <= DEFAULT_TEXT_LIMIT)) stale[key] = v;
    else issues.push({ field: key, message: 'Unknown field' });
  }
  for (const [id, field] of Object.entries(collection.fields)) {
    const v = has(input, id) ? input[id] : undefined;
    if (v === undefined || v === null || v === '') {
      if (field.required) issues.push({ field: id, message: 'Required' });
      else if (v !== undefined) out[id] = field.type === 'text' ? v : null;
      continue;
    }
    const problem = checkField(field, v);
    if (problem) issues.push({ field: id, message: problem });
    else out[id] = v as RecordValue;
  }
  return issues.length ? { ok: false, issues } : { ok: true, values: { ...stale, ...out } };
}

export function isRecordValue(v: unknown): v is RecordValue {
  return v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
}
