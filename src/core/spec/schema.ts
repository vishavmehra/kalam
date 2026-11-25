/**
 * KalamSpec v1 — canonical Zod schema (source of truth, docs/05_KALAMSPEC.md §14).
 *
 * KalamSpec is DATA, never code. Every untrusted boundary (compiler output, import,
 * marketplace, restore) must pass `validateSpec` (src/core/spec/validate.ts), which
 * runs this structural schema first and then resource / reference / formula /
 * security checks. Objects are strict: unknown properties are rejected.
 */
import { z } from 'zod';

// Zod's JIT probes `new Function("")`, which our CSP (no unsafe-eval) blocks. Jitless parsing avoids the
// probe entirely (security review R-03). Runs at import time, before any schema is used.
z.config({ jitless: true });

export const SCHEMA_VERSION = '1.0.0';

/** Resource limits (docs/05 §13.2 plus Kalam implementation limits). */
export const LIMITS = {
  screens: 8,
  componentsPerScreen: 40,
  collections: 10,
  fieldsPerCollection: 30,
  aiBlocks: 15,
  actions: 60,
  intentPhrasesPerAction: 12,
  enumOptions: 50,
  nameLength: 60,
  labelLength: 120,
  descriptionLength: 280,
  promptLength: 1200,
  formulaLength: 300,
  formulaSteps: 10_000,
  classifyLabels: 12,
  tags: 8,
} as const;

/** Stable identifier: lowercase letters, digits, underscores (docs/05 §2.3). */
export const idSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,47}$/, 'Identifiers use lowercase letters, digits and underscores');

/** Application id may also contain dashes (generated ids like app_k3f9-x2). */
export const appIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/);

/** Names that may not be used as collection, field, screen or state identifiers. */
export const RESERVED_IDS = [
  'constructor', 'prototype', '__proto__', 'form', 'state', 'today', 'now', 'true', 'false', 'null',
  'undefined', 'this', 'window', 'globalthis', 'eval', 'function', 'record', 'item',
  // Key the Smart Reminders feature uses in each app's key-value state (docs/14 §10). An app counter
  // with this id would overwrite the reminder rules.
  'kalam_reminders',
] as const;

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colours must be #RRGGBB');
const label = z.string().min(1).max(LIMITS.labelLength);
const shortText = z.string().max(LIMITS.labelLength);

// ─── Theme ────────────────────────────────────────────────────────────────────
export const THEME_PRESETS = [
  'calm_green', 'warm_paper', 'ocean_blue', 'soft_lavender', 'minimal_neutral', 'high_contrast',
] as const;
export const FONT_FAMILIES = ['system', 'inter', 'noto_sans', 'serif', 'rounded'] as const;

export const themeSchema = z
  .object({
    primary: hexColorSchema,
    secondary: hexColorSchema.optional(),
    background: hexColorSchema.optional(),
    surface: hexColorSchema.optional(),
    text: hexColorSchema.optional(),
    radius: z.number().min(0).max(32),
    fontScale: z.number().min(0.8).max(1.6),
    spacing: z.enum(['compact', 'comfortable', 'spacious']).optional(),
    fontFamily: z.enum(FONT_FAMILIES).optional(),
    preset: z.enum(THEME_PRESETS).optional(),
  })
  .strict();

// ─── Icon (safe descriptor instead of raw SVG; no sanitisation surface) ───────
export const ICON_GLYPHS = [
  'calculator', 'plus', 'check', 'list', 'notebook', 'wallet', 'flame', 'users', 'package', 'clipboard',
  'ruler', 'bell', 'heart', 'pill', 'shopping_cart', 'scissors', 'calendar', 'book', 'star', 'home',
  'briefcase', 'leaf', 'dumbbell', 'graduation_cap', 'coffee', 'camera', 'mic', 'globe', 'timer', 'sparkles',
] as const;
export const iconSchema = z
  .object({ glyph: z.enum(ICON_GLYPHS), background: hexColorSchema.optional(), foreground: hexColorSchema.optional() })
  .strict();

