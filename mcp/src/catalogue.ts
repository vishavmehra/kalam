/**
 * What a host model needs to write a KalamSpec: the JSON Schema, the limits, a short catalogue of
 * components and actions, and repair hints keyed by validateSpec error codes. Required properties are
 * read from the Zod schemas so the catalogue cannot drift from them.
 */
import { z } from 'zod';
import { FORMULA_FUNCTIONS } from '@/core/formula';
import {
  ACTION_TYPES, AI_BLOCK_KINDS, FIELD_TYPES, FONT_FAMILIES, ICON_GLYPHS, LIMITS, RESERVED_IDS, SCHEMA_VERSION,
  THEME_PRESETS, actionSchema, aiBlockSchema, componentSchema, fieldSchema, kalamSpecSchema,
} from '@/core/spec';
import { MAX_SPEC_BYTES } from '@/core/spec/validate';

const COMPONENTS: Record<string, string> = {
  text: 'A line or paragraph of fixed text.',
  heading: 'A section title.',
  number: 'A number box. Its field must be a number field when the screen has a form collection.',
  textInput: 'A text box. Its field must be a text field when the screen has a form collection. Set multiline for long text.',
  date: 'A date picker. Its field must be a date field when the screen has a form collection.',
  choice: 'Pick one option. Binds to an enum field, or needs its own options when the screen has no form collection.',
  toggle: 'A yes or no switch. Its field must be a boolean field when the screen has a form collection.',
  counter: 'A number with plus and minus buttons. Without a field it keeps its value in app state as state.<id>.',
  bigButton: 'A large button that runs one action from `actions`.',
  list: 'Shows the records of a collection. `primary` is the field shown first. Can filter, sort, toggle a yes or no field, and open a detail screen.',
  stat: 'Shows a value computed by a formula, for example sum(expenses.amount).',
  photo: 'Takes or picks a photo. Can run a read-from-photo AI block.',
};

const ACTIONS: Record<string, string> = {
  navigate: 'Opens another screen.',
  insert: "Saves the current screen's form as a new record in a collection, then clears the form.",
  update: 'Saves the form over the record picked in a list (the list must open this screen with detailScreen).',
  delete: 'Deletes the record picked in a list, after the confirm question.',
  increment: 'Adds to a counter or a number field.',
  decrement: 'Subtracts from a counter or a number field.',
  reset: 'Sets a counter or a number field back to its start value.',
  runAI: 'Runs one AI block.',
  speak: 'Reads a sentence aloud.',
  feedback: 'Shows a short message.',
  clearForm: 'Empties the form on the current screen.',
};

/** Keys of an object schema that must be present (everything except the discriminator). */
function requiredKeys(schema: unknown, discriminator: string): string[] {
  const shape = (schema as { shape?: Record<string, z.ZodType> }).shape ?? {};
  return Object.entries(shape)
    .filter(([k, s]) => k !== discriminator && !s.safeParse(undefined).success)
    .map(([k]) => k);
}

const variants = (union: unknown, key: string): Array<{ name: string; required: string[] }> =>
  ((union as { options: unknown[] }).options ?? []).map((o) => {
    const lit = (o as { shape: Record<string, { value?: unknown }> }).shape[key];
    return { name: String(lit?.value), required: requiredKeys(o, key) };
  });

