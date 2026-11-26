/**
 * KalamSpec v1 — canonical Zod schema (source of truth, docs/05_KALAMSPEC.md §14).
 *
 * KalamSpec is DATA, never code. Every untrusted boundary (compiler output, import,
 * marketplace, restore) must pass `validateSpec` (src/core/spec/validate.ts), which
 * runs this structural schema first and then resource / reference / formula /
 * security checks. Objects are strict: unknown properties are rejected.
 */
import { z } from 'zod';
// The limits policy is pure data with no imports, so it cannot start a cycle.
import { limitsPolicy } from '../limits/policy';
// Imports only zod (no cycle). The chart is R1's v1.1 proposal; its parts are reused here unchanged.
import {
  CHART_KINDS, METRIC_OPERATIONS, reportFilterSchema, reportRangeSchema, timeUnitSchema,
} from '../reports/chart-component';

// Zod's JIT probes `new Function("")`, which our CSP (no unsafe-eval) blocks. Jitless parsing avoids the
// probe entirely (security review R-03). Runs at import time, before any schema is used.
z.config({ jitless: true });

/**
 * 1.1 is additive (docs/05 §15.2): relations, layout groups, per-component style, chart, timer,
 * reminder, signature and the permissions / accessibility / settings / localization sections. Every
 * 1.0 document is still valid; `migrate.ts` raises its version number, nothing else.
 */
export const SCHEMA_VERSION = '1.1.0';

/**
 * Resource limits (docs/05 §13.2 plus Kalam implementation limits). The numbers live in ONE place, the versioned
 * limits policy (docs/04 §6.6), so the compiler, the validator and the runtime enforce the same ones. Read-only.
 */
export const LIMITS = limitsPolicy.spec;

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
  // Key that remembers "Not now" for an app's suggested Access Modes (core/spec/v11.ts).
  'kalam_suggested_modes',
  // Key the runtime keeps an unsent form draft under, so a killed process loses no typing (engine/draft.ts).
  'kalam_draft',
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

/**
 * v1.1 relation (docs/00 §11.3): the text field stores the id of one record of `collection`.
 * `display` is the field of that collection people see. `onDelete` decides what happens to this
 * record when the other one is deleted; absent means `restrict` (the delete is refused).
 */
export const ON_DELETE_RULES = ['restrict', 'cascade', 'clear'] as const;
export const relationSchema = z
  .object({ collection: idSchema, display: idSchema.optional(), onDelete: z.enum(ON_DELETE_RULES).optional() })
  .strict();