// ─── Fields (docs/05 §4) ──────────────────────────────────────────────────────
const fieldBase = { label, required: z.boolean().optional() };

export const textFieldSchema = z
  .object({
    type: z.literal('text'),
    ...fieldBase,
    defaultValue: z.string().max(500).optional(),
    placeholder: shortText.optional(),
    multiline: z.boolean().optional(),
    maxLength: z.number().int().min(1).max(5000).optional(),
  })
  .strict();
export const numberFieldSchema = z
  .object({
    type: z.literal('number'),
    ...fieldBase,
    defaultValue: z.number().finite().optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    unit: z.string().max(12).optional(),
    decimals: z.number().int().min(0).max(6).optional(),
  })
  .strict();
export const dateFieldSchema = z
  .object({ type: z.literal('date'), ...fieldBase, defaultValue: z.literal('today').optional() })
  .strict();
export const booleanFieldSchema = z
  .object({ type: z.literal('boolean'), ...fieldBase, defaultValue: z.boolean().optional() })
  .strict();
export const enumFieldSchema = z
  .object({
    type: z.literal('enum'),
    ...fieldBase,
    options: z.array(z.string().min(1).max(60)).min(1).max(LIMITS.enumOptions),
    defaultValue: z.string().max(60).optional(),
  })
  .strict();

export const fieldSchema = z.discriminatedUnion('type', [
  textFieldSchema, numberFieldSchema, dateFieldSchema, booleanFieldSchema, enumFieldSchema,
]);
export const FIELD_TYPES = ['text', 'number', 'date', 'boolean', 'enum'] as const;

export const collectionSchema = z
  .object({
    label: shortText.optional(),
    fields: z.record(idSchema, fieldSchema),
  })
  .strict();

// ─── Components v1 (docs/05 §6) ───────────────────────────────────────────────
const componentBase = {
  id: idSchema,
  visible: z.boolean().optional(),
  secondary: z.boolean().optional(),
  a11yLabel: shortText.optional(),
  /** Accessibility description (docs/05 §11.1). */
  a11yDescription: z.string().max(300).optional(),
  readAloud: z.string().max(300).optional(),
};

export const textComponentSchema = z.object({ ...componentBase, type: z.literal('text'), label }).strict();
export const headingComponentSchema = z.object({ ...componentBase, type: z.literal('heading'), label }).strict();
export const numberComponentSchema = z
  .object({
    ...componentBase,
    type: z.literal('number'),
    label,
    field: idSchema,
    required: z.boolean().optional(),
    placeholder: shortText.optional(),
  })
  .strict();
export const textInputComponentSchema = z
  .object({
    ...componentBase,
    type: z.literal('textInput'),
    label,
    field: idSchema,
    required: z.boolean().optional(),
    placeholder: shortText.optional(),
    multiline: z.boolean().optional(),
  })
  .strict();
export const dateComponentSchema = z
  .object({ ...componentBase, type: z.literal('date'), label, field: idSchema, required: z.boolean().optional() })
  .strict();
export const choiceComponentSchema = z
  .object({
    ...componentBase,
    type: z.literal('choice'),
    label,
    field: idSchema,
    options: z.array(z.string().min(1).max(60)).min(1).max(LIMITS.enumOptions).optional(),
    required: z.boolean().optional(),
  })
  .strict();
export const toggleComponentSchema = z
  .object({ ...componentBase, type: z.literal('toggle'), label, field: idSchema })
  .strict();
/**
 * Counter. Without `field` its value persists in the app key-value state under the
 * component id (`state.<id>` in formulas). With `field` it edits the screen form value.
 */
export const counterComponentSchema = z
  .object({
    ...componentBase,
    type: z.literal('counter'),
    label,
    field: idSchema.optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().positive().max(1_000_000).optional(),
  })
  .strict();
