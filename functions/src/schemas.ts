/**
 * Request / output contracts for the specialist callable. Everything from the client and from
 * the model is untrusted: requests are size-limited and strictly shaped, model output is parsed
 * and validated here before it leaves the server (the client validates again — final authority).
 */
import { z } from 'zod';
import { serverCompilerIRSchema } from './ir.js';

export const SPECIALIST_TASKS = ['plan_app', 'repair_spec', 'interpret_sketch'] as const;
export type SpecialistTask = (typeof SPECIALIST_TASKS)[number];

/** ~3.7 MB of image bytes per image as base64; 4 images max keeps the payload under ~16 MB. */
const MAX_IMAGE_BASE64 = 5_000_000;

const imageSchema = z
  .object({
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    base64: z.string().min(16).max(MAX_IMAGE_BASE64).regex(/^[A-Za-z0-9+/=\r\n]+$/, 'base64 only'),
  })
  .strict();

export const specialistRequestSchema = z
  .object({
    task: z.enum(SPECIALIST_TASKS),
    /** Client-built prompt; user content inside is already wrapped as untrusted data. */
    prompt: z.string().min(1).max(60_000),
    // No client `system` or `jsonSchema` (SECURITY_REVIEW R-01): instructions and the output
    // schema are pinned per task on the server, so this endpoint is never a general model proxy.
    images: z.array(imageSchema).max(4).optional(),
    maxOutputTokens: z.number().int().min(256).max(32_000).optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.task === 'interpret_sketch' && !r.images?.length) {
      ctx.addIssue({ code: 'custom', path: ['images'], message: 'interpret_sketch needs at least one image' });
    }
    if (r.task !== 'interpret_sketch' && r.images?.length) {
      ctx.addIssue({ code: 'custom', path: ['images'], message: `${r.task} does not accept images` });
    }
  });
export type SpecialistRequest = z.infer<typeof specialistRequestSchema>;

/**
 * Constrained intermediate plan (docs/07 §11.5). Same shape as `appPlanSchema` in
 * src/core/compiler/ir.ts — guidance for the Firebase compiler, never an executable app.
 */
export const appPlanSchema = z
  .object({
    applicationIntent: z.string().min(1).max(80),
    screens: z.array(z.string().min(1).max(80)).min(1).max(8),
    collections: z.array(z.string().min(1).max(80)).max(10),
    requirements: z.array(z.string().min(1).max(200)).max(20),
  })
  .strict();
export type AppPlan = z.infer<typeof appPlanSchema>;

/** Hand-written JSON Schema in the subset Claude structured outputs accept (lengths enforced by Zod). */
export const APP_PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['applicationIntent', 'screens', 'collections', 'requirements'],
  properties: {
    applicationIntent: { type: 'string', description: 'snake_case intent, e.g. inventory_management' },
    screens: { type: 'array', items: { type: 'string' }, description: 'Up to 8 short screen names' },
    collections: { type: 'array', items: { type: 'string' }, description: 'Up to 10 short data collection names' },
    requirements: { type: 'array', items: { type: 'string' }, description: 'Up to 20 short requirements' },
  },
} as const;

const MAX_OUTPUT_CHARS = 300_000;

/** Pulls the JSON object out of a model reply (tolerates ```json fences and surrounding prose). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1];
  const candidate = fenced ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in the model reply');
  return JSON.parse(candidate.slice(start, end + 1));
}

/** The output schema pinned per task (R-01): the plan, or Kalam's compiler IR. */
export const OUTPUT_SCHEMAS: Record<SpecialistTask, z.ZodType> = {
  plan_app: appPlanSchema,
  repair_spec: serverCompilerIRSchema,
  interpret_sketch: serverCompilerIRSchema,
};

/**
 * Server-side output validation against the task's pinned schema: a reply that is not a plan or an
 * IR (with every string length-bounded) never leaves the server. The client validates again.
 */
export function validateOutput(task: SpecialistTask, raw: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (JSON.stringify(raw ?? null).length > MAX_OUTPUT_CHARS) return { ok: false, error: 'Output is too large' };
  const r = OUTPUT_SCHEMAS[task].safeParse(raw);
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, error: r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
}
