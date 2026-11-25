/**
 * Server copy of Kalam's compiler IR (src/core/compiler/ir.ts + the constants it uses from
 * src/core/spec/schema.ts). The specialist callable pins its output schema per task instead of
 * trusting one sent by the client (docs/SECURITY_REVIEW.md R-01), so repair_spec and
 * interpret_sketch can only ever return IR-shaped, length-bounded JSON.
 *
 * Kept in sync by src/core/compiler/server-ir-parity.test.ts (root test suite): it fails when this
 * file and the client IR produce different JSON Schemas.
 */
import { z } from 'zod';

const LIMITS = {
  screens: 8, componentsPerScreen: 40, collections: 10, fieldsPerCollection: 30, aiBlocks: 15, actions: 60,
  intentPhrasesPerAction: 12, enumOptions: 50, nameLength: 60, labelLength: 120, descriptionLength: 280,
  promptLength: 1200, formulaLength: 300, classifyLabels: 12,
} as const;
const THEME_PRESETS = ['calm_green', 'warm_paper', 'ocean_blue', 'soft_lavender', 'minimal_neutral', 'high_contrast'] as const;
const ICON_GLYPHS = [
  'calculator', 'plus', 'check', 'list', 'notebook', 'wallet', 'flame', 'users', 'package', 'clipboard',
  'ruler', 'bell', 'heart', 'pill', 'shopping_cart', 'scissors', 'calendar', 'book', 'star', 'home',
  'briefcase', 'leaf', 'dumbbell', 'graduation_cap', 'coffee', 'camera', 'mic', 'globe', 'timer', 'sparkles',
] as const;
const FIELD_TYPES = ['text', 'number', 'date', 'boolean', 'enum'] as const;
const COMPONENT_TYPES = [
  'text', 'heading', 'number', 'textInput', 'date', 'choice', 'toggle', 'counter', 'bigButton', 'list', 'stat', 'photo',
] as const;
const ACTION_TYPES = [
  'navigate', 'insert', 'update', 'delete', 'increment', 'decrement', 'reset', 'runAI', 'speak', 'feedback', 'clearForm',
] as const;
const AI_BLOCK_KINDS = ['extractFromPhoto', 'classify', 'summarise', 'translate'] as const;

const idLike = z.string().min(1).max(80);
const text = (max: number) => z.string().max(max);

const irFieldSchema = z.object({
  id: idLike,
  type: z.enum(FIELD_TYPES),
  label: text(LIMITS.labelLength),
  required: z.boolean().optional(),
  options: z.array(text(60)).max(LIMITS.enumOptions).optional(),
  unit: text(12).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  decimals: z.number().int().optional(),
  multiline: z.boolean().optional(),
  defaultValue: text(500).optional(),
});

const irCollectionSchema = z.object({
  id: idLike,
  label: text(LIMITS.labelLength).optional(),
  fields: z.array(irFieldSchema).max(LIMITS.fieldsPerCollection),
});

const irComponentSchema = z.object({
  id: idLike,
  type: z.enum(COMPONENT_TYPES),
  label: text(LIMITS.labelLength).optional(),
  field: idLike.optional(),
  required: z.boolean().optional(),
  placeholder: text(LIMITS.labelLength).optional(),
  multiline: z.boolean().optional(),
  options: z.array(text(60)).max(LIMITS.enumOptions).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  action: idLike.optional(),
  tone: z.enum(['primary', 'secondary', 'danger']).optional(),
  source: idLike.optional(),
  primary: idLike.optional(),
  secondaryField: idLike.optional(),
  filter: text(LIMITS.formulaLength).optional(),
  sortField: idLike.optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().optional(),
  emptyText: text(LIMITS.labelLength).optional(),
  toggleField: idLike.optional(),
  detailScreen: idLike.optional(),
  allowDelete: z.boolean().optional(),
  expr: text(LIMITS.formulaLength).optional(),
  format: z.enum(['number', 'integer', 'currency', 'percent', 'text']).optional(),
  currency: text(3).optional(),
  prefix: text(8).optional(),
  suffix: text(12).optional(),
  aiBlock: idLike.optional(),
});

const irScreenSchema = z.object({
  id: idLike,
  title: text(LIMITS.nameLength),
  description: text(LIMITS.labelLength).optional(),
  form: idLike.optional(),
  components: z.array(irComponentSchema).max(LIMITS.componentsPerScreen),
});

const irActionSchema = z.object({
  id: idLike,
  type: z.enum(ACTION_TYPES),
  screen: idLike.optional(),
  collection: idLike.optional(),
  target: idLike.optional(),
  by: z.number().optional(),
  aiBlock: idLike.optional(),
  text: text(300).optional(),
  message: text(160).optional(),
  tone: z.enum(['success', 'info', 'warning']).optional(),
  confirm: text(160).optional(),
  thenSpeak: text(200).optional(),
  thenNavigate: idLike.optional(),
  thenFeedback: text(120).optional(),
});

const irAIBlockSchema = z.object({
  id: idLike,
  kind: z.enum(AI_BLOCK_KINDS),
  prompt: text(LIMITS.promptLength),
  target: idLike.optional(),
  fields: z.array(idLike).max(LIMITS.fieldsPerCollection).optional(),
  labels: z.array(text(40)).max(LIMITS.classifyLabels).optional(),
  inputField: idLike.optional(),
  outputField: idLike.optional(),
  maxWords: z.number().int().optional(),
  targetLang: text(16).optional(),
});

const irIntentSchema = z.object({
  action: idLike,
  phrases: z.array(text(60)).max(LIMITS.intentPhrasesPerAction),
});

export const serverCompilerIRSchema = z.object({
  name: text(LIMITS.nameLength),
  description: text(LIMITS.descriptionLength).optional(),
  icon: z.enum(ICON_GLYPHS).optional(),
  themePreset: z.enum(THEME_PRESETS).optional(),
  lang: text(16).optional(),
  collections: z.array(irCollectionSchema).max(LIMITS.collections).optional(),
  screens: z.array(irScreenSchema).max(LIMITS.screens),
  initialScreen: idLike.optional(),
  actions: z.array(irActionSchema).max(LIMITS.actions).optional(),
  aiBlocks: z.array(irAIBlockSchema).max(LIMITS.aiBlocks).optional(),
  intents: z.array(irIntentSchema).max(LIMITS.actions).optional(),
  assumptions: z.array(text(200)).max(10).optional(),
  clarifications: z.array(text(200)).max(5).optional(),
});

/** The same schema as JSON Schema, for the model's instructions (never taken from the client). */
export const IR_JSON_SCHEMA: Record<string, unknown> = z.toJSONSchema(serverCompilerIRSchema, { io: 'input' }) as Record<string, unknown>;