export const bigButtonComponentSchema = z
  .object({
    ...componentBase,
    type: z.literal('bigButton'),
    label,
    action: idSchema,
    tone: z.enum(['primary', 'secondary', 'danger']).optional(),
  })
  .strict();
export const listComponentSchema = z
  .object({
    ...componentBase,
    type: z.literal('list'),
    label: shortText.optional(),
    source: idSchema,
    primary: idSchema,
    secondary: idSchema.optional(),
    /** Formula predicate evaluated per record; bare identifiers are record fields. */
    filter: z.string().max(LIMITS.formulaLength).optional(),
    sort: z.object({ field: idSchema, direction: z.enum(['asc', 'desc']) }).strict().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    emptyText: shortText.optional(),
    /** Boolean field toggled inline (checklists, habits). */
    toggleField: idSchema.optional(),
    /** Screen opened with the tapped record selected (for update/delete actions). */
    detailScreen: idSchema.optional(),
    allowDelete: z.boolean().optional(),
  })
  .strict();
export const statComponentSchema = z
  .object({
    ...componentBase,
    type: z.literal('stat'),
    label,
    expr: z.string().min(1).max(LIMITS.formulaLength),
    format: z.enum(['number', 'integer', 'currency', 'percent', 'text']).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    prefix: z.string().max(8).optional(),
    suffix: z.string().max(12).optional(),
  })
  .strict();
export const photoComponentSchema = z
  .object({ ...componentBase, type: z.literal('photo'), label, aiBlock: idSchema.optional() })
  .strict();

export const componentSchema = z.discriminatedUnion('type', [
  textComponentSchema, headingComponentSchema, numberComponentSchema, textInputComponentSchema,
  dateComponentSchema, choiceComponentSchema, toggleComponentSchema, counterComponentSchema,
  bigButtonComponentSchema, listComponentSchema, statComponentSchema, photoComponentSchema,
]);
export const COMPONENT_TYPES = [
  'text', 'heading', 'number', 'textInput', 'date', 'choice', 'toggle', 'counter', 'bigButton', 'list',
  'stat', 'photo',
] as const;
/** Input components bind `field` to the screen form. */
export const INPUT_COMPONENT_TYPES = ['number', 'textInput', 'date', 'choice', 'toggle'] as const;

// ─── Screens (docs/05 §5) ─────────────────────────────────────────────────────
export const screenSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(LIMITS.nameLength),
    description: shortText.optional(),
    /**
     * Collection this screen's inputs bind to. When set, every input `field` must exist in
     * that collection. When absent, inputs are transient form variables (`form.<field>`),
     * e.g. calculator operands.
     */
    form: idSchema.optional(),
    children: z.array(componentSchema).max(LIMITS.componentsPerScreen),
  })
  .strict();

// ─── Actions (docs/05 §7) — finite operation set, no scripts ──────────────────
export const thenSchema = z
  .object({
    speak: z.string().min(1).max(200).optional(),
    navigate: idSchema.optional(),
    feedback: z.string().min(1).max(120).optional(),
  })
  .strict();

export const navigateActionSchema = z.object({ type: z.literal('navigate'), screen: idSchema }).strict();
/** Inserts the current screen form values that belong to `collection`, then clears the form. */
export const insertActionSchema = z
  .object({ type: z.literal('insert'), collection: idSchema, then: thenSchema.optional() })
  .strict();
/** Updates the selected record (selected via list `detailScreen`) with current form values. */
export const updateActionSchema = z
  .object({
    type: z.literal('update'),
    collection: idSchema,
    record: z.literal('selected'),
    then: thenSchema.optional(),
  })
  .strict();
export const deleteActionSchema = z
  .object({
    type: z.literal('delete'),
    collection: idSchema,
    record: z.literal('selected'),
    confirm: z.string().min(1).max(160),
    then: thenSchema.optional(),
  })
  .strict();
