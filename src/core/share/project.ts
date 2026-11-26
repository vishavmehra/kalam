/** Moves values across a link. Only mapped fields cross, and only when the value fits the agreed type. */
import type { RecordValue } from '../contracts';
import type { KalamFieldType } from '../spec/schema';
import type { ShareLink } from './model';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function valueFits(type: KalamFieldType, value: RecordValue | undefined): value is RecordValue {
  if (value === null || value === undefined) return false;
  switch (type) {
    case 'text':
    case 'enum':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && DATE_RE.test(value);
    case 'image':
      return false; // photos stay on the device that took them
  }
}

/**
 * The target values for one source entry: every mapped field and nothing else. A value that is empty or
 * does not fit the agreed type becomes `null`, so a stray value never crosses in the wrong shape.
 */
export function projectValues(link: Pick<ShareLink, 'fields'>, values: Readonly<Record<string, RecordValue>>): Record<string, RecordValue> {
  const out: Record<string, RecordValue> = {};
  for (const f of link.fields) {
    const v = has(values, f.source) ? values[f.source] : undefined;
    out[f.target] = valueFits(f.type, v) ? v : null;
  }
  return out;
}

/** Short line to tell entries apart in the send list: the first two mapped values that are not empty. */
export function entryTitle(link: Pick<ShareLink, 'fields'>, values: Readonly<Record<string, RecordValue>>): string {
  const parts: string[] = [];
  for (const f of link.fields) {
    const v = has(values, f.source) ? values[f.source] : undefined;
    if (!valueFits(f.type, v) || v === '') continue;
    parts.push(typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
    if (parts.length === 2) break;
  }
  return parts.join(' · ') || 'Entry';
}
