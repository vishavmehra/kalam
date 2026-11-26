/**
 * Navigation stack, per-screen forms and record selection. Pure reducers: every function
 * returns a new RuntimeState and never mutates its input.
 */
import type { KalamRecord, RecordValue } from '@/core/contracts';
import type { ComponentOf, KalamScreen, KalamSpec } from '@/core/spec/schema';
import { defaultForm, screenFieldDefs } from './fields';
import type { FormValues, RuntimeState, Selection } from './types';

export function createRuntimeState(spec: KalamSpec): RuntimeState {
  const first = spec.screens.some((s) => s.id === spec.initialScreen) ? spec.initialScreen : spec.screens[0].id;
  return { stack: [first], forms: {}, errors: {}, selection: null };
}

export function findScreen(spec: KalamSpec, id: string): KalamScreen | undefined {
  return spec.screens.find((s) => s.id === id);
}

/** Current screen; falls back to the initial screen if a live spec edit removed it. */
export function currentScreen(spec: KalamSpec, state: RuntimeState): KalamScreen {
  const id = state.stack[state.stack.length - 1];
  return findScreen(spec, id) ?? findScreen(spec, spec.initialScreen) ?? spec.screens[0];
}

export function getForm(spec: KalamSpec, state: RuntimeState, screen: KalamScreen, now: Date): FormValues {
  const form = state.forms[screen.id] ?? defaultForm(spec, screen, now);
  return screen.form ? linkToOpened(spec, state, screen.form, form) : form;
}

/**
 * Id of the entry the current screen is about: `selected` in formulas. The entry this screen was opened
 * with, else the selection when it is of the screen's own collection, else null (nothing is open).
 */
export function selectedId(spec: KalamSpec, state: RuntimeState): string | null {
  const screen = currentScreen(spec, state);
  const opened = state.opened?.[screen.id];
  if (opened) return opened.recordId;
  return state.selection && state.selection.collection === screen.form ? state.selection.recordId : null;
}

/**
 * v1.1 relations: an entry added from its parent's page (that page still open, or this screen opened from
 * the parent's list) is linked to the parent the person opened, so a credit entry made on Ramesh's page
 * belongs to Ramesh. An empty link only; a link the person chose is kept. Never links an entry to itself.
 */
export function linkToOpened(spec: KalamSpec, state: RuntimeState, collection: string, form: FormValues): FormValues {
  const own = Object.prototype.hasOwnProperty.call(spec.collections, collection) ? spec.collections[collection] : undefined;
  if (!own) return form;
  const current = state.stack[state.stack.length - 1];
  // The entry this screen itself shows is never its own parent.
  const opened = [...state.stack].reverse().flatMap((id) => {
    const o = state.opened?.[id];
    return o && !(id === current && o.collection === collection) ? [o] : [];
  });
  const sel = state.selection;
  if (sel && state.stack.some((id) => id !== current && findScreen(spec, id)?.form === sel.collection)) opened.push(sel);
  let out = form;
  for (const [fid, f] of Object.entries(own.fields)) {
    if (f.type !== 'text' || !f.ref) continue;
    const empty = out[fid] === undefined || out[fid] === null || out[fid] === '';
    const parent = opened.find((o) => o.collection === f.ref?.collection);
    if (parent && empty) {
      if (out === form) out = { ...form };
      out[fid] = parent.recordId;
    }
  }
  return out;
}

export function setFieldValue(
  spec: KalamSpec, state: RuntimeState, screenId: string, field: string, value: RecordValue, now: Date,
): RuntimeState {
  const screen = findScreen(spec, screenId);
  if (!screen) return state;
  const form = { ...getForm(spec, state, screen, now), [field]: value };
  const errors = { ...state.errors };
  delete errors[field];
  return { ...state, forms: { ...state.forms, [screenId]: form }, errors };
}

export function mergeForm(spec: KalamSpec, state: RuntimeState, screenId: string, values: FormValues, now: Date): RuntimeState {
  const screen = findScreen(spec, screenId);
  if (!screen) return state;
  const errors = { ...state.errors };
  for (const k of Object.keys(values)) delete errors[k];
  return { ...state, forms: { ...state.forms, [screenId]: { ...getForm(spec, state, screen, now), ...values } }, errors };
}

export function clearForm(state: RuntimeState, screenId: string): RuntimeState {
  const forms = { ...state.forms };
  delete forms[screenId];
  return { ...state, forms, errors: {} };
}

/**
 * Pushes `screenId`. If it is already on the stack we pop back to it instead, so the stack can
 * never grow beyond the number of screens (home → new → home → new … stays bounded).
 */
export function navigate(spec: KalamSpec, state: RuntimeState, screenId: string): RuntimeState | undefined {
  if (!findScreen(spec, screenId)) return undefined;
  const at = state.stack.indexOf(screenId);
  const stack = at >= 0 ? state.stack.slice(0, at + 1) : [...state.stack, screenId];
  return withStack(state, stack);
}

export function goBack(state: RuntimeState): RuntimeState {
  if (state.stack.length <= 1) return state;
  return withStack(state, state.stack.slice(0, -1));
}

/**
 * New stack. Entries opened by screens that left the stack are forgotten, and coming back to a page
 * selects the entry it was opened with again (customer page, then an entry's page, then Back).
 */
function withStack(state: RuntimeState, stack: string[]): RuntimeState {
  const next: RuntimeState = { ...state, stack, errors: {} };
  if (!state.opened) return next;
  const opened: Record<string, Selection> = {};
  for (const id of stack) if (state.opened[id]) opened[id] = state.opened[id];
  next.opened = opened;
  const back = opened[stack[stack.length - 1]];
  if (back) next.selection = back;
  return next;
}

/** Opens a list's detail screen with `record` selected and its values pre-filled for editing. */
export function openRecord(
  spec: KalamSpec, state: RuntimeState, list: ComponentOf<'list'>, record: KalamRecord, now: Date,
): RuntimeState | undefined {
  if (!list.detailScreen) return undefined;
  const target = findScreen(spec, list.detailScreen);
  if (!target) return undefined;
  const nav = navigate(spec, state, target.id);
  if (!nav) return undefined;
  const prefill: FormValues = {};
  for (const field of Object.keys(screenFieldDefs(spec, target))) {
    if (field in record.values) prefill[field] = record.values[field];
  }
  const selection: Selection = { collection: list.source, recordId: record.id };
  return {
    ...nav,
    selection,
    opened: { ...nav.opened, [target.id]: selection },
    forms: { ...nav.forms, [target.id]: { ...defaultForm(spec, target, now), ...prefill } },
  };
}
