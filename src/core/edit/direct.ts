/**
 * Direct manipulation of one part of an app (docs/14 §4.2, docs/00 §24.1, docs/03 §17.2): move, move
 * to another screen, resize, rename, required, field type, duplicate. Each function takes a spec and
 * returns a new spec that passed validateSpec, or a reason code the UI turns into plain words.
 * Same-screen order and renames go through applyPatchOps; the rest (a screen move, style, field
 * type) have no patch op yet, so they edit a copy and let validateSpec decide. Never mutates input.
 * Pure TypeScript. No record values are read: callers say whether a collection holds entries.
 */
import { applyPatchOps } from './apply';
import { findPart, freshId, moveOps } from './visual-edit';
import {
  STYLE_SIZES, type KalamComponent, type KalamComponentStyle, type KalamField, type KalamSpec,
} from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { removeFromLayout } from '../spec/v11';

export type StyleSize = (typeof STYLE_SIZES)[number];
export type DirectKind =
  | 'moved' | 'movedToScreen' | 'resized' | 'widened' | 'renamed' | 'required' | 'optional' | 'retyped' | 'duplicated';
/**
 * missing: no such part or screen. same: nothing would change. stays: this part works with the fields
 * of its screen. hasEntries: changing the type could lose saved entries. unsupported: not for this part.
 * invalid: the result failed validation (`detail` is the validator's words).
 */
export type DirectFailure = 'missing' | 'same' | 'stays' | 'hasEntries' | 'unsupported' | 'invalid';
export type DirectResult =
  | { ok: true; spec: KalamSpec; kind: DirectKind; component: string; screen?: string }
  | { ok: false; reason: DirectFailure; detail?: string };

const fail = (reason: DirectFailure, detail?: string): DirectResult => ({ ok: false, reason, ...(detail ? { detail } : {}) });
const clone = (spec: KalamSpec): KalamSpec => JSON.parse(JSON.stringify(spec)) as KalamSpec;

function done(draft: KalamSpec, kind: DirectKind, component: string, screen?: string): DirectResult {
  const v = validateSpec(draft);
  return v.ok && v.spec ? { ok: true, spec: v.spec, kind, component, ...(screen ? { screen } : {}) } : fail('invalid', v.errors[0]?.message);
}

/** Runs patch ops and reshapes the outcome. */
function viaOps(spec: KalamSpec, ops: Parameters<typeof applyPatchOps>[1], kind: DirectKind, component: string): DirectResult {
  const r = applyPatchOps(spec, ops);
  return r.ok && r.spec ? { ok: true, spec: r.spec, kind, component } : fail('invalid', r.errors[0]?.message);
}

/** The editable copy of component `id` inside `draft`. */
const partIn = (draft: KalamSpec, id: string) => findPart(draft, id) as NonNullable<ReturnType<typeof findPart>>;

// ─── Move ─────────────────────────────────────────────────────────────────────
/** Actions that read nothing from the screen's fields, so a button holding one can sit on any screen. */
const SCREEN_FREE_ACTIONS: ReadonlySet<string> = new Set(['navigate', 'speak', 'feedback']);

/** Parts that edit or save the fields of their own screen stay on it. */
export function staysOnScreen(spec: KalamSpec, c: KalamComponent): boolean {
  if ('field' in c && c.field) return true;
  if (c.type === 'bigButton') {
    const a = Object.hasOwn(spec.actions, c.action) ? spec.actions[c.action] : undefined;
    return !a || !SCREEN_FREE_ACTIONS.has(a.type);
  }
  return false;
}

/**
 * Puts `id` on `screen`, just before `before` (null = at the end). On its own screen this reorders;
 * on another it moves the part there, out of any layout group it was in.
 */
