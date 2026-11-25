/**
 * Navigation stack, per-screen forms and record selection. Pure reducers: every function
 * returns a new RuntimeState and never mutates its input.
 */
import type { KalamRecord, RecordValue } from '@/core/contracts';
import type { ComponentOf, KalamScreen, KalamSpec } from '@/core/spec/schema';
import { defaultForm, screenFieldDefs } from './fields';
import type { FormValues, RuntimeState } from './types';

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
  return state.forms[screen.id] ?? defaultForm(spec, screen, now);
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
  return { ...state, stack, errors: {} };
}

export function goBack(state: RuntimeState): RuntimeState {
  if (state.stack.length <= 1) return state;
  return { ...state, stack: state.stack.slice(0, -1), errors: {} };
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
  return {
    ...nav,
    selection: { collection: list.source, recordId: record.id },
    forms: { ...nav.forms, [target.id]: { ...defaultForm(spec, target, now), ...prefill } },
  };
}
