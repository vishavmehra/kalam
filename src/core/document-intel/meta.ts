/**
 * What a reader tells us about each field it took from a document (docs/14 §9.4, docs/16 R-016): how
 * sure it is, and roughly where on the page it saw the text. The reader's confidence is its own
 * estimate, not a measurement, so the review never treats "high" as proof.
 *
 * The notes ride inside a photo step's output under one reserved key (a JSON string, because record
 * values are plain scalars), are validated here, and are split off before any value reaches a form.
 */
import { z } from 'zod';
import type { RecordValue } from '../contracts';

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/**
 * A 3 x 3 grid over the page. Coarse on purpose: a small on-device model can answer "top right" but
 * cannot be trusted with pixel boxes. ponytail: Gemini in the cloud could return real boxes; add them if
 * the grid proves too coarse.
 */
export const PAGE_AREAS = [
  'top_left', 'top', 'top_right', 'left', 'center', 'right', 'bottom_left', 'bottom', 'bottom_right',
] as const;
export type PageArea = (typeof PAGE_AREAS)[number];

/** Reserved output keys of a photo step. Field ids start with a letter, so neither can collide. */
export const UNSURE_KEY = '_unsure';
export const READING_KEY = '_reading';

export interface FieldNote { confidence?: Confidence; area?: PageArea }
export interface Reading {
  /** Per field that has a value. */
  notes: Record<string, FieldNote>;
  /** Fields the reader returned that do not fit (wrong type, out of range, unresolved date): the text as read. */
  unread: Record<string, string>;
}

const MAX_READ_TEXT = 200;
export const emptyReading = (): Reading => ({ notes: {}, unread: {} });

/** JSON Schema fragment the photo step asks the model to fill: one entry per field it returned. */
export function readingJsonSchema(ids: readonly string[]): Record<string, unknown> {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        field: { type: 'string', enum: [...ids] },
        confidence: { type: 'string', enum: [...CONFIDENCE_LEVELS] },
        area: { type: 'string', enum: [...PAGE_AREAS] },
      },
      required: ['field', 'confidence'],
    },
  };
}

const entry = z.object({
  field: z.string(),
  confidence: z.enum(CONFIDENCE_LEVELS).optional().catch(undefined),
  area: z.enum(PAGE_AREAS).optional().catch(undefined),
});

/** Reads the model's `_reading` list. Untrusted: unknown fields, repeats and bad values are dropped, never guessed. */
export function parseNotes(raw: unknown, keep: readonly string[]): Record<string, FieldNote> {
  const out: Record<string, FieldNote> = {};
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    const p = entry.safeParse(item);
    if (!p.success || !keep.includes(p.data.field) || Object.prototype.hasOwnProperty.call(out, p.data.field)) continue;
    const { confidence, area } = p.data;
    if (confidence || area) out[p.data.field] = { ...(confidence ? { confidence } : {}), ...(area ? { area } : {}) };
  }
  return out;
}

/** The text the model gave for fields that did not fit (a number out of range, "Friday" with no clock). */
export function collectUnread(ids: readonly string[], raw: Record<string, unknown>, kept: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const v = raw[id];
    if (Object.prototype.hasOwnProperty.call(kept, id) || !Object.prototype.hasOwnProperty.call(raw, id)) continue;
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue;
    const text = String(v).trim().slice(0, MAX_READ_TEXT);
    if (text) out[id] = text;
  }
  return out;
}

const stored = z.object({
  notes: z.record(z.string(), z.object({ confidence: z.enum(CONFIDENCE_LEVELS).optional(), area: z.enum(PAGE_AREAS).optional() })),
  unread: z.record(z.string(), z.string().max(MAX_READ_TEXT)),
});

/** JSON for the output key, or undefined when there is nothing to carry. */
export function encodeReading(r: Reading): string | undefined {
  return Object.keys(r.notes).length || Object.keys(r.unread).length ? JSON.stringify(r) : undefined;
}

function decodeReading(text: unknown): Reading {
  if (typeof text !== 'string') return emptyReading();
  try {
    const p = stored.safeParse(JSON.parse(text));
    return p.success ? p.data : emptyReading();
  } catch {
    return emptyReading();
  }
}

/** Splits the reserved keys off a photo step's output: the values, the "unsure" ids and the reading notes. */
export function splitPhotoOutput(output: Record<string, RecordValue> | undefined): {
  values: Record<string, RecordValue> | undefined; unsure: string[]; reading: Reading;
} {
  if (!output) return { values: output, unsure: [], reading: emptyReading() };
  const { [UNSURE_KEY]: list, [READING_KEY]: notes, ...values } = output;
  return {
    values,
    unsure: typeof list === 'string' && list ? list.split(',') : [],
    reading: decodeReading(notes),
  };
}
