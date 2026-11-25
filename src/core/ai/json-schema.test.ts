import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { cloudResponseSchema, sanitizeJsonSchema, toJsonSchema } from './json-schema';

describe('toJsonSchema', () => {
  it('produces a Gemini-safe schema from Zod', () => {
    const schema = z.object({
      name: z.string().min(1).max(40).regex(/^[a-z]+$/),
      email: z.string().email().optional(),
      when: z.iso.datetime(),
      count: z.number().int().positive(),
      kind: z.enum(['a', 'b']),
      lit: z.literal('x'),
      tags: z.array(z.string()).max(3),
      totals: z.record(z.string(), z.number()),
      note: z.string().nullable(),
      label: z.string().default('d'),
    });
    expect(toJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        when: { type: 'string', format: 'date-time' },
        count: { type: 'integer' },
        kind: { type: 'string', enum: ['a', 'b'] },
        lit: { type: 'string', enum: ['x'] },
        tags: { type: 'array', maxItems: 3, items: { type: 'string' } },
        totals: { type: 'object', additionalProperties: { type: 'number' } },
        note: { type: ['string', 'null'] },
        label: { type: 'string' },
      },
      // io: 'input' — defaulted and optional fields are not required of the model.
      required: ['name', 'when', 'count', 'kind', 'lit', 'tags', 'totals', 'note'],
    });
  });

  it('keeps unions, recursion and the schema the parser accepts', () => {
    const Node: z.ZodType<{ id: string; children?: unknown[] }> = z.object({
      id: z.string(),
      get children() { return z.array(Node).optional(); },
    });
    expect(toJsonSchema(Node)).toEqual({
      type: 'object', properties: { id: { type: 'string' }, children: { type: 'array', items: { $ref: '#' } } }, required: ['id'],
    });
    const u = toJsonSchema(z.union([z.object({ t: z.literal('a') }), z.object({ t: z.literal('b'), v: z.number().min(0).max(5) })]));
    expect(u).toEqual({
      anyOf: [
        { type: 'object', properties: { t: { type: 'string', enum: ['a'] } }, required: ['t'] },
        { type: 'object', properties: { t: { type: 'string', enum: ['b'] }, v: { type: 'number', minimum: 0, maximum: 5 } }, required: ['t', 'v'] },
      ],
    });
  });
});

describe('sanitizeJsonSchema', () => {
  it('drops unsupported keywords, maps oneOf/const, recurses into $defs and prefixItems, and does not mutate', () => {
    const input = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'x',
      $defs: { d: { type: 'string', format: 'email', pattern: '.+', const: 'z' } },
      oneOf: [{ type: 'number', exclusiveMinimum: 0, default: 1 }, { $ref: '#/$defs/d' }],
      prefixItems: [{ type: 'string', minLength: 2 }],
      additionalProperties: false,
      propertyNames: { type: 'string' },
      examples: [1],
    };
    const copy = structuredClone(input);
    expect(sanitizeJsonSchema(input)).toEqual({
      $defs: { d: { type: 'string', enum: ['z'] } },
      anyOf: [{ type: 'number' }, { $ref: '#/$defs/d' }],
      prefixItems: [{ type: 'string' }],
      additionalProperties: false,
    });
    expect(input).toEqual(copy);
  });

  it('returns {} for non-object input', () => {
    expect(sanitizeJsonSchema(null)).toEqual({});
    expect(sanitizeJsonSchema([1])).toEqual({});
  });
});

describe('cloudResponseSchema', () => {
  it('drops min/maxItems at every depth, orders properties as declared, and does not mutate', () => {
    const input = {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['stat', 'list'] },
        maxItems: { type: 'integer' },
        screens: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', properties: { tags: { type: 'array', maxItems: 3, items: { type: 'string' } } } } },
        either: { anyOf: [{ type: 'array', maxItems: 2, items: { type: 'number' } }, { type: 'null' }] },
      },
      required: ['screens'],
    };
    const before = JSON.stringify(input);
    expect(cloudResponseSchema(input)).toEqual({
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['stat', 'list'] },
        maxItems: { type: 'integer' },
        screens: {
          type: 'array',
          items: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } }, propertyOrdering: ['tags'] },
        },
        either: { anyOf: [{ type: 'array', items: { type: 'number' } }, { type: 'null' }] },
      },
      required: ['screens'],
      propertyOrdering: ['type', 'maxItems', 'screens', 'either'],
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('keeps the compiler IR component order: id and type before the type-specific props', async () => {
    const { compilerIRSchema } = await import('../compiler/ir');
    const cloud = cloudResponseSchema(toJsonSchema(compilerIRSchema)) as {
      properties: { screens: { items: { properties: { components: { items: { propertyOrdering: string[] } } } } } };
    };
    const order = cloud.properties.screens.items.properties.components.items.propertyOrdering;
    expect(order.slice(0, 2)).toEqual(['id', 'type']);
    for (const prop of ['field', 'action', 'expr', 'primary']) expect(order.indexOf(prop)).toBeGreaterThan(1);
    expect(JSON.stringify(cloud)).not.toContain('"maxItems":');
  });
});