let jsonSchema: Record<string, unknown> | undefined;
/** KalamSpec v1 as JSON Schema (what the strict Zod schema accepts). Built once. */
export function specJsonSchema(): Record<string, unknown> {
  jsonSchema ??= {
    title: `KalamSpec ${SCHEMA_VERSION}`,
    ...(z.toJSONSchema(kalamSpecSchema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>),
  };
  return jsonSchema;
}

export function specCatalogue() {
  return {
    schemaVersion: SCHEMA_VERSION,
    maxSpecBytes: MAX_SPEC_BYTES,
    limits: LIMITS,
    idRule: 'Ids use lowercase letters, digits and underscores, start with a letter, at most 48 characters.',
    reservedIds: RESERVED_IDS,
    components: variants(componentSchema, 'type').map((v) => ({ ...v, description: COMPONENTS[v.name] ?? '' })),
    actions: variants(actionSchema, 'type').map((v) => ({ ...v, description: ACTIONS[v.name] ?? '' })),
    fieldTypes: variants(fieldSchema, 'type'),
    aiBlockKinds: variants(aiBlockSchema, 'kind'),
    themePresets: THEME_PRESETS,
    fontFamilies: FONT_FAMILIES,
    iconGlyphs: ICON_GLYPHS,
    formulaFunctions: FORMULA_FUNCTIONS,
    formulaNames:
      'In formulas: `collection` is its list of records, `collection.field` its values, `form.field` a value on the current screen, `state.counter_id` a counter, `today` is YYYY-MM-DD and `now` is epoch ms. Inside filter() and list filters a bare name is a field of the record.',
    known: { componentTypes: Object.keys(COMPONENTS), actionTypes: ACTION_TYPES, fieldTypes: FIELD_TYPES, aiBlockKinds: AI_BLOCK_KINDS },
  };
}

/** One plain hint per validateSpec code. The error message says what is wrong; the hint says what to do. */
const HINTS: Record<string, string> = {
  SPEC_TOO_LARGE: 'Remove screens, components or long text. A spec is at most 100 KB of JSON.',
  SPEC_TOO_DEEP: 'Flatten the structure. Specs are shallow: screens hold components, nothing nests deeper.',
  INVALID_JSON: 'Send one JSON object. Check for trailing commas and unquoted keys.',
  SECURITY_CONTENT: 'Remove the script, javascript: or data:text/html text. Specs are data, never code.',
  UNSUPPORTED_SCHEMA_VERSION: `Set schemaVersion to "${SCHEMA_VERSION}".`,
  RESOURCE_LIMIT: 'Stay inside the limits in kalam_spec_schema. Split the app or drop the least useful parts.',
  SCHEMA_INVALID: 'Match the JSON Schema at this path: check required properties, types and lengths.',
  UNKNOWN_PROPERTY: 'Delete this property. Every object is strict and accepts only the properties in the schema.',
  UNKNOWN_COMPONENT_TYPE: 'Use one of the component types listed by kalam_spec_schema.',
  UNKNOWN_ACTION_TYPE: 'Use one of the action types listed by kalam_spec_schema.',
  UNKNOWN_AI_BLOCK_KIND: 'Use extractFromPhoto, classify, summarise or translate.',
  UNKNOWN_FIELD_TYPE: 'Use text, number, date, boolean or enum.',
  INVALID_ID: 'Rename the key: lowercase letters, digits and underscores, starting with a letter.',
  DUPLICATE_ID: 'Give every screen and every component its own id.',
  RESERVED_ID: 'Pick another id. Words like form, state, today, record and item are reserved.',
  UNKNOWN_SCREEN: 'Point at the id of a screen that exists, or add that screen.',
  UNKNOWN_COLLECTION: 'Point at a collection that exists in `collections`, or add it.',
  UNKNOWN_FIELD: 'Use a field id that exists in that collection, or add the field to the collection.',
  UNKNOWN_TARGET: 'Target the id of a counter component, or a number field on a screen form.',
  UNKNOWN_AI_BLOCK: 'Point at an AI block id that exists in `aiBlocks`, or add it.',
  UNKNOWN_ACTION: 'Point at an action id that exists in `actions`, or add it.',
  FIELD_TYPE_MISMATCH: 'Use the input that matches the field type: number, textInput (text), date, choice (enum), toggle (boolean).',
  INVALID_OPTIONS: "Use only options that the enum field lists, or add them to the field's options.",
  MISSING_OPTIONS: 'Give the choice its own options, or set the screen form to a collection with an enum field.',
  INVALID_FORMULA: 'Check the formula with kalam_check_formula. Only listed functions and names in scope work.',
  INCOMPATIBLE_AI_BLOCK: 'A photo component needs an extractFromPhoto AI block.',
  UNVERIFIED_AI_BLOCK: 'Fine for now. Kalam checks AI blocks on the device when the app is opened.',
  LONG_LABEL: 'Shorten the label to a few words.',
  NO_SELECTED_RECORD: 'Make a list open this screen with detailScreen so a record is selected.',
  FORM_MISMATCH: "Make the insert action save to the screen's form collection.",
  UNREACHABLE_SCREEN: 'Add a navigate button or a list detailScreen that leads here, or remove the screen.',
  UNUSED_COLLECTION: 'Show the collection in a list, a form or a stat, or remove it.',
};

export const hintFor = (code: string): string | undefined => HINTS[code];