/** Counter operations target a counter component id (state) or a numeric form field. */
export const incrementActionSchema = z
  .object({ type: z.literal('increment'), target: idSchema, by: z.number().finite().optional() })
  .strict();
export const decrementActionSchema = z
  .object({ type: z.literal('decrement'), target: idSchema, by: z.number().finite().optional() })
  .strict();
export const resetActionSchema = z.object({ type: z.literal('reset'), target: idSchema }).strict();
export const runAIActionSchema = z
  .object({ type: z.literal('runAI'), aiBlock: idSchema, then: thenSchema.optional() })
  .strict();
export const speakActionSchema = z.object({ type: z.literal('speak'), text: z.string().min(1).max(300) }).strict();
export const feedbackActionSchema = z
  .object({
    type: z.literal('feedback'),
    message: z.string().min(1).max(160),
    tone: z.enum(['success', 'info', 'warning']).optional(),
  })
  .strict();
export const clearFormActionSchema = z.object({ type: z.literal('clearForm') }).strict();

export const actionSchema = z.discriminatedUnion('type', [
  navigateActionSchema, insertActionSchema, updateActionSchema, deleteActionSchema, incrementActionSchema,
  decrementActionSchema, resetActionSchema, runAIActionSchema, speakActionSchema, feedbackActionSchema,
  clearFormActionSchema,
]);
export const ACTION_TYPES = [
  'navigate', 'insert', 'update', 'delete', 'increment', 'decrement', 'reset', 'runAI', 'speak', 'feedback',
  'clearForm',
] as const;

// ─── AI blocks (docs/05 §9, docs/07 §13) ──────────────────────────────────────
export const verificationSchema = z
  .object({
    status: z.enum(['onDevice', 'cloudPreferred', 'unverified']),
    testCount: z.number().int().min(0).max(50),
    passCount: z.number().int().min(0).max(50),
    model: z.string().max(80).optional(),
    verifiedAt: z.number().int().optional(),
    schemaVersion: z.string().max(16).optional(),
  })
  .strict();

const aiBlockBase = {
  prompt: z.string().min(1).max(LIMITS.promptLength),
  verified: z.enum(['onDevice', 'cloudPreferred', 'unverified']),
  verification: verificationSchema.optional(),
  /** Fallback policy (docs/00 §11.5). Absent = 'cloud': one Firebase cloud attempt when allowed (lead decision 2). 'none': this device only. */
  fallback: z.enum(['cloud', 'none']).optional(),
  /** Error handling (docs/00 §11.5). The input is always kept (docs/05 §9.9); 'manual_entry' also asks the person to type the value. */
  onError: z.enum(['keep_input', 'manual_entry']).optional(),
};

/** Reads a photo and fills fields of `target` collection into the current form. */
export const extractFromPhotoBlockSchema = z
  .object({
    kind: z.literal('extractFromPhoto'),
    ...aiBlockBase,
    target: idSchema,
    fields: z.array(idSchema).min(1).max(LIMITS.fieldsPerCollection).optional(),
  })
  .strict();
/** Classifies form text `inputField` into one of `labels`, written to `outputField`. */
export const classifyBlockSchema = z
  .object({
    kind: z.literal('classify'),
    ...aiBlockBase,
    labels: z.array(z.string().min(1).max(40)).min(2).max(LIMITS.classifyLabels),
    inputField: idSchema,
    outputField: idSchema,
  })
  .strict();
export const summariseBlockSchema = z
  .object({
    kind: z.literal('summarise'),
    ...aiBlockBase,
    inputField: idSchema,
    outputField: idSchema,
    maxWords: z.number().int().min(10).max(200),
  })
  .strict();
export const translateBlockSchema = z
  .object({
    kind: z.literal('translate'),
    ...aiBlockBase,
    inputField: idSchema,
    outputField: idSchema,
    targetLang: z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/),
  })
  .strict();