export function moveComponentTo(spec: KalamSpec, id: string, target: { screen: string; before: string | null }): DirectResult {
  const at = findPart(spec, id);
  if (!at) return fail('missing');
  if (target.screen === at.screen.id) {
    const ops = moveOps(spec, id, target.before);
    return ops.length ? viaOps(spec, ops, 'moved', id) : fail('same');
  }
  if (!spec.screens.some((s) => s.id === target.screen)) return fail('missing');
  if (staysOnScreen(spec, at.component)) return fail('stays');
  const d = clone(spec);
  const from = partIn(d, id);
  const [part] = from.screen.children.splice(from.index, 1);
  removeFromLayout(from.screen, id);
  const to = d.screens.find((s) => s.id === target.screen);
  if (!part || !to) return fail('missing');
  const i = target.before === null ? -1 : to.children.findIndex((c) => c.id === target.before);
  to.children.splice(i < 0 ? to.children.length : i, 0, part);
  return done(d, 'movedToScreen', id, target.screen);
}

// ─── Size and width (per-component style, KalamSpec 1.1) ──────────────────────
function restyle(spec: KalamSpec, id: string, change: (s: KalamComponentStyle) => void, kind: DirectKind): DirectResult {
  if (!findPart(spec, id)) return fail('missing');
  const d = clone(spec);
  const c = partIn(d, id).component;
  const style: KalamComponentStyle = { ...(c.style ?? {}) };
  change(style);
  if (JSON.stringify(style) === JSON.stringify(c.style ?? {})) return fail('same');
  if (Object.keys(style).length) c.style = style;
  else delete c.style;
  return done(d, kind, id);
}

export const sizeOf = (c: KalamComponent): StyleSize => c.style?.size ?? 'medium';

/** Medium is the default, so choosing it removes the style (an app that needs nothing newer stays 1.0). */
export function resizeComponent(spec: KalamSpec, id: string, size: StyleSize): DirectResult {
  return restyle(spec, id, (s) => { if (size === 'medium') delete s.size; else s.size = size; }, 'resized');
}

export function widenComponent(spec: KalamSpec, id: string, fullWidth: boolean): DirectResult {
  return restyle(spec, id, (s) => { if (fullWidth) s.fullWidth = true; else delete s.fullWidth; }, 'widened');
}

// ─── Name ─────────────────────────────────────────────────────────────────────
export function renameComponentLabel(spec: KalamSpec, id: string, label: string): DirectResult {
  const at = findPart(spec, id);
  if (!at) return fail('missing');
  const next = label.trim().replace(/\s+/g, ' ');
  if (!next) return fail('invalid');
  if (next === ('label' in at.component ? at.component.label : undefined)) return fail('same');
  return viaOps(spec, [{ op: 'renameComponent', component: id, label: next }], 'renamed', id);
}

// ─── Field controls ───────────────────────────────────────────────────────────
/** Inputs that can be asked for. A toggle is never empty and a counter always has a value. */
const REQUIRABLE: ReadonlySet<string> = new Set(['number', 'textInput', 'date', 'choice', 'signature']);

export const canRequire = (c: KalamComponent): boolean => REQUIRABLE.has(c.type);

/** Required if the input says so or the collection field it fills does (the runtime honours either). */
export function isRequired(spec: KalamSpec, id: string): boolean {
  const at = findPart(spec, id);
  if (!at || !canRequire(at.component)) return false;
  const c = at.component as { required?: boolean; field?: string };
  const def = at.screen.form && c.field ? spec.collections[at.screen.form]?.fields[c.field] : undefined;
  return c.required === true || def?.required === true;
}

/** Sets "required" on the input and on the collection field it fills, so the two never disagree. */
export function setRequired(spec: KalamSpec, id: string, required: boolean): DirectResult {
  const at = findPart(spec, id);
  if (!at) return fail('missing');
  if (!canRequire(at.component)) return fail('unsupported');
  if (isRequired(spec, id) === required) return fail('same');
  const d = clone(spec);
  const { component, screen } = partIn(d, id);
  const c = component as { required?: boolean; field?: string };
  if (required) c.required = true;
  else delete c.required;
  const def = screen.form && c.field ? d.collections[screen.form]?.fields[c.field] : undefined;
  if (def) {
    if (required) def.required = true;
    else delete def.required;
  }
  return done(d, required ? 'required' : 'optional', id);
}

