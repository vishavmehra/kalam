import { z } from 'zod';

type JsonObject = Record<string, unknown>;

/**
 * Keywords Gemini `responseJsonSchema` documents as supported (types incl. `["x","null"]`, title,
 * description, properties, required, additionalProperties, enum, format, minimum/maximum, items,
 * prefixItems, minItems/maxItems, anyOf, $ref/$defs). Everything else is dropped: Zod `parse` stays
 * the final authority, so a looser generation schema is safe; an unsupported keyword can 400.
 * The same subset is what we hand Chrome's Prompt API as `responseConstraint`.
 */
const PASSTHROUGH = new Set(['type', 'title', 'description', 'required', 'enum', 'minItems', 'maxItems', '$ref']);
const FORMATS = new Set(['date-time', 'date', 'time']);

function isObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function mapValues(o: unknown): JsonObject {
  const out: JsonObject = {};
  if (isObject(o)) for (const [k, v] of Object.entries(o)) out[k] = sanitizeJsonSchema(v);
  return out;
}

/** Returns a new, Gemini/Prompt-API-safe copy of a JSON Schema. Never mutates its input. */
export function sanitizeJsonSchema(schema: unknown): JsonObject {
  if (!isObject(schema)) return {};
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(schema)) {
    if (PASSTHROUGH.has(key)) out[key] = value;
    else if (key === 'properties' || key === '$defs') out[key] = mapValues(value);
    else if (key === 'items') out.items = sanitizeJsonSchema(value);
    else if ((key === 'anyOf' || key === 'oneOf' || key === 'prefixItems') && Array.isArray(value)) {
      out[key === 'oneOf' ? 'anyOf' : key] = value.map(sanitizeJsonSchema);
    } else if (key === 'additionalProperties') {
      out.additionalProperties = typeof value === 'boolean' ? value : sanitizeJsonSchema(value);
    } else if (key === 'const' && !('enum' in schema)) out.enum = [value];
    else if (key === 'format' && typeof value === 'string' && FORMATS.has(value)) out.format = value;
    else if ((key === 'minimum' || key === 'maximum') && typeof value === 'number' && Math.abs(value) < Number.MAX_SAFE_INTEGER) {
      out[key] = value; // z.int() emits ±MAX_SAFE_INTEGER bounds that only add decoder states
    }
  }
  return out;
}

/**
 * The response schema sent to Firebase cloud models (Agent Platform / Vertex), from a sanitised one.
 * Two changes, both learned from real calls on 2026-11-18 (scripts/verify-cloud-compile.mjs):
 * - `minItems`/`maxItems` are dropped. Array bounds multiply the decoder's states and the service
 *   rejected the compiler IR schema with a bare `400 Request contains an invalid argument`.
 * - Every object gets `propertyOrdering` (a Gemini extension) in declaration order. Without it the
 *   service orders properties alphabetically, so a component's `type` came after `action`, `expr`
 *   and `field`; the model skipped those optional props before knowing the type (22 problems).
 * Zod `parse` still enforces every limit; the prompts state them too.
 */
export function cloudResponseSchema(schema: unknown): JsonObject {
  if (!isObject(schema)) return {};
  const nested = (v: unknown): unknown => (Array.isArray(v) ? v.map(nested) : isObject(v) ? cloudResponseSchema(v) : v);
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'minItems' || key === 'maxItems' || key === 'propertyOrdering') continue;
    // `properties` maps names to schemas, so a field literally called "maxItems" survives.
    out[key] = key === 'properties' && isObject(value)
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloudResponseSchema(v)]))
      : nested(value);
  }
  if (isObject(out.properties)) out.propertyOrdering = Object.keys(out.properties);
  return out;
}

/** Zod → JSON Schema describing what `schema.parse` accepts (io: 'input'), sanitised for Gemini. */
export function toJsonSchema(schema: z.ZodType): JsonObject {
  return sanitizeJsonSchema(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));
}
