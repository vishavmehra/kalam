/**
 * Cleans a model's raw IR before Zod checks it (eval 2026-11-25: 26 of 42 cloud answers failed on
 * empty strings and text longer than the limits, because the cloud response schema cannot carry
 * lengths). Walks the IR's own JSON Schema, so every limit comes from ir.ts and nothing is invented:
 * text is trimmed and shortened, empty or unknown optional values are dropped, integers are rounded
 * and lists are cut to their maximum. Each change is returned as a plain note for the repair log.
 * Pure: never reads the clock, never calls a model, never mutates its input.
 */
import { z } from 'zod';
import { compilerIRSchema } from './ir';

type Schema = {
  type?: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema;
  maxLength?: number; minLength?: number; maxItems?: number; enum?: unknown[];
};

let irSchema: Schema | undefined;
/** The IR's JSON Schema with its limits (built once; the cloud copy has the limits stripped). */
function irJsonSchema(): Schema {
  irSchema ??= z.toJSONSchema(compilerIRSchema, { io: 'input', unrepresentable: 'any' }) as Schema;
  return irSchema;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Notes per normalisation kind, so one long answer cannot flood the log. */
const MAX_NOTES = 40;

/** Returns a cleaned copy and what was changed. Values Zod will reject anyway (a missing id) are left for it to report. */
export function normalizeIR(raw: unknown, schema: Schema = irJsonSchema()): { value: unknown; notes: string[] } {
  const notes: string[] = [];
  const note = (path: string, what: string) => {
    if (notes.length < MAX_NOTES) notes.push(`${path || '(root)'}: ${what}`);
  };

  /** `undefined` means "drop this optional value". */
  const walk = (v: unknown, s: Schema, path: string, optional: boolean): unknown => {
    if (v === null) {
      if (optional) note(path, 'empty value removed');
      return optional ? undefined : v;
    }
    switch (s.type) {
      case 'string': {
        if (typeof v !== 'string') return v;
        let t = v.trim();
        if (s.enum && !s.enum.includes(t)) {
          // Models often change the case of a fixed word ("Bar" for "bar").
          const hit = s.enum.find((e) => typeof e === 'string' && e.toLowerCase() === t.toLowerCase()) as string | undefined;
          if (hit) return hit;
          if (optional) {
            note(path, `unknown value "${t.slice(0, 40)}" removed`);
            return undefined;
          }
          return t;
        }
        if (!t) {
          if (optional) note(path, 'empty text removed');
          return optional ? undefined : t;
        }
        if (s.maxLength !== undefined && t.length > s.maxLength) {
          note(path, `shortened from ${t.length} to ${s.maxLength} characters`);
          t = t.slice(0, s.maxLength).trimEnd();
        }
        return t;
      }
      case 'integer':
      case 'number': {
        const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
        if (typeof n !== 'number' || !Number.isFinite(n)) {
          if (optional) note(path, 'value that is not a number removed');
          return optional ? undefined : v;
        }
        if (s.type === 'integer' && !Number.isInteger(n)) {
          note(path, `rounded ${n} to a whole number`);
          return Math.round(n);
        }
        return n;
      }
      case 'array': {
        if (!Array.isArray(v)) return v;
        let items = v;
        if (s.maxItems !== undefined && items.length > s.maxItems) {
          note(path, `cut from ${items.length} to ${s.maxItems} items`);
          items = items.slice(0, s.maxItems);
        }
        const out: unknown[] = [];
        items.forEach((item, i) => {
          // An empty entry in a list (an empty option, a null component) is dropped, never kept as a hole.
          const next = s.items ? walk(item, s.items, `${path}[${i}]`, true) : item;
          if (next !== undefined) out.push(next);
        });
        return out;
      }
      case 'object': {
        if (!isObject(v) || !s.properties) return v;
        const required = new Set(s.required ?? []);
        const out: Record<string, unknown> = {};
        for (const [k, item] of Object.entries(v)) {
          const ps = Object.prototype.hasOwnProperty.call(s.properties, k) ? s.properties[k] : undefined;
          if (!ps) continue; // Zod strips unknown keys too
          const next = walk(item, ps, path ? `${path}.${k}` : k, !required.has(k));
          if (next !== undefined) out[k] = next;
        }
        return out;
      }
      default:
        return v;
    }
  };

  return { value: walk(raw, schema, '', false), notes };
}
