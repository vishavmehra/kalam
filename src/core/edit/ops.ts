/**
 * Zod schema for SpecPatchOp (contracts). Patch ops from Gemini Nano / cloud are untrusted model
 * output: they are parsed with this schema before `applyPatchOps` touches the spec. Also usable as
 * the structured-output parser for edit tasks.
 */
import { z } from 'zod';
import type { SpecPatchOp } from '../contracts';
import {
  LIMITS, THEME_PRESETS, actionSchema, aiBlockSchema, collectionSchema, componentSchema, fieldSchema,
  idSchema, screenSchema,
} from '../spec/schema';

const label = z.string().min(1).max(LIMITS.labelLength);

export const specPatchOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('setThemeToken'), token: z.enum(['primary', 'secondary', 'background', 'surface', 'text']), value: z.string().max(16) }).strict(),
  z.object({ op: z.literal('setThemeNumber'), token: z.enum(['radius', 'fontScale']), value: z.number().finite() }).strict(),
  z.object({ op: z.literal('setThemePreset'), preset: z.enum(THEME_PRESETS) }).strict(),
  z.object({
    op: z.literal('setThemeOption'),
    option: z.enum(['fontFamily', 'spacing']),
    value: z.string().min(1).max(20),
  }).strict(),
  z.object({ op: z.literal('setAppName'), value: z.string().trim().min(1).max(LIMITS.nameLength) }).strict(),
  z.object({ op: z.literal('setLanguage'), value: z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/) }).strict(),
  z.object({ op: z.literal('renameComponent'), component: idSchema, label }).strict(),
  z.object({
    op: z.literal('setComponentProperty'),
    component: idSchema,
    property: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/),
    value: z.union([z.string().max(300), z.number().finite(), z.boolean()]),
  }).strict(),
  z.object({ op: z.literal('addComponent'), screen: idSchema, component: componentSchema, index: z.number().int().min(0).max(LIMITS.componentsPerScreen).optional() }).strict(),
  z.object({ op: z.literal('removeComponent'), component: idSchema }).strict(),
  z.object({ op: z.literal('moveComponent'), component: idSchema, direction: z.enum(['up', 'down']) }).strict(),
  z.object({ op: z.literal('addScreen'), screen: screenSchema, after: idSchema.optional() }).strict(),
  z.object({ op: z.literal('removeScreen'), screen: idSchema }).strict(),
  z.object({ op: z.literal('renameScreen'), screen: idSchema, title: z.string().min(1).max(LIMITS.nameLength) }).strict(),
  z.object({ op: z.literal('addCollection'), id: idSchema, collection: collectionSchema }).strict(),
  z.object({ op: z.literal('updateCollectionField'), collection: idSchema, field: idSchema, definition: fieldSchema }).strict(),
  z.object({ op: z.literal('addAction'), id: idSchema, action: actionSchema }).strict(),
  z.object({ op: z.literal('addAIBlock'), id: idSchema, block: aiBlockSchema }).strict(),
]);

/** Parses one untrusted op. */
export function parsePatchOp(raw: unknown): { success: true; data: SpecPatchOp } | { success: false; error: string } {
  const r = specPatchOpSchema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { success: false, error: issue ? `${issue.path.join('.') || 'op'}: ${issue.message}` : 'Invalid change' };
  }
  const data: SpecPatchOp = r.data;
  return { success: true, data };
}
