/**
 * Action dispatcher (docs/09 §7, docs/05 §7). Interprets the finite KalamSpec action set —
 * never executes code. Each call returns the next RuntimeState plus UI effects; persistence goes
 * through RuntimeServices so a failure leaves the rest of the app intact.
 */
import type { AIErrorCode, AIExecutionResult, AIImage, RecordValue } from '@/core/contracts';
import type { ActionOf, KalamAIBlock, KalamScreen, KalamThen } from '@/core/spec/schema';
import {
  checkForm, clamp, coerceValue, collectionFieldDefs, lenientForm, parseNumber, screenFieldDefs,
} from './fields';
import { engineText } from '@/i18n/engine-messages';
import { clearForm, currentScreen, getForm, goBack, mergeForm, navigate, setFieldValue } from './state';
import type {
  ActionResult, AIProposal, EngineEnv, ExecutionBadge, FieldDef, FormValues, RuntimeEffect, RuntimeErrorCode,
  RuntimeState, ToastTone,
} from './types';

function done(state: RuntimeState, effects: RuntimeEffect[] = [], extra?: Partial<ActionResult>): ActionResult {
  return { ok: true, state, effects, ...extra };
}
function fail(state: RuntimeState, error: RuntimeErrorCode, message?: string, tone: ToastTone = 'error'): ActionResult {
  return { ok: false, state, error, effects: message ? [{ type: 'toast', message, tone }] : [] };
}

/** Follow-ups are a single bounded step (schema `then`): speak, feedback, navigate. No chaining. */
function applyThen(env: EngineEnv, state: RuntimeState, then: KalamThen | undefined, effects: RuntimeEffect[], fallbackToast?: string): RuntimeState {
  if (then?.feedback) effects.push({ type: 'toast', message: then.feedback, tone: 'success' });
  else if (fallbackToast) effects.push({ type: 'toast', message: fallbackToast, tone: 'success' });
  if (then?.speak) effects.push({ type: 'speak', text: then.speak });
  if (then?.navigate) return navigate(env.spec, state, then.navigate) ?? state;
  return state;
}

function firstError(errors: Record<string, string>): string {
  const all = Object.values(errors);
  return all.length > 1 ? `${all[0]} (and ${all.length - 1} more)` : all[0];
}

export async function dispatchAction(env: EngineEnv, state: RuntimeState, actionId: string): Promise<ActionResult> {
  const action = env.spec.actions[actionId];
  if (!action) return fail(state, 'unknown_action', 'This button is not connected to an action.');
  switch (action.type) {
    case 'navigate': {
      const next = navigate(env.spec, state, action.screen);
      return next ? done(next) : fail(state, 'invalid_screen', 'That screen no longer exists.');
    }
    case 'insert': return insertRecord(env, state, action);
    case 'update': return updateSelected(env, state, action);
    case 'delete': return deleteSelected(env, state, action);
    case 'increment': return stepCounter(env, state, action.target, 'increment', action.by);
    case 'decrement': return stepCounter(env, state, action.target, 'decrement', action.by);
    case 'reset': return stepCounter(env, state, action.target, 'reset');
    case 'runAI': return runAIBlockFlow(env, state, action.aiBlock, { then: action.then });
    case 'speak': return done(state, [{ type: 'speak', text: action.text }]);
    case 'feedback': return done(state, [{ type: 'toast', message: action.message, tone: action.tone ?? 'info' }]);
    case 'clearForm': return done(clearForm(state, currentScreen(env.spec, state).id));
  }
}

// ─── Records ──────────────────────────────────────────────────────────────────
export async function insertRecord(env: EngineEnv, state: RuntimeState, action: ActionOf<'insert'>): Promise<ActionResult> {
  const screen = currentScreen(env.spec, state);
  const defs = collectionFieldDefs(env.spec, action.collection, screen);
  if (!defs) return fail(state, 'missing_collection', 'This app is missing the place to save that.');
  const { values, errors } = checkForm(defs, getForm(env.spec, state, screen, env.now), env.now, env.spec.lang);
  if (Object.keys(errors).length) {
    return fail({ ...state, errors }, 'validation_failed', firstError(errors), 'warning');
  }
  try {
    await env.services.records.insert(env.appId, action.collection, values);
  } catch (e) {
    return fail(
      state,
      'storage_failed',
      e instanceof Error && e.name === 'RecordLimitError' ? e.message : "Couldn't save. Nothing was changed. Please try again.",
    );
  }
  const effects: RuntimeEffect[] = [];
  const next = applyThen(env, clearForm(state, screen.id), action.then, effects, engineText(env.spec.lang, 'saved'));
  return done(next, effects);
}

