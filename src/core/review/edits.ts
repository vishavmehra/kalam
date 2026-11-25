/**
 * Understanding Review edits (docs/01 §7.4, docs/03 §13.3, docs/06 §11.5, docs/15 §8.9). Each edit
 * takes a valid spec and returns a new valid spec, or a plain-language rejection: the draft never
 * holds an invalid app and the input is never mutated. Simple edits reuse the constrained patch ops
 * in src/core/edit. Edits that would break references (removing a screen, changing a field's type)
 * repair the references they own; any other conflict is left to validateSpec, and its first error
 * becomes the message.
 */
import type { SpecIssue, SpecPatchOp } from '../contracts';
import { applyPatchOps } from '../edit';
import {
  INPUT_COMPONENT_TYPES, LIMITS, type KalamComponent, type KalamField, type KalamFieldType, type KalamSpec, type ThemePreset,
} from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { toIdentifier } from '../templates/extract';
import { REVIEW_COPY } from './copy';

export interface FieldChanges {
  label?: string;
  type?: KalamFieldType;
  required?: boolean;
  /** Choices for a choice field (type 'enum'). Ignored for other types. */
  options?: string[];
}
export interface NewField {
  label: string;
  type: KalamFieldType;
  required?: boolean;
  options?: string[];
}

export type ReviewEdit =
  | { kind: 'renameApp'; name: string }
  | { kind: 'setTheme'; preset: ThemePreset }
  | { kind: 'addScreen'; title: string }
  | { kind: 'removeScreen'; screenId: string }
  | { kind: 'renameScreen'; screenId: string; title: string }
  | { kind: 'moveScreen'; screenId: string; toIndex: number }
  /** Adds a button on the start screen that opens this screen. */
  | { kind: 'linkScreen'; screenId: string }
  | { kind: 'editField'; collectionId: string; fieldId: string; changes: FieldChanges }
  | { kind: 'addField'; collectionId: string; field: NewField }
  | { kind: 'removeField'; collectionId: string; fieldId: string }
  /** Button and other component labels (docs/06 §11.5). */
  | { kind: 'renameComponent'; componentId: string; label: string }
  /** Role of a piece of text: a heading or plain text (docs/06 §11.5, docs/08 §15.8). */
  | { kind: 'setRole'; componentId: string; role: 'heading' | 'text' }
  | { kind: 'removeComponent'; componentId: string }
  | { kind: 'removeCollection'; collectionId: string }
  | { kind: 'removeAIBlock'; blockId: string };

export type ReviewResult =
  | { ok: true; spec: KalamSpec }
  | { ok: false; error: string; issues: SpecIssue[] };

// ─── Helpers ──────────────────────────────────────────────────────────────────
const reject = (error: string, issues: SpecIssue[] = []): ReviewResult => ({ ok: false, error, issues });
const clone = (spec: KalamSpec): KalamSpec => JSON.parse(JSON.stringify(spec)) as KalamSpec;
const own = <T>(rec: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(rec, key) ? rec[key] : undefined);
const defined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Single-spaced, trimmed text of 1..max characters, or undefined. */
function cleanText(raw: string, max: number): string | undefined {
  const t = raw.replace(/\s+/g, ' ').trim();
  return t && t.length <= max ? t : undefined;
}