export const aiBlockSchema = z.discriminatedUnion('kind', [
  extractFromPhotoBlockSchema, classifyBlockSchema, summariseBlockSchema, translateBlockSchema,
]);
export const AI_BLOCK_KINDS = ['extractFromPhoto', 'classify', 'summarise', 'translate'] as const;

// ─── Metadata ─────────────────────────────────────────────────────────────────
export const metaSchema = z
  .object({
    author: z.string().max(LIMITS.nameLength).optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative().optional(),
    basedOn: z.string().max(64).optional(),
    description: z.string().max(LIMITS.descriptionLength).optional(),
    tags: z.array(z.string().min(1).max(32)).max(LIMITS.tags).optional(),
    source: z.enum(['template', 'compiler', 'import', 'remix', 'manual']).optional(),
    /** Bazaar listing licence + remix permission (docs/12). */
    license: z.enum(['personal', 'remix_allowed', 'all_rights_reserved']).optional(),
    remixAllowed: z.boolean().optional(),
    /** Languages with a reviewed translation view (docs/14 §14.3); canonical labels stay in `lang`. */
    supportedLanguages: z.array(z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/)).max(12).optional(),
    templateId: z.string().max(40).optional(),
    generator: z
      .object({
        route: z.enum(['deterministic', 'on_device', 'cloud']),
        provider: z.string().max(40).optional(),
        model: z.string().max(80).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ─── Top level (docs/05 §2.2) ─────────────────────────────────────────────────
export const kalamSpecSchema = z
  .object({
    id: appIdSchema,
    schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    version: z.number().int().min(1),
    name: z.string().min(1).max(LIMITS.nameLength),
    description: z.string().max(LIMITS.descriptionLength).optional(),
    icon: iconSchema.optional(),
    lang: z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/),
    theme: themeSchema,
    collections: z.record(idSchema, collectionSchema),
    screens: z.array(screenSchema).min(1).max(LIMITS.screens),
    /** Deterministic initial screen (docs/05 §5.3). */
    initialScreen: idSchema,
    actions: z.record(idSchema, actionSchema),
    aiBlocks: z.record(idSchema, aiBlockSchema),
    intents: z.record(idSchema, z.array(z.string().min(1).max(60)).max(LIMITS.intentPhrasesPerAction)),
    meta: metaSchema,
  })
  .strict();

export type KalamSpec = z.infer<typeof kalamSpecSchema>;
export type KalamTheme = z.infer<typeof themeSchema>;
export type KalamIcon = z.infer<typeof iconSchema>;
export type KalamField = z.infer<typeof fieldSchema>;
export type KalamFieldType = KalamField['type'];
export type KalamCollection = z.infer<typeof collectionSchema>;
export type KalamComponent = z.infer<typeof componentSchema>;
export type KalamComponentType = KalamComponent['type'];
export type KalamScreen = z.infer<typeof screenSchema>;
export type KalamAction = z.infer<typeof actionSchema>;
export type KalamActionType = KalamAction['type'];
export type KalamThen = z.infer<typeof thenSchema>;
export type KalamAIBlock = z.infer<typeof aiBlockSchema>;
export type KalamAIBlockKind = KalamAIBlock['kind'];
export type KalamVerification = z.infer<typeof verificationSchema>;
export type KalamMeta = z.infer<typeof metaSchema>;
export type ThemePreset = (typeof THEME_PRESETS)[number];
export type IconGlyph = (typeof ICON_GLYPHS)[number];

/** Narrow helper: component of a given type. */
export type ComponentOf<T extends KalamComponentType> = Extract<KalamComponent, { type: T }>;
export type ActionOf<T extends KalamActionType> = Extract<KalamAction, { type: T }>;
export type AIBlockOf<T extends KalamAIBlockKind> = Extract<KalamAIBlock, { kind: T }>;