function selectedRecord(env: EngineEnv, state: RuntimeState, collection: string) {
  const sel = state.selection;
  if (!sel || sel.collection !== collection) return undefined;
  return env.data.records[collection]?.find((r) => r.id === sel.recordId);
}

export async function updateSelected(env: EngineEnv, state: RuntimeState, action: ActionOf<'update'>): Promise<ActionResult> {
  if (!state.selection || state.selection.collection !== action.collection) {
    return fail(state, 'no_selection', 'Choose an item from the list first.', 'warning');
  }
  const record = selectedRecord(env, state, action.collection);
  if (!record) return fail({ ...state, selection: null }, 'record_not_found', 'That item no longer exists.', 'warning');
  const screen = currentScreen(env.spec, state);
  const all = collectionFieldDefs(env.spec, action.collection, screen);
  if (!all) return fail(state, 'missing_collection', 'This app is missing the place to save that.');
  // Only fields edited on this screen change; everything else on the record is preserved.
  const edited = Object.keys(screenFieldDefs(env.spec, screen));
  const defs: Record<string, FieldDef> = {};
  for (const f of edited) if (all[f]) defs[f] = all[f];
  const { values, errors } = checkForm(defs, getForm(env.spec, state, screen, env.now), env.now, env.spec.lang);
  if (Object.keys(errors).length) return fail({ ...state, errors }, 'validation_failed', firstError(errors), 'warning');
  try {
    // Repositories merge partial values; sending only edited fields avoids re-validating stale ones.
    await env.services.records.update(env.appId, action.collection, record.id, values);
  } catch {
    return fail(state, 'storage_failed', "Couldn't save the change. Nothing was changed.");
  }
  const effects: RuntimeEffect[] = [];
  return done(applyThen(env, { ...state, errors: {} }, action.then, effects, engineText(env.spec.lang, 'updated')), effects);
}

export async function deleteSelected(env: EngineEnv, state: RuntimeState, action: ActionOf<'delete'>): Promise<ActionResult> {
  if (!state.selection || state.selection.collection !== action.collection) {
    return fail(state, 'no_selection', 'Choose an item from the list first.', 'warning');
  }
  const record = selectedRecord(env, state, action.collection);
  if (!record) return fail({ ...state, selection: null }, 'record_not_found', 'That item no longer exists.', 'warning');
  if (!(await env.services.confirm(action.confirm))) return { ok: false, error: 'cancelled', state, effects: [] };
  try {
    await env.services.records.remove(env.appId, action.collection, record.id);
  } catch {
    return fail(state, 'storage_failed', "Couldn't delete. Nothing was changed.");
  }
  let next: RuntimeState = clearForm({ ...state, selection: null }, currentScreen(env.spec, state).id);
  // The detail screen of a deleted record is meaningless — go back unless `then` says otherwise.
  if (!action.then?.navigate) next = goBack(next);
  const effects: RuntimeEffect[] = [];
  return done(applyThen(env, next, action.then, effects, engineText(env.spec.lang, 'deleted')), effects);
}

/** List-row delete (allowDelete). Always confirms first. */
export async function deleteListRecord(
  env: EngineEnv, state: RuntimeState, collection: string, recordId: string, confirmMessage: string,
): Promise<ActionResult> {
  if (!(await env.services.confirm(confirmMessage))) return { ok: false, error: 'cancelled', state, effects: [] };
  try {
    await env.services.records.remove(env.appId, collection, recordId);
  } catch {
    return fail(state, 'storage_failed', "Couldn't delete. Nothing was changed.");
  }
  const selection = state.selection?.recordId === recordId ? null : state.selection;
  return done({ ...state, selection }, [{ type: 'toast', message: engineText(env.spec.lang, 'deleted'), tone: 'success' }]);
}

/** Inline checklist toggle (list `toggleField`). */
export async function toggleRecordField(
  env: EngineEnv, state: RuntimeState, collection: string, recordId: string, field: string,
): Promise<ActionResult> {
  const record = env.data.records[collection]?.find((r) => r.id === recordId);
  if (!record) return fail(state, 'record_not_found', 'That item no longer exists.', 'warning');
  try {
    await env.services.records.update(env.appId, collection, recordId, { [field]: record.values[field] !== true });
  } catch {
    return fail(state, 'storage_failed', "Couldn't save the change.");
  }
  return done(state);
}