/** Trimmed, de-duplicated choices; null when there are too many or one is too long. */
function cleanOptions(list: readonly string[]): string[] | null {
  const out = [...new Set(list.map((o) => o.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  return out.length > LIMITS.enumOptions || out.some((o) => o.length > 60) ? null : out;
}

/** The first validation problem as a plain sentence (no ids or schema paths). */
export function explainIssues(errors: readonly SpecIssue[]): string {
  const first = errors[0];
  if (!first) return REVIEW_COPY.unchanged;
  if (first.path.startsWith('aiBlocks') && first.code === 'UNKNOWN_FIELD') return REVIEW_COPY.usedByAI;
  return REVIEW_COPY.byCode[first.code] ?? REVIEW_COPY.unchanged;
}

/** Where a validation path points, by id (for naming the item that needs a fix, docs/03 §13.5). */
export function locateIssue(spec: KalamSpec, path: string): { type: 'screen' | 'component' | 'collection' | 'aiBlock'; id: string } | undefined {
  const s = /^screens\[(\d+)\](?:\.children\[(\d+)\])?/.exec(path);
  if (s) {
    const screen = spec.screens[Number(s[1])];
    const component = s[2] !== undefined ? screen?.children[Number(s[2])] : undefined;
    if (component) return { type: 'component', id: component.id };
    return screen ? { type: 'screen', id: screen.id } : undefined;
  }
  const k = /^(collections|aiBlocks)\.([a-z][a-z0-9_]*)/.exec(path);
  if (!k?.[2]) return undefined;
  return { type: k[1] === 'collections' ? 'collection' : 'aiBlock', id: k[2] };
}

function commit(draft: KalamSpec): ReviewResult {
  const v = validateSpec(draft);
  return v.ok && v.spec ? { ok: true, spec: v.spec } : reject(explainIssues(v.errors), v.errors);
}

function viaOps(spec: KalamSpec, ops: SpecPatchOp[]): ReviewResult {
  const r = applyPatchOps(spec, ops);
  return r.ok && r.spec ? { ok: true, spec: r.spec } : reject(explainIssues(r.errors), r.errors);
}

function idsIn(spec: KalamSpec) {
  return {
    screens: new Set(spec.screens.map((s) => s.id)),
    components: new Set(spec.screens.flatMap((s) => s.children.map((c) => c.id))),
    actions: new Set(Object.keys(spec.actions)),
  };
}

/** Adds an "Open <title>" button to the start screen, so a screen can be reached. Mutates the draft. */
function linkFromStart(d: KalamSpec, screenId: string, title: string): void {
  const start = d.screens.find((s) => s.id === d.initialScreen);
  if (!start || start.id === screenId) return;
  const ids = idsIn(d);
  const action = toIdentifier(`open_${screenId}`, ids.actions, 'open');
  d.actions[action] = { type: 'navigate', screen: screenId };
  start.children.push({
    id: toIdentifier(`open_${screenId}_button`, ids.components, 'button'), type: 'bigButton',
    label: REVIEW_COPY.openScreen(title), action, tone: 'secondary',
  });
}

/** Removes actions together with the buttons and voice phrases that trigger them. Mutates the draft. */
function dropActions(d: KalamSpec, ids: ReadonlySet<string>): void {
  if (!ids.size) return;
  for (const id of ids) {
    delete d.actions[id];
    delete d.intents[id];
  }
  for (const s of d.screens) s.children = s.children.filter((c) => !(c.type === 'bigButton' && ids.has(c.action)));
}

// ─── Fields and the inputs bound to them ──────────────────────────────────────
type InputType = (typeof INPUT_COMPONENT_TYPES)[number];
const INPUTS: ReadonlySet<string> = new Set(INPUT_COMPONENT_TYPES);
/** Input component that edits each field type (docs/05 §13.4). */
const INPUT_FOR: Record<KalamFieldType, InputType> = { text: 'textInput', number: 'number', date: 'date', enum: 'choice', boolean: 'toggle' };

interface InputProps {
  id: string; label: string; field: string;
  visible?: boolean; secondary?: boolean; a11yLabel?: string; a11yDescription?: string; readAloud?: string;
  required?: boolean; placeholder?: string; multiline?: boolean; options?: string[];
}

const isInputFor = (c: KalamComponent, field: string): boolean => INPUTS.has(c.type) && (c as { field?: string }).field === field;

/** An input of `type` with only the properties that type allows (component schemas are strict). */
function makeInput(type: InputType, p: InputProps): KalamComponent {
  const base = defined({
    id: p.id, label: p.label, field: p.field, visible: p.visible, secondary: p.secondary,
    a11yLabel: p.a11yLabel, a11yDescription: p.a11yDescription, readAloud: p.readAloud,
  });
  const required = p.required ? { required: true } : {};
  switch (type) {
    case 'textInput': return { ...base, type, ...required, ...defined({ placeholder: p.placeholder, multiline: p.multiline }) };
    case 'number': return { ...base, type, ...required, ...defined({ placeholder: p.placeholder }) };
    case 'date': return { ...base, type, ...required };
    case 'choice': return { ...base, type, ...required, ...(p.options ? { options: p.options } : {}) };
    case 'toggle': return { ...base, type };
  }
}

function freshField(type: KalamFieldType, label: string, required: boolean, options?: string[]): KalamField {
  const common = { label, ...(required ? { required: true } : {}) };
  switch (type) {
    case 'text': return { type, ...common };
    case 'number': return { type, ...common };
    case 'date': return { type, ...common };
    case 'boolean': return { type, ...common };
    case 'enum': return { type, ...common, options: options ?? [] };
  }
}

/** Same type: keeps unit, limits and other settings. New type: a clean field of that type. */
function nextField(old: KalamField, type: KalamFieldType, label: string, required: boolean, options?: string[]): KalamField {
  if (type !== old.type) return freshField(type, label, required, options);
  const kept: KalamField = { ...old, label };
  if (required) kept.required = true;
  else delete kept.required;
  if (kept.type === 'enum' && options) {
    kept.options = options;
    if (kept.defaultValue !== undefined && !options.includes(kept.defaultValue)) delete kept.defaultValue;
  }
  return kept;
}

/** "Chest (in)" with "Chest" → "Chest size" gives "Chest size (in)". Unrelated labels stay as they are. */
function relabel(current: string, from: string, to: string): string {
  const i = current.toLowerCase().indexOf(from.toLowerCase());
  return i < 0 ? current : `${current.slice(0, i)}${to}${current.slice(i + from.length)}`.slice(0, LIMITS.labelLength);
}

// ─── Edits ────────────────────────────────────────────────────────────────────
/** Applies one review edit. Never mutates `spec`; the result is validated. */
export function applyReviewEdit(spec: KalamSpec, edit: ReviewEdit): ReviewResult {
  switch (edit.kind) {
    case 'renameApp': {
      const name = cleanText(edit.name, LIMITS.nameLength);
      return name ? viaOps(spec, [{ op: 'setAppName', value: name }]) : reject(REVIEW_COPY.appName);
    }
    case 'setTheme':
      return viaOps(spec, [{ op: 'setThemePreset', preset: edit.preset }]);

    case 'renameScreen': {
      const title = cleanText(edit.title, LIMITS.nameLength);
      return title ? viaOps(spec, [{ op: 'renameScreen', screen: edit.screenId, title }]) : reject(REVIEW_COPY.screenName);
    }
    case 'addScreen': {
      const title = cleanText(edit.title, LIMITS.nameLength);
      if (!title) return reject(REVIEW_COPY.screenName);
      if (spec.screens.length >= LIMITS.screens) return reject(REVIEW_COPY.tooManyScreens);
      const d = clone(spec);
      const ids = idsIn(d);
      const id = toIdentifier(title, ids.screens, 'screen');
      d.screens.push({ id, title, children: [{ id: toIdentifier(`${id}_title`, ids.components, 'heading'), type: 'heading', label: title }] });
      linkFromStart(d, id, title);
      return commit(d);
    }
    case 'linkScreen': {
      const screen = spec.screens.find((s) => s.id === edit.screenId);
      if (!screen) return reject(REVIEW_COPY.missing);
      const d = clone(spec);
      linkFromStart(d, screen.id, screen.title);
      return commit(d);
    }
    case 'moveScreen': {
      const from = spec.screens.findIndex((s) => s.id === edit.screenId);
      if (from < 0) return reject(REVIEW_COPY.missing);
      const to = Number.isFinite(edit.toIndex) ? Math.max(0, Math.min(spec.screens.length - 1, Math.round(edit.toIndex))) : from;
      if (to === from) return { ok: true, spec };
      const d = clone(spec);
      const [moved] = d.screens.splice(from, 1);
      if (moved) d.screens.splice(to, 0, moved);
      return commit(d); // the start screen is set by id, so order never changes where the app opens
    }
    case 'removeScreen': {
      const gone = spec.screens.find((s) => s.id === edit.screenId);
      if (!gone) return reject(REVIEW_COPY.missing);
      if (spec.screens.length === 1) return reject(REVIEW_COPY.lastScreen);
      const d = clone(spec);
      const goneComponents = new Set(gone.children.map((c) => c.id));
      d.screens = d.screens.filter((s) => s.id !== gone.id);
      if (d.initialScreen === gone.id) d.initialScreen = d.screens[0]?.id ?? d.initialScreen;
      // Actions that only made sense with the screen: opening it, or counting on a counter that was on it.
      const dead = new Set<string>();
      for (const [id, a] of Object.entries(d.actions)) {
        if (a.type === 'navigate' && a.screen === gone.id) dead.add(id);
        else if ((a.type === 'increment' || a.type === 'decrement' || a.type === 'reset') && goneComponents.has(a.target)) dead.add(id);
        else if ('then' in a && a.then && a.then.navigate === gone.id) {
          delete a.then.navigate;
          if (!Object.keys(a.then).length) delete a.then;
        }
      }
      dropActions(d, dead);
      for (const s of d.screens) for (const c of s.children) if (c.type === 'list' && c.detailScreen === gone.id) delete c.detailScreen;
      return commit(d);
    }

    case 'editField': {
      const col = own(spec.collections, edit.collectionId);
      const old = col ? own(col.fields, edit.fieldId) : undefined;
      if (!old) return reject(REVIEW_COPY.missing);
      const c = edit.changes;
      const label = c.label === undefined ? old.label : cleanText(c.label, LIMITS.labelLength);
      if (!label) return reject(REVIEW_COPY.fieldName);
      const type = c.type ?? old.type;
      const options = c.options === undefined ? (old.type === 'enum' ? old.options : undefined) : cleanOptions(c.options);
      if (options === null) return reject(REVIEW_COPY.optionText);
      if (type === 'enum' && !options?.length) return reject(REVIEW_COPY.needOptions);
      const required = c.required ?? old.required === true;
      const d = clone(spec);
      d.collections[edit.collectionId]!.fields[edit.fieldId] = nextField(old, type, label, required, options);
      for (const s of d.screens) {
        if (s.form !== edit.collectionId) continue;
        s.children = s.children.map((comp) => {
          if (!isInputFor(comp, edit.fieldId)) return comp;
          const p = comp as unknown as InputProps;
          const nextType = INPUT_FOR[type];
          return makeInput(nextType, {
            ...p,
            label: label === old.label ? p.label : relabel(p.label, old.label, label),
            // The field decides; an input may only add "required" while the field is required.
            required: required && p.required === true,
            // Changed choices: the input shows the field's list instead of an old copy of it.
            options: comp.type === nextType && c.options === undefined ? p.options : undefined,
          });
        });
      }
      return commit(d);
    }
    case 'addField': {
      const col = own(spec.collections, edit.collectionId);
      if (!col) return reject(REVIEW_COPY.missing);
      const label = cleanText(edit.field.label, LIMITS.labelLength);
      if (!label) return reject(REVIEW_COPY.fieldName);
      const options = edit.field.options ? cleanOptions(edit.field.options) : undefined;
      if (options === null) return reject(REVIEW_COPY.optionText);
      if (edit.field.type === 'enum' && !options?.length) return reject(REVIEW_COPY.needOptions);
      if (Object.keys(col.fields).length >= LIMITS.fieldsPerCollection) return reject(REVIEW_COPY.tooManyFields);
      const d = clone(spec);
      const ids = idsIn(d);
      const fieldId = toIdentifier(label, new Set(Object.keys(col.fields)), 'field');
      const required = edit.field.required === true;
      d.collections[edit.collectionId]!.fields[fieldId] = freshField(edit.field.type, label, required, options);
      // Every screen that fills in these entries gets an input for the new field, above its buttons.
      for (const s of d.screens) {
        if (s.form !== edit.collectionId) continue;
        const input = makeInput(INPUT_FOR[edit.field.type], { id: toIdentifier(`${fieldId}_input`, ids.components, 'input'), label, field: fieldId });
        const at = s.children.findIndex((x) => x.type === 'bigButton');
        s.children.splice(at < 0 ? s.children.length : at, 0, input);
      }
      return commit(d);
    }
    case 'removeField': {
      const col = own(spec.collections, edit.collectionId);
      if (!col || !own(col.fields, edit.fieldId)) return reject(REVIEW_COPY.missing);
      const d = clone(spec);
      const fields = d.collections[edit.collectionId]!.fields;
      delete fields[edit.fieldId];
      const remaining = Object.keys(fields);
      for (const s of d.screens) {
        if (s.form === edit.collectionId) s.children = s.children.filter((x) => !isInputFor(x, edit.fieldId));
        for (const x of s.children) {
          if (x.type !== 'list' || x.source !== edit.collectionId) continue;
          if (x.secondary === edit.fieldId) delete x.secondary;
          if (x.sort?.field === edit.fieldId) delete x.sort;
          if (x.toggleField === edit.fieldId) delete x.toggleField;
          if (x.primary === edit.fieldId) {
            const next = remaining.find((f) => fields[f]?.type === 'text') ?? remaining[0];
            if (!next) return reject(REVIEW_COPY.lastField);
            x.primary = next;
          }
        }
      }
      for (const b of Object.values(d.aiBlocks)) {
        if (b.kind !== 'extractFromPhoto' || b.target !== edit.collectionId || !b.fields) continue;
        b.fields = b.fields.filter((f) => f !== edit.fieldId);
        if (!b.fields.length) delete b.fields; // the step then reads every field that is left
      }
      return commit(d);
    }

    case 'renameComponent': {
      const label = cleanText(edit.label, LIMITS.labelLength);
      return label ? viaOps(spec, [{ op: 'renameComponent', component: edit.componentId, label }]) : reject(REVIEW_COPY.labelText);
    }
    case 'setRole': {
      const target = spec.screens.flatMap((s) => s.children).find((x) => x.id === edit.componentId);
      if (!target) return reject(REVIEW_COPY.missing);
      if (target.type !== 'heading' && target.type !== 'text') return reject(REVIEW_COPY.unchanged);
      if (target.type === edit.role) return { ok: true, spec };
      const d = clone(spec);
      for (const s of d.screens) {
        s.children = s.children.map((x): KalamComponent => (x.id === edit.componentId && (x.type === 'heading' || x.type === 'text') ? { ...x, type: edit.role } : x));
      }
      return commit(d);
    }
    case 'removeComponent':
      return viaOps(spec, [{ op: 'removeComponent', component: edit.componentId }]);
    case 'removeCollection': {
      if (!own(spec.collections, edit.collectionId)) return reject(REVIEW_COPY.missing);
      const d = clone(spec);
      delete d.collections[edit.collectionId];
      return commit(d);
    }
    case 'removeAIBlock': {
      if (!own(spec.aiBlocks, edit.blockId)) return reject(REVIEW_COPY.missing);
      const d = clone(spec);
      delete d.aiBlocks[edit.blockId];
      dropActions(d, new Set(Object.entries(d.actions).filter(([, a]) => a.type === 'runAI' && a.aiBlock === edit.blockId).map(([id]) => id)));
      for (const s of d.screens) for (const x of s.children) if (x.type === 'photo' && x.aiBlock === edit.blockId) delete x.aiBlock;
      return commit(d);
    }
  }
}

// ─── What the review shows, with the ids its controls need ─────────────────────
export interface ReviewModel {
  name: string;
  theme?: ThemePreset;
  screens: Array<{
    id: string; title: string; start: boolean;
    /** Every component in screen order; `label` is absent for the few kinds without one. */
    components: Array<{ id: string; type: KalamComponent['type']; label?: string }>;
  }>;
  collections: Array<{
    id: string; name: string;
    fields: Array<{ id: string; label: string; type: KalamFieldType; required: boolean; options?: string[] }>;
  }>;
}

const humanize = (id: string): string => {
  const s = id.replace(/_+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Editable view of the draft. Ids are for the controls only; never show them (docs/02 §11.5). */
export function reviewModel(spec: KalamSpec): ReviewModel {
  return {
    name: spec.name,
    ...(spec.theme.preset ? { theme: spec.theme.preset } : {}),
    screens: spec.screens.map((s) => ({
      id: s.id, title: s.title, start: s.id === spec.initialScreen,
      components: s.children.map((c) => ({ id: c.id, type: c.type, ...('label' in c && c.label ? { label: c.label } : {}) })),
    })),
    collections: Object.entries(spec.collections).map(([id, c]) => ({
      id,
      name: c.label || humanize(id),
      fields: Object.entries(c.fields).map(([fid, f]) => ({
        id: fid, label: f.label, type: f.type, required: f.required === true, ...(f.type === 'enum' ? { options: f.options } : {}),
      })),
    })),
  };
}
