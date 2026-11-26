/**
 * Field definitions, defaults, coercion and validation for screen forms (docs/05 §4, §7.5).
 * Screens bound to a collection use that collection's field definitions; unbound screens derive
 * transient definitions from their input components (calculator operands etc.).
 */
import type { RecordValue } from '@/core/contracts';
import { localDate } from '@/core/formula';
import { LOCAL_MEDIA_REF, type KalamComponent, type KalamField, type KalamScreen, type KalamSpec } from '@/core/spec/schema';
import { engineText } from '@/i18n/engine-messages';
import type { FieldDef, FormValues } from './types';

/** Local calendar date as YYYY-MM-DD — the same `today` the formula engine uses. */
export const isoDate = localDate;

function fromField(id: string, f: KalamField): FieldDef {
  const base: FieldDef = { id, type: f.type, label: f.label, required: f.required === true };
  switch (f.type) {
    case 'text':
      return { ...base, maxLength: f.maxLength, defaultValue: f.defaultValue };
    case 'number':
      return { ...base, min: f.min, max: f.max, decimals: f.decimals, unit: f.unit, defaultValue: f.defaultValue };
    case 'date':
      return { ...base, defaultValue: f.defaultValue };
    case 'boolean':
      return { ...base, defaultValue: f.defaultValue };
    case 'enum':
      return { ...base, options: f.options, defaultValue: f.defaultValue };
    case 'image':
      return base;
  }
}

/** Field bound by an input component (counter with `field` counts as a number input). */
export function boundField(c: KalamComponent): string | undefined {
  switch (c.type) {
    case 'number': case 'textInput': case 'date': case 'choice': case 'toggle':
      return c.field;
    case 'counter':
      return c.field;
    // KalamSpec 1.1: a timer writes its time and a signature pad its signature into the screen form,
    // so a required signature is checked on Save like any other required input.
    case 'timer': case 'signature':
      return c.field;
    default:
      return undefined;
  }
}

function fromComponent(c: KalamComponent, field: string): FieldDef | undefined {
  const required = 'required' in c && c.required === true;
  switch (c.type) {
    case 'number': return { id: field, type: 'number', label: c.label, required };
    case 'textInput': return { id: field, type: 'text', label: c.label, required };
    case 'date': return { id: field, type: 'date', label: c.label, required };
    case 'choice': return { id: field, type: 'enum', label: c.label, required, options: c.options };
    case 'toggle': return { id: field, type: 'boolean', label: c.label, required: false };
    case 'counter': return { id: field, type: 'number', label: c.label, required: false, min: c.min, max: c.max };
    case 'timer': return { id: field, type: 'number', label: c.label, required: false };
    case 'signature': return { id: field, type: 'text', label: c.label, required };
    default: return undefined;
  }
}

/** Definitions for every field an input component on this screen edits. */
export function screenFieldDefs(spec: KalamSpec, screen: KalamScreen): Record<string, FieldDef> {
  const coll = screen.form ? spec.collections[screen.form] : undefined;
  const defs: Record<string, FieldDef> = {};
  for (const c of screen.children) {
    const field = boundField(c);
    if (!field) continue;
    const collField = coll?.fields[field];
    const def = collField ? fromField(field, collField) : fromComponent(c, field);
    if (!def) continue;
    if ('required' in c && c.required) def.required = true;
    if (c.type === 'choice' && c.options) def.options = c.options;
    if (c.type === 'counter') {
      def.min = c.min ?? def.min;
      def.max = c.max ?? def.max;
    }
    defs[field] = def;
  }
  return defs;
}

/** Collection field definitions, tightened by the requirements of inputs on `screen`. */
export function collectionFieldDefs(spec: KalamSpec, collectionId: string, screen?: KalamScreen): Record<string, FieldDef> | undefined {
  const coll = spec.collections[collectionId];
  if (!coll) return undefined;
  const defs: Record<string, FieldDef> = {};
  for (const [id, f] of Object.entries(coll.fields)) defs[id] = fromField(id, f);
  if (screen) {
    for (const c of screen.children) {
      const field = boundField(c);
      if (field && defs[field] && 'required' in c && c.required) defs[field].required = true;
    }
  }
  return defs;
}

export function defaultValue(def: FieldDef, now: Date): RecordValue {
  if (def.type === 'date') return def.defaultValue === 'today' ? isoDate(now) : null;
  if (def.defaultValue !== undefined) return def.defaultValue;
  return def.type === 'boolean' ? false : null;
}

