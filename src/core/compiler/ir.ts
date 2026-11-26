/**
 * Compiler wire format / intermediate representation (docs/07 §11.5, docs/05 §14.4).
 *
 * Gemini structured output handles flat objects + arrays far better than records keyed by
 * ids or deep discriminated unions, so the cloud compiler emits this IR and
 * `irToSpec` (convert.ts) deterministically turns it into a KalamSpec. The IR is NOT
 * trusted: the converter only copies whitelisted properties and the result must pass
 * `validateSpec` before it is used.
 */
import { z } from 'zod';
import { CHART_KINDS, METRIC_OPERATIONS, TIME_UNITS } from '../reports/chart-component';
import {
  ACTION_TYPES, AI_BLOCK_KINDS, COMPONENT_TYPES, FIELD_TYPES, ICON_GLYPHS, LAYOUT_TYPES, LIMITS, ON_DELETE_RULES,
  STYLE_ALIGN, STYLE_EMPHASIS, STYLE_SIZES, STYLE_TONES, SUGGESTED_MODES, THEME_PRESETS,
} from '../spec/schema';

const idLike = z.string().min(1).max(80);
const text = (max: number) => z.string().max(max);

export const irFieldSchema = z.object({
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
  /** Always a string on the wire; coerced to the field type by the converter. */
  defaultValue: text(500).optional(),
  // v1.1 relation: a text field that stores one record of refCollection.
  refCollection: idLike.optional(),
  refDisplay: idLike.optional(),
  onDelete: z.enum(ON_DELETE_RULES).optional(),
});

export const irCollectionSchema = z.object({
  id: idLike,
  label: text(LIMITS.labelLength).optional(),
  fields: z.array(irFieldSchema).max(LIMITS.fieldsPerCollection),
});

export const irComponentSchema = z.object({
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
  // v1.1 style (flat on the wire; `tone` above stays the button tone).
  size: z.enum(STYLE_SIZES).optional(),
  emphasis: z.enum(STYLE_EMPHASIS).optional(),
  colorTone: z.enum(STYLE_TONES).optional(),
  align: z.enum(STYLE_ALIGN).optional(),
  fullWidth: z.boolean().optional(),
  // v1.1 chart (source is shared with list).
  chart: z.enum(CHART_KINDS).optional(),
  metric: z.enum(METRIC_OPERATIONS).optional(),
  valueField: idLike.optional(),
  groupBy: idLike.optional(),
  period: z.enum(TIME_UNITS).optional(),
  dateField: idLike.optional(),
  rangeLast: z.number().int().optional(),
  rangeUnit: z.enum(TIME_UNITS).optional(),
  // v1.1 timer (field is shared with inputs).
  mode: z.enum(['countdown', 'stopwatch']).optional(),
  durationSec: z.number().int().optional(),
  unit: z.enum(['seconds', 'minutes']).optional(),
  // v1.1 reminder (source and dateField are shared).
  leadDays: z.number().int().optional(),
  time: text(5).optional(),
  doneField: idLike.optional(),
  titleField: idLike.optional(),
  message: text(120).optional(),
});

/** Flat layout group: `items` name component ids or other group ids (no recursion on the wire). */
export const irGroupSchema = z.object({
  id: idLike,
  type: z.enum(LAYOUT_TYPES),
  title: text(LIMITS.labelLength).optional(),
  columns: z.number().int().optional(),
  items: z.array(idLike).max(LIMITS.layoutChildren),
});

export const irScreenSchema = z.object({
  id: idLike,
  title: text(LIMITS.nameLength),
  description: text(LIMITS.labelLength).optional(),
  /** Collection whose fields the inputs on this screen edit. Omit for transient forms. */
  form: idLike.optional(),
  components: z.array(irComponentSchema).max(LIMITS.componentsPerScreen),
  groups: z.array(irGroupSchema).max(LIMITS.layoutNodesPerScreen).optional(),
});

export const irActionSchema = z.object({
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
  /** update only: fixed values it writes ("Mark done" sets status to Done). Values are strings on the wire. */
  set: z.array(z.object({ field: idLike, value: text(500) })).max(LIMITS.fieldsPerCollection).optional(),
});

export const irAIBlockSchema = z.object({
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

export const irIntentSchema = z.object({
  action: idLike,
  phrases: z.array(text(60)).max(LIMITS.intentPhrasesPerAction),
});

export const compilerIRSchema = z.object({
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
  // v1.1 sections. Permissions are not on the wire: the converter derives them from the components.
  settings: z.object({ currency: text(3).optional(), timeFormat: z.enum(['12h', '24h']).optional() }).optional(),
  accessibility: z
    .object({ summary: text(300).optional(), suggestedModes: z.array(z.enum(SUGGESTED_MODES)).max(SUGGESTED_MODES.length).optional() })
    .optional(),
  terminology: z
    .array(z.object({
      term: text(60),
      keep: z.boolean().optional(),
      translations: z.array(z.object({ lang: text(16), text: text(60) })).max(12).optional(),
    }))
    .max(LIMITS.terminology)
    .optional(),
  /** Assumptions the model made, shown in the Understanding Review. */
  assumptions: z.array(text(200)).max(10).optional(),
  /** Questions when the request is too ambiguous to build (screens may then be empty). */
  clarifications: z.array(text(200)).max(5).optional(),
});

/** Constrained plan from a specialist provider (docs/07 §11.5) — guidance, never an app. */
export const appPlanSchema = z.object({
  applicationIntent: text(80),
  screens: z.array(text(80)).max(LIMITS.screens),
  collections: z.array(text(80)).max(LIMITS.collections),
  requirements: z.array(text(200)).max(20),
});

export type CompilerIR = z.infer<typeof compilerIRSchema>;
export type IRField = z.infer<typeof irFieldSchema>;
export type IRCollection = z.infer<typeof irCollectionSchema>;
export type IRComponent = z.infer<typeof irComponentSchema>;
export type IRScreen = z.infer<typeof irScreenSchema>;
export type IRGroup = z.infer<typeof irGroupSchema>;
export type IRAction = z.infer<typeof irActionSchema>;
export type IRAIBlock = z.infer<typeof irAIBlockSchema>;
export type AppPlan = z.infer<typeof appPlanSchema>;

/** Zod → StructuredRequest.parse adapter shared by every task module. */
export function zodParser<T>(schema: z.ZodType<T>) {
  return (raw: unknown): { success: true; data: T } | { success: false; error: string } => {
    const r = schema.safeParse(raw);
    return r.success
      ? { success: true, data: r.data }
      : { success: false, error: r.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
  };
}