/** What a person picks: a field's type as they would say it. */
export const FIELD_KINDS = ['text', 'longText', 'number', 'date', 'yesNo'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** The kind of an input, or undefined when it is not one of the five (a choice, a counter, a signature). */
export function fieldKindOf(c: KalamComponent): FieldKind | undefined {
  switch (c.type) {
    case 'textInput': return c.multiline ? 'longText' : 'text';
    case 'number': return 'number';
    case 'date': return 'date';
    case 'toggle': return 'yesNo';
    default: return undefined;
  }
}

const KIND_COMPONENT = { text: 'textInput', longText: 'textInput', number: 'number', date: 'date', yesNo: 'toggle' } as const;
const KIND_FIELD = { text: 'text', longText: 'text', number: 'number', date: 'date', yesNo: 'boolean' } as const;
/** Properties each new component type keeps from the old one (everything else is dropped). */
const KEEPS: Record<(typeof KIND_COMPONENT)[FieldKind], readonly string[]> = {
  textInput: ['required', 'placeholder'], number: ['required', 'placeholder'], date: ['required'], toggle: [],
};
const BASE_KEYS = ['id', 'label', 'field', 'visible', 'secondary', 'a11yLabel', 'a11yDescription', 'readAloud', 'style'];

/**
 * Changes what kind of answer an input takes. Text and long text share one stored value, so that is
 * always safe. Any other change rewrites the collection field the input fills, so it is refused while
 * the collection holds entries (`hasEntries`), and for links to another collection. An input on a
 * screen without a collection form has no stored data and changes freely.
 */
export function setFieldKind(spec: KalamSpec, id: string, kind: FieldKind, opts: { hasEntries: boolean }): DirectResult {
  const at = findPart(spec, id);
  if (!at) return fail('missing');
  const current = fieldKindOf(at.component);
  if (!current) return fail('unsupported');
  if (current === kind) return fail('same');
  const d = clone(spec);
  const { component: old, screen } = partIn(d, id);
  const o = old as unknown as Record<string, unknown>;
  const type = KIND_COMPONENT[kind];
  const next: Record<string, unknown> = { type };
  for (const k of [...BASE_KEYS, ...KEEPS[type]]) if (o[k] !== undefined) next[k] = o[k];
  if (kind === 'longText') next.multiline = true;
  const form = screen.form ? d.collections[screen.form] : undefined;
  const def = form && typeof o.field === 'string' ? form.fields[o.field] : undefined;
  if (form && def && def.type !== KIND_FIELD[kind]) {
    if (def.type === 'text' && def.ref) return fail('unsupported');
    if (opts.hasEntries) return fail('hasEntries');
    const fresh = { type: KIND_FIELD[kind], label: def.label, ...(def.required ? { required: true } : {}) };
    form.fields[o.field as string] = fresh as KalamField;
  }
  Object.keys(o).forEach((k) => delete o[k]);
  Object.assign(o, next);
  return done(d, 'retyped', id);
}

// ─── Duplicate ────────────────────────────────────────────────────────────────
/** Puts a copy right after `id`. A part that fills a field is not copied: two inputs on one field would fight. */
export function duplicateComponent(spec: KalamSpec, id: string): DirectResult {
  const at = findPart(spec, id);
  if (!at) return fail('missing');
  if ('field' in at.component && at.component.field) return fail('unsupported');
  const copy = { ...(JSON.parse(JSON.stringify(at.component)) as KalamComponent), id: freshId(spec, `${id.slice(0, 40)}_copy`) } as KalamComponent;
  return viaOps(spec, [{ op: 'addComponent', screen: at.screen.id, component: copy, index: at.index + 1 }], 'duplicated', copy.id);
}