export function defaultForm(spec: KalamSpec, screen: KalamScreen, now: Date): FormValues {
  const out: FormValues = {};
  for (const def of Object.values(screenFieldDefs(spec, screen))) out[def.id] = defaultValue(def, now);
  // Counters bound to a form field start at their minimum (or 0) rather than empty.
  for (const c of screen.children) {
    if (c.type === 'counter' && c.field && out[c.field] === null) out[c.field] = clamp(0, c.min, c.max);
  }
  return out;
}

export function clamp(v: number, min?: number, max?: number): number {
  let x = v;
  if (min !== undefined && x < min) x = min;
  if (max !== undefined && x > max) x = max;
  return x;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isEmpty(raw: RecordValue | undefined): boolean {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
}

/** Parses user-typed numbers; accepts a decimal comma ("12,5") when there is no dot. */
export function parseNumber(raw: RecordValue | undefined): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  let s = raw.trim().replace(/\s+/g, '');
  if (!s) return undefined;
  if (!s.includes('.') && /^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export type Coerced = { ok: true; value: RecordValue } | { ok: false; error: string };

/**
 * Turns a raw input value into a validated RecordValue for `def`. Messages are in `lang` (the app's
 * own language, docs/10 §14.1); English when it is missing or unknown.
 */
export function coerceValue(def: FieldDef, raw: RecordValue | undefined, now: Date, lang?: string): Coerced {
  // Numbers in limits are passed as typed text so "1000" never becomes "1,000".
  const say = (key: Parameters<typeof engineText>[1], extra?: Record<string, string>) =>
    ({ ok: false, error: engineText(lang, key, { label: def.label, ...extra }) }) as const;
  if (def.type === 'boolean') {
    if (isEmpty(raw)) return { ok: true, value: false };
    if (typeof raw === 'boolean') return { ok: true, value: raw };
    if (raw === 'true' || raw === 1) return { ok: true, value: true };
    if (raw === 'false' || raw === 0) return { ok: true, value: false };
    return say('mustBeYesNo');
  }
  if (isEmpty(raw)) return def.required ? say('required') : { ok: true, value: null };

  switch (def.type) {
    case 'number': {
      const n = parseNumber(raw);
      if (n === undefined) return say('mustBeNumber');
      if (def.min !== undefined && n < def.min) return say('min', { min: String(def.min) });
      if (def.max !== undefined && n > def.max) return say('max', { max: String(def.max) });
      const value = def.decimals !== undefined ? Number(n.toFixed(def.decimals)) : n;
      return { ok: true, value };
    }
    case 'text': {
      const s = String(raw).trim();
      if (def.maxLength !== undefined && s.length > def.maxLength) {
        return say('maxLength', { max: String(def.maxLength) });
      }
      return { ok: true, value: s };
    }
    case 'date': {
      const s = raw === 'today' ? isoDate(now) : String(raw).trim();
      if (!DATE_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00`))) {
        return say('mustBeDate');
      }
      return { ok: true, value: s };
    }
    case 'enum': {
      const s = String(raw);
      if (def.options && !def.options.includes(s)) return say('chooseOption');
      return { ok: true, value: s };
    }
    case 'image':
      // Only a reference to a picture kept on this device, never a URL or the picture itself.
      return typeof raw === 'string' && LOCAL_MEDIA_REF.test(raw) ? { ok: true, value: raw } : say('required');
  }
}

export interface FormCheck {
  values: Record<string, RecordValue>;
  errors: Record<string, string>;
}

/** Coerces + validates `form` against `defs`. Fields absent from the form use their defaults. */
export function checkForm(defs: Record<string, FieldDef>, form: FormValues, now: Date, lang?: string): FormCheck {
  const values: Record<string, RecordValue> = {};
  const errors: Record<string, string> = {};
  for (const def of Object.values(defs)) {
    const raw = def.id in form ? form[def.id] : defaultValue(def, now);
    const r = coerceValue(def, raw, now, lang);
    if (r.ok) values[def.id] = r.value;
    else errors[def.id] = r.error;
  }
  return { values, errors };
}

/** Lenient coercion for formulas: invalid numbers become null instead of failing. */
export function lenientForm(defs: Record<string, FieldDef>, form: FormValues): Record<string, RecordValue> {
  const out: Record<string, RecordValue> = { ...form };
  for (const def of Object.values(defs)) {
    if (def.type === 'number') out[def.id] = parseNumber(form[def.id]) ?? null;
  }
  return out;
}