export const textFieldSchema = z
  .object({
    type: z.literal('text'),
    ...fieldBase,
    defaultValue: z.string().max(500).optional(),
    placeholder: shortText.optional(),
    multiline: z.boolean().optional(),
    maxLength: z.number().int().min(1).max(5000).optional(),
    ref: relationSchema.optional(),
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

/**
 * v1.1 photo kept with an entry. The value is a reference to a picture stored on this device
 * (LOCAL_MEDIA_REF), never a URL and never an upload. A photo component with `field` fills it.
 */
export const imageFieldSchema = z.object({ type: z.literal('image'), ...fieldBase }).strict();
export const LOCAL_MEDIA_REF = /^local:[A-Za-z0-9_-]{1,64}$/;

export const fieldSchema = z.discriminatedUnion('type', [
  textFieldSchema, numberFieldSchema, dateFieldSchema, booleanFieldSchema, enumFieldSchema, imageFieldSchema,
]);
export const FIELD_TYPES = ['text', 'number', 'date', 'boolean', 'enum', 'image'] as const;

export const collectionSchema = z
  .object({
    label: shortText.optional(),
    fields: z.record(idSchema, fieldSchema),
  })
  .strict();

// ─── Per-component style (v1.1, docs/14 §4.4) ─────────────────────────────────
/** Named choices only. Colours come from the app theme's palette, never from the spec. No CSS. */
export const STYLE_SIZES = ['small', 'medium', 'large'] as const;
export const STYLE_EMPHASIS = ['subtle', 'normal', 'strong'] as const;
export const STYLE_TONES = ['neutral', 'primary', 'secondary', 'success', 'warning', 'danger'] as const;
export const STYLE_ALIGN = ['start', 'center', 'end'] as const;
export const componentStyleSchema = z
  .object({
    size: z.enum(STYLE_SIZES).optional(),
    emphasis: z.enum(STYLE_EMPHASIS).optional(),
    tone: z.enum(STYLE_TONES).optional(),
    align: z.enum(STYLE_ALIGN).optional(),
    fullWidth: z.boolean().optional(),
  })
  .strict();

// ─── Components v1 (docs/05 §6) ───────────────────────────────────────────────
/**
 * How much a person who turned on Simple mode needs a component (docs/10 §4.3). Unset means standard.
 * Essential is never folded away; standard stays; secondary is folded behind "Show more". Only a component
 * marked secondary is ever hidden automatically, and nothing is deleted: turning Simple mode off, or
 * "Show more", brings it back.
 */
export const IMPORTANCE_LEVELS = ['essential', 'standard', 'secondary'] as const;
const componentBase = {
  id: idSchema,
  visible: z.boolean().optional(),
  /** The 1.0 spelling of `importance: "secondary"` (a list uses this name for its second-line field instead). */
  secondary: z.boolean().optional(),
  /** v1.1: the three Simple-mode levels. Wins over `secondary` when both are given. */
  importance: z.enum(IMPORTANCE_LEVELS).optional(),
  a11yLabel: shortText.optional(),
  /** Accessibility description (docs/05 §11.1). */
  a11yDescription: z.string().max(300).optional(),
  readAloud: z.string().max(300).optional(),
  /** v1.1 */
  style: componentStyleSchema.optional(),
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
/** With `field` (v1.1) the picture is kept in that image field of the screen form's entry. */
export const photoComponentSchema = z
  .object({ ...componentBase, type: z.literal('photo'), label, aiBlock: idSchema.optional(), field: idSchema.optional() })
  .strict();

// ─── Components v1.1 (docs/05 §6 "later components") ──────────────────────────
/**
 * Chart: R1's proposal (src/core/reports/chart-component.ts) plus `style`. Cross-field rules
 * (split by a field or a period, count takes no field) are checked in validate.ts.
 */
export const chartComponentSchema = z
  .object({
    ...componentBase,
    type: z.literal('chart'),
    label,
    chart: z.enum(CHART_KINDS),
    source: idSchema,
    metric: z.enum(METRIC_OPERATIONS),
    valueField: idSchema.optional(),
    groupBy: idSchema.optional(),
    period: timeUnitSchema.optional(),
    dateField: idSchema.optional(),
    range: reportRangeSchema.optional(),
    filters: z.array(reportFilterSchema).max(3).optional(),
  })
  .strict();
/** Countdown or stopwatch. With `field` the time lands in that number field of the screen form. */
export const timerComponentSchema = z
  .object({
    ...componentBase,
    type: z.literal('timer'),
    label,
    mode: z.enum(['countdown', 'stopwatch']),
    durationSec: z.number().int().min(1).max(LIMITS.timerSeconds).optional(),
    field: idSchema.optional(),
    unit: z.enum(['seconds', 'minutes']).optional(),
  })
  .strict();
/**
 * Reminder for dated entries of `source` (docs/14 §10). The person switches it on; nothing is
 * scheduled before that. `doneField` (yes/no) skips finished entries. `{title}` in `message` is
 * replaced by the entry's name.
 */
export const reminderComponentSchema = z
  .object({
    ...componentBase,
    type: z.literal('reminder'),
    label,
    source: idSchema,
    dateField: idSchema,
    leadDays: z.number().int().min(0).max(30).optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Times are HH:MM, 24 hour').optional(),
    doneField: idSchema.optional(),
    titleField: idSchema.optional(),
    message: z.string().min(1).max(120).optional(),
  })
  .strict();
/** Signature pad. The drawing is stored as plain numbers in a text field, never as markup. */
export const signatureComponentSchema = z
  .object({ ...componentBase, type: z.literal('signature'), label, field: idSchema, required: z.boolean().optional() })
  .strict();

export const componentSchema = z.discriminatedUnion('type', [
  textComponentSchema, headingComponentSchema, numberComponentSchema, textInputComponentSchema,
  dateComponentSchema, choiceComponentSchema, toggleComponentSchema, counterComponentSchema,
  bigButtonComponentSchema, listComponentSchema, statComponentSchema, photoComponentSchema,
  chartComponentSchema, timerComponentSchema, reminderComponentSchema, signatureComponentSchema,
]);
export const V11_COMPONENT_TYPES = ['chart', 'timer', 'reminder', 'signature'] as const;
export const COMPONENT_TYPES = [
  'text', 'heading', 'number', 'textInput', 'date', 'choice', 'toggle', 'counter', 'bigButton', 'list',
  'stat', 'photo', ...V11_COMPONENT_TYPES,
] as const;
/** Input components bind `field` to the screen form. */
export const INPUT_COMPONENT_TYPES = ['number', 'textInput', 'date', 'choice', 'toggle'] as const;

// ─── Layout groups (v1.1, docs/05 §5.1 "layout configuration", docs/14 §4.4) ──
/**
 * Presentation only. Components stay in the flat `children` list (so every data, voice and history
 * path keeps finding them); a group names the ids it arranges. A component sits in at most one
 * group, groups nest at most LIMITS.layoutDepth deep. Unlisted components render as before.
 */
export const LAYOUT_TYPES = ['row', 'grid', 'card'] as const;
export interface KalamLayoutNode {
  type: (typeof LAYOUT_TYPES)[number];
  /** Cards only. */
  title?: string;
  /** Grids only, 2 to 4. */
  columns?: number;
  style?: z.infer<typeof componentStyleSchema>;
  /** Component ids on this screen, or nested groups. */
  children: Array<string | KalamLayoutNode>;
}
export const layoutNodeSchema: z.ZodType<KalamLayoutNode> = z.lazy(() =>
  z
    .object({
      type: z.enum(LAYOUT_TYPES),
      title: shortText.optional(),
      columns: z.number().int().min(2).max(4).optional(),
      style: componentStyleSchema.optional(),
      children: z.array(z.union([idSchema, layoutNodeSchema])).min(1).max(LIMITS.layoutChildren),
    })
    .strict(),
);

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
    /** v1.1 */
    layout: z.array(layoutNodeSchema).min(1).max(LIMITS.layoutNodesPerScreen).optional(),
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
/** A fixed value an update writes: "Mark done" sets done = true without any input (v1.1). */
export const setValueSchema = z.union([z.string().max(500), z.number().finite(), z.boolean()]);
/** Updates the selected record (selected via list `detailScreen`) with current form values. */
export const updateActionSchema = z
  .object({
    type: z.literal('update'),
    collection: idSchema,
    record: z.literal('selected'),
    /** v1.1: field → fixed value, written together with the screen's inputs (keys are fields of `collection`). */
    set: z.record(idSchema, setValueSchema).optional(),
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
/**
 * v1.1 (docs/05 §7.2 "execute an approved formula"): evaluates one formula with the whitelist engine and
 * writes the result to `target`, a counter id (kept in app state) or a field of the current screen's form.
 * The formula is the same language as a stat's `expr`, checked when the spec is validated. No code runs.
 */
export const computeActionSchema = z
  .object({ type: z.literal('compute'), formula: z.string().min(1).max(LIMITS.formulaLength), target: idSchema, then: thenSchema.optional() })
  .strict();

export const actionSchema = z.discriminatedUnion('type', [
  navigateActionSchema, insertActionSchema, updateActionSchema, deleteActionSchema, incrementActionSchema,
  decrementActionSchema, resetActionSchema, runAIActionSchema, speakActionSchema, feedbackActionSchema,
  clearFormActionSchema, computeActionSchema,
]);
export const ACTION_TYPES = [
  'navigate', 'insert', 'update', 'delete', 'increment', 'decrement', 'reset', 'runAI', 'speak', 'feedback',
  'clearForm',
] as const;
/** Action types added in 1.1. Kept apart from ACTION_TYPES, which is what the compiler may write (hand-made and template specs may use these). */
export const V11_ACTION_TYPES = ['compute'] as const;

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

// ─── v1.1 sections (docs/00 §11.1) ────────────────────────────────────────────
const langCode = z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/);
/** Device capabilities the app uses, each with a plain reason shown to the person. */
export const PERMISSION_KINDS = ['camera', 'notifications'] as const;
export const permissionsSchema = z
  .array(z.object({ kind: z.enum(PERMISSION_KINDS), reason: label }).strict())
  .max(PERMISSION_KINDS.length);
/**
 * Modes the app suggests. Only offered: nothing changes until the person taps "Turn on", and then
 * they become the person's own modes (core/spec/v11.ts offeredAccessModes). Never removes a mode.
 */
export const SUGGESTED_MODES = ['large', 'highContrast', 'simple', 'readAloud'] as const;
export const accessibilitySchema = z
  .object({
    /** One or two sentences a screen reader can say about the whole app. */
    summary: z.string().min(1).max(300).optional(),
    suggestedModes: z.array(z.enum(SUGGESTED_MODES)).max(SUGGESTED_MODES.length).optional(),
  })
  .strict();
export const settingsSchema = z
  .object({
    /** Default currency for money values (ISO 4217). */
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    timeFormat: z.enum(['12h', '24h']).optional(),
  })
  .strict();
/**
 * Terminology constraints for translation (docs/05 §9.7): `keep` never translates the term (names,
 * brands, trade words); `translations` fixes the word per language. One or the other.
 * The list of reviewed languages stays in `meta.supportedLanguages` (already used by the Bazaar).
 */
export const terminologySchema = z
  .object({
    term: z.string().min(1).max(60),
    keep: z.boolean().optional(),
    translations: z.record(langCode, z.string().min(1).max(60)).optional(),
  })
  .strict();
export const localizationSchema = z
  .object({ terminology: z.array(terminologySchema).max(LIMITS.terminology).optional() })
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
    // v1.1 sections, all optional.
    permissions: permissionsSchema.optional(),
    accessibility: accessibilitySchema.optional(),
    settings: settingsSchema.optional(),
    localization: localizationSchema.optional(),
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
export type KalamRelation = z.infer<typeof relationSchema>;
export type OnDeleteRule = (typeof ON_DELETE_RULES)[number];
export type KalamComponentStyle = z.infer<typeof componentStyleSchema>;
export type KalamImportance = (typeof IMPORTANCE_LEVELS)[number];
export type StyleTone = (typeof STYLE_TONES)[number];
export type LayoutType = (typeof LAYOUT_TYPES)[number];
export type PermissionKind = (typeof PERMISSION_KINDS)[number];
export type SuggestedMode = (typeof SUGGESTED_MODES)[number];
export type KalamPermission = z.infer<typeof permissionsSchema>[number];
export type KalamAccessibility = z.infer<typeof accessibilitySchema>;
/** Named apart from contracts' KalamSettings (Kalam's own settings). */
export type KalamAppSettings = z.infer<typeof settingsSchema>;
export type KalamTerm = z.infer<typeof terminologySchema>;
export type KalamLocalization = z.infer<typeof localizationSchema>;

/** Narrow helper: component of a given type. */
export type ComponentOf<T extends KalamComponentType> = Extract<KalamComponent, { type: T }>;
export type ActionOf<T extends KalamActionType> = Extract<KalamAction, { type: T }>;
export type AIBlockOf<T extends KalamAIBlockKind> = Extract<KalamAIBlock, { kind: T }>;