// ─── Counters ─────────────────────────────────────────────────────────────────
function findCounter(env: EngineEnv, id: string) {
  for (const screen of env.spec.screens) {
    for (const c of screen.children) if (c.type === 'counter' && c.id === id) return { screen, counter: c };
  }
  return undefined;
}

const tidy = (x: number) => Math.round(x * 1e9) / 1e9;

function stepValue(current: number, op: 'increment' | 'decrement' | 'reset', by: number, min?: number, max?: number): number {
  if (op === 'reset') return clamp(0, min, max);
  return clamp(tidy(current + (op === 'increment' ? by : -by)), min, max);
}

/**
 * increment / decrement / reset. `target` is a counter component id (persisted in app state, or
 * its bound form field) or a numeric form field on the current screen. Honours min / max / step.
 */
export async function stepCounter(
  env: EngineEnv, state: RuntimeState, target: string, op: 'increment' | 'decrement' | 'reset', by?: number,
): Promise<ActionResult> {
  const found = findCounter(env, target);
  if (found && !found.counter.field) {
    const { counter } = found;
    const raw = env.data.state[target];
    const current = typeof raw === 'number' ? raw : clamp(0, counter.min, counter.max);
    const value = stepValue(current, op, Math.abs(by ?? counter.step ?? 1), counter.min, counter.max);
    if (value === current && op !== 'reset') return done(state);
    try {
      await env.services.state.set(env.appId, target, value);
    } catch {
      return fail(state, 'storage_failed', "Couldn't save the count.");
    }
    return done(state, [], { kvWrites: { [target]: value } });
  }

  const screen: KalamScreen = found?.screen ?? currentScreen(env.spec, state);
  const field = found?.counter.field ?? target;
  const def = screenFieldDefs(env.spec, screen)[field];
  if (!def || def.type !== 'number') return fail(state, 'missing_input', "This counter isn't set up correctly.", 'warning');
  const min = found?.counter.min ?? def.min;
  const max = found?.counter.max ?? def.max;
  const current = parseNumber(getForm(env.spec, state, screen, env.now)[field]) ?? clamp(0, min, max);
  const value = stepValue(current, op, Math.abs(by ?? found?.counter.step ?? 1), min, max);
  return done(setFieldValue(env.spec, state, screen.id, field, value, env.now));
}

// ─── AI blocks ────────────────────────────────────────────────────────────────
const OFFLINE_MESSAGE = "You're offline, so this AI feature can't run right now. Everything else still works.";

export function aiErrorMessage(code: AIErrorCode | undefined): string {
  switch (code) {
    case 'offline': return OFFLINE_MESSAGE;
    case 'consent_denied': return 'Cloud AI is turned off in Settings, and on-device AI could not do this.';
    case 'model_unavailable': return "On-device AI isn't available on this device yet.";
    case 'not_configured': return "AI isn't set up in this copy of Kalam.";
    case 'timeout': return 'The AI took too long. Please try again.';
    case 'invalid_output': return "The AI's answer didn't fit this app, so nothing was changed.";
    case 'quota': return 'The AI service is busy. Please try again later.';
    case 'unsupported_modality': return "This device's AI can't read that kind of input.";
    case 'cancelled': return 'Cancelled.';
    default: return "The AI couldn't finish this. Nothing was changed.";
  }
}

function outputFields(env: EngineEnv, block: KalamAIBlock): string[] {
  if (block.kind === 'extractFromPhoto') {
    return block.fields ?? Object.keys(env.spec.collections[block.target]?.fields ?? {});
  }
  return [block.outputField];
}

function outputDef(env: EngineEnv, screen: KalamScreen, block: KalamAIBlock, field: string): FieldDef {
  const fromScreen = screenFieldDefs(env.spec, screen)[field];
  const coll = block.kind === 'extractFromPhoto' ? block.target : screen.form;
  const fromColl = coll ? collectionFieldDefs(env.spec, coll)?.[field] : undefined;
  const def: FieldDef = { ...(fromColl ?? fromScreen ?? { id: field, type: 'text', label: field }), required: false };
  if (block.kind === 'classify') return { ...def, type: 'enum', options: block.labels };
  return def;
}

/** Validates model output against the block's declared fields. Untrusted: unknown keys are dropped. */
export function validateProposal(
  env: EngineEnv, screen: KalamScreen, block: KalamAIBlock, output: Record<string, RecordValue>,
): { values: FormValues; rejected: AIProposal['rejected'] } {
  const values: FormValues = {};
  const rejected: AIProposal['rejected'] = [];
  for (const field of outputFields(env, block)) {
    if (!Object.prototype.hasOwnProperty.call(output, field)) continue;
    const raw = output[field];
    if (raw === null || raw === undefined || raw === '') continue;
    const def = outputDef(env, screen, block, field);
    const r = coerceValue(def, raw, env.now, env.spec.lang);
    if (r.ok) values[field] = r.value;
    else rejected.push({ field, reason: r.error });
  }
  return { values, rejected };
}

function nonNull(values: Record<string, RecordValue>): Record<string, RecordValue> {
  const out: Record<string, RecordValue> = {};
  for (const [k, v] of Object.entries(values)) if (v !== null && v !== '') out[k] = v;
  return out;
}

/**
 * Runs an AI block and returns a proposal for the user to review (docs/09 §12.2 step 9–10).
 * Nothing is written to the form until `acceptProposal` is called.
 */
export async function runAIBlockFlow(
  env: EngineEnv, state: RuntimeState, blockId: string, opts: { image?: AIImage; then?: KalamThen } = {},
): Promise<ActionResult> {
  const block = env.spec.aiBlocks[blockId];
  if (!block) return fail(state, 'ai_unavailable', 'This AI feature is missing from the app.');
  const unavailable = (badge: ExecutionBadge, message: string): ActionResult => ({
    ok: false, state, error: 'ai_unavailable', effects: [{ type: 'aiUnavailable', blockId, badge, message }],
  });
  // Cloud-preferred blocks cannot run offline; skip the picker instead of failing after it.
  if (!env.services.online() && block.verified !== 'onDevice') return unavailable('offline', OFFLINE_MESSAGE);

  const screen = currentScreen(env.spec, state);
  const form = lenientForm(screenFieldDefs(env.spec, screen), getForm(env.spec, state, screen, env.now));
  let image = opts.image;
  if (block.kind === 'extractFromPhoto') {
    image ??= await env.services.pickImage();
    if (!image) return { ok: false, error: 'cancelled', state, effects: [] };
  } else {
    const input = form[block.inputField];
    if (input === null || input === undefined || String(input).trim() === '') {
      const label = screenFieldDefs(env.spec, screen)[block.inputField]?.label ?? 'some text';
      return fail(state, 'missing_input', `Enter ${label} first.`, 'warning');
    }
  }

  let res: AIExecutionResult<Record<string, RecordValue>>;
  try {
    res = await env.services.runAIBlock({ appId: env.appId, blockId, block, spec: env.spec, image, formValues: nonNull(form) });
  } catch {
    return unavailable(env.services.online() ? 'cloud' : 'offline', aiErrorMessage(undefined));
  }
  if (!res.success || !res.output) {
    const offline = res.errorCode === 'offline' || !env.services.online();
    return {
      ...unavailable(offline ? 'offline' : res.source, aiErrorMessage(offline ? 'offline' : res.errorCode)),
      error: 'ai_failed',
    };
  }
  const { values, rejected } = validateProposal(env, screen, block, res.output);
  if (!Object.keys(values).length) {
    return { ...unavailable(res.source, "The AI didn't find anything it could fill in."), error: 'ai_failed' };
  }
  const proposal: AIProposal = {
    blockId, screenId: screen.id, values, rejected, source: res.source, provider: res.provider,
    model: res.model, latencyMs: res.latencyMs, then: opts.then,
  };
  return done(state, [{ type: 'aiProposal', proposal }]);
}

/** Applies reviewed AI values to the form, then the block action's `then`. */
export function acceptProposal(env: EngineEnv, state: RuntimeState, proposal: AIProposal): ActionResult {
  const effects: RuntimeEffect[] = [];
  const merged = mergeForm(env.spec, state, proposal.screenId, proposal.values, env.now);
  const n = Object.keys(proposal.values).length;
  return done(applyThen(env, merged, proposal.then, effects, `Filled ${n} field${n === 1 ? '' : 's'}`), effects);
}
