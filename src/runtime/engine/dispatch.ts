/**
 * Action dispatcher (docs/09 §7, docs/05 §7). Interprets the finite KalamSpec action set —
 * never executes code. Each call returns the next RuntimeState plus UI effects; persistence goes
 * through RuntimeServices so a failure leaves the rest of the app intact.
 */
import type { AIErrorCode, AIExecutionResult, AIImage, RecordOp, RecordValue } from '@/core/contracts';
import type { ActionOf, KalamAIBlock, KalamScreen, KalamThen } from '@/core/spec/schema';
import {
  checkForm, clamp, coerceValue, collectionFieldDefs, lenientForm, parseNumber, screenFieldDefs,
} from './fields';
import { incomingRelations } from '@/core/spec/v11';
import { engineText } from '@/i18n/engine-messages';
import { collectionValues, evaluate, formulaContext } from './data';
import { formulaHint } from './formula-hint';
import { clearForm, currentScreen, getForm, goBack, linkToOpened, mergeForm, navigate, selectedId, setFieldValue } from './state';
import type {
  ActionResult, AIProposal, EngineEnv, ExecutionBadge, FieldDef, FormValues, RuntimeEffect, RuntimeErrorCode,
  RuntimeState, ToastTone,
} from './types';
import { applyOps } from './transaction';
import { v11Words } from './v11/copy';
import { aiWritableFields, deleteWithRelations, machineValueErrors } from './v11/relations';

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

function firstError(errors: Record<string, string>, lang: string): string {
  const all = Object.values(errors);
  if (all.length < 2) return all[0];
  return engineText(lang, 'andMore', { first: all[0], count: all.length - 1 });
}

export async function dispatchAction(env: EngineEnv, state: RuntimeState, actionId: string): Promise<ActionResult> {
  const action = env.spec.actions[actionId];
  const lang = env.spec.lang;
  if (!action) return fail(state, 'unknown_action', engineText(lang, 'unknownAction'));
  switch (action.type) {
    case 'navigate': {
      const next = navigate(env.spec, state, action.screen);
      return next ? done(next) : fail(state, 'invalid_screen', engineText(lang, 'invalidScreen'));
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
    case 'compute': return computeFormula(env, state, action);
  }
}

// ─── Records ──────────────────────────────────────────────────────────────────
/**
 * A plain sentence, in the app's language, for the two storage failures a person can fix: a list that is full,
 * and an entry that comes from another app and can only be changed there. Anything else keeps the generic message.
 * The storage layer's own English text is never shown, so a Hindi app does not get an English line.
 */
export function ownMessage(lang: string, e: unknown): string | undefined {
  if (!(e instanceof Error)) return undefined;
  if (e.name === 'SharedRecordReadOnlyError') return engineText(lang, 'sharedReadOnly');
  if (e.name !== 'RecordLimitError') return undefined;
  const limit = (e as { limit?: unknown }).limit;
  return typeof limit === 'number' ? engineText(lang, 'recordLimit', { limit }) : e.message;
}

/**
 * The record writes of ONE action, applied as ONE transaction (docs/09 §7.3, docs/05 §7.8): all of them or none, and
 * the follow-up (`then`: speak, feedback, navigate) runs only after this has succeeded, so a failure between the steps
 * never leaves half an update or a screen change for a save that did not happen. Undefined when everything was written;
 * otherwise the failed result to return. `failed` is the plain sentence for a refusal that is not one of the two
 * known storage errors; "partly" is said only when something stayed (a delete cannot be taken back).
 */
export async function commitWrites(
  env: EngineEnv, state: RuntimeState, ops: RecordOp[], failed: 'saveFailed' | 'deleteFailed',
): Promise<ActionResult | undefined> {
  const out = await applyOps(env.services.records, env.appId, ops);
  if (out.ok) return undefined;
  const lang = env.spec.lang;
  const message = ownMessage(lang, out.error) ?? (out.rolledBack ? engineText(lang, failed) : v11Words(lang).deletePartly);
  return fail(state, 'storage_failed', message);
}

export async function insertRecord(env: EngineEnv, state: RuntimeState, action: ActionOf<'insert'>): Promise<ActionResult> {
  const screen = currentScreen(env.spec, state);
  const defs = collectionFieldDefs(env.spec, action.collection, screen);
  if (!defs) return fail(state, 'missing_collection', engineText(env.spec.lang, 'missingCollection'));
  const base = getForm(env.spec, state, screen, env.now);
  // A one-tap add on a parent's page ("Done today" on a habit's page) links the new entry to that parent.
  const form = action.collection === screen.form ? base : linkToOpened(env.spec, state, action.collection, base);
  const { values, errors } = checkForm(defs, form, env.now, env.spec.lang);
  // 1.1: a link must name an existing entry and a signature field hold a signature, whoever filled it.
  for (const [f, m] of Object.entries(machineValueErrors(env.spec, action.collection, values, env.data.records))) errors[f] ??= m;
  if (Object.keys(errors).length) {
    return fail({ ...state, errors }, 'validation_failed', firstError(errors, env.spec.lang), 'warning');
  }
  const refused = await commitWrites(env, state, [{ op: 'insert', collection: action.collection, values }], 'saveFailed');
  if (refused) return refused;
  const effects: RuntimeEffect[] = [];
  // The page of an opened entry keeps that entry's values in its inputs; only a form for the new entry is cleared.
  const keep = action.collection !== screen.form && !!state.opened?.[screen.id];
  const next = applyThen(env, keep ? { ...state, errors: {} } : clearForm(state, screen.id), action.then, effects, engineText(env.spec.lang, 'saved'));
  return done(next, effects);
}

function selectedRecord(env: EngineEnv, state: RuntimeState, collection: string) {
  const sel = state.selection;
  if (!sel || sel.collection !== collection) return undefined;
  return env.data.records[collection]?.find((r) => r.id === sel.recordId);
}

export async function updateSelected(env: EngineEnv, state: RuntimeState, action: ActionOf<'update'>): Promise<ActionResult> {
  if (!state.selection || state.selection.collection !== action.collection) {
    return fail(state, 'no_selection', engineText(env.spec.lang, 'noSelection'), 'warning');
  }
  const record = selectedRecord(env, state, action.collection);
  if (!record) return fail({ ...state, selection: null }, 'record_not_found', engineText(env.spec.lang, 'recordGone'), 'warning');
  const screen = currentScreen(env.spec, state);
  const all = collectionFieldDefs(env.spec, action.collection, screen);
  if (!all) return fail(state, 'missing_collection', engineText(env.spec.lang, 'missingCollection'));
  // Only fields edited on this screen change; everything else on the record is preserved.
  const edited = Object.keys(screenFieldDefs(env.spec, screen));
  const defs: Record<string, FieldDef> = {};
  for (const f of edited) if (all[f]) defs[f] = all[f];
  const { values, errors } = checkForm(defs, getForm(env.spec, state, screen, env.now), env.now, env.spec.lang);
  // v1.1 fixed values ("Mark done" sets done = true), checked like typed ones; they win over the screen's inputs.
  for (const [f, raw] of Object.entries(action.set ?? {})) {
    const def = all[f];
    const c = def ? coerceValue(def, raw, env.now, env.spec.lang) : undefined;
    if (c?.ok) values[f] = c.value;
    else if (def && c) errors[f] = c.error;
  }
  for (const [f, m] of Object.entries(machineValueErrors(env.spec, action.collection, values, env.data.records))) errors[f] ??= m;
  if (Object.keys(errors).length) return fail({ ...state, errors }, 'validation_failed', firstError(errors, env.spec.lang), 'warning');
  // Repositories merge partial values; sending only edited fields avoids re-validating stale ones.
  const refused = await commitWrites(env, state, [{ op: 'update', collection: action.collection, id: record.id, values }], 'saveFailed');
  if (refused) return refused;
  const effects: RuntimeEffect[] = [];
  return done(applyThen(env, { ...state, errors: {} }, action.then, effects, engineText(env.spec.lang, 'updated')), effects);
}

export async function deleteSelected(env: EngineEnv, state: RuntimeState, action: ActionOf<'delete'>): Promise<ActionResult> {
  if (!state.selection || state.selection.collection !== action.collection) {
    return fail(state, 'no_selection', engineText(env.spec.lang, 'noSelection'), 'warning');
  }
  const record = selectedRecord(env, state, action.collection);
  if (!record) return fail({ ...state, selection: null }, 'record_not_found', engineText(env.spec.lang, 'recordGone'), 'warning');
  const refused = await confirmAndRemove(env, state, action.collection, record.id, action.confirm);
  if (refused) return refused;
  let next: RuntimeState = clearForm({ ...state, selection: null }, currentScreen(env.spec, state).id);
  // The detail screen of a deleted record is meaningless — go back unless `then` says otherwise.
  if (!action.then?.navigate) next = goBack(next);
  const effects: RuntimeEffect[] = [];
  return done(applyThen(env, next, action.then, effects, engineText(env.spec.lang, 'deleted')), effects);
}

/**
 * Confirms, then deletes. Undefined when the entry is gone; otherwise the result to return. When
 * other collections link to this one (KalamSpec 1.1), restrict blocks, cascade and clear follow and
 * the question says what else changes; a 1.0 app asks and fails exactly as before.
 */
async function confirmAndRemove(
  env: EngineEnv, state: RuntimeState, collection: string, recordId: string, confirm: string,
): Promise<ActionResult | undefined> {
  if (incomingRelations(env.spec, collection).length) {
    const r = await deleteWithRelations(env, state, collection, recordId, confirm);
    return r.ok ? undefined : r;
  }
  if (!(await env.services.confirm(confirm))) return { ok: false, error: 'cancelled', state, effects: [] };
  return commitWrites(env, state, [{ op: 'remove', collection, id: recordId }], 'deleteFailed');
}

/** List-row delete (allowDelete). Always confirms first. */
export async function deleteListRecord(
  env: EngineEnv, state: RuntimeState, collection: string, recordId: string, confirmMessage: string,
): Promise<ActionResult> {
  const refused = await confirmAndRemove(env, state, collection, recordId, confirmMessage);
  if (refused) return refused;
  const selection = state.selection?.recordId === recordId ? null : state.selection;
  return done({ ...state, selection }, [{ type: 'toast', message: engineText(env.spec.lang, 'deleted'), tone: 'success' }]);
}

/** Inline checklist toggle (list `toggleField`). */
export async function toggleRecordField(
  env: EngineEnv, state: RuntimeState, collection: string, recordId: string, field: string,
): Promise<ActionResult> {
  const record = env.data.records[collection]?.find((r) => r.id === recordId);
  if (!record) return fail(state, 'record_not_found', engineText(env.spec.lang, 'recordGone'), 'warning');
  const refused = await commitWrites(env, state, [{ op: 'update', collection, id: recordId, values: { [field]: record.values[field] !== true } }], 'saveFailed');
  return refused ?? done(state);
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
      return fail(state, 'storage_failed', engineText(env.spec.lang, 'saveFailed'));
    }
    return done(state, [], { kvWrites: { [target]: value } });
  }

  const screen: KalamScreen = found?.screen ?? currentScreen(env.spec, state);
  const field = found?.counter.field ?? target;
  const def = screenFieldDefs(env.spec, screen)[field];
  if (!def || def.type !== 'number') return fail(state, 'missing_input', engineText(env.spec.lang, 'counterSetup'), 'warning');
  const min = found?.counter.min ?? def.min;
  const max = found?.counter.max ?? def.max;
  const current = parseNumber(getForm(env.spec, state, screen, env.now)[field]) ?? clamp(0, min, max);
  const value = stepValue(current, op, Math.abs(by ?? found?.counter.step ?? 1), min, max);
  return done(setFieldValue(env.spec, state, screen.id, field, value, env.now));
}

// ─── Compute (docs/05 §7.2 "execute an approved formula") ─────────────────────
/**
 * `compute` (KalamSpec 1.1): works out the action's formula with the whitelist engine and stores the answer in
 * `target`: a counter kept in app state (a number, held inside its min and max) or a field of this screen's form.
 * A list answers with its size, like a stat. An empty answer clears a form field and leaves a counter alone.
 * A formula that fails changes nothing and says why, with the way to fix it (formula-hint.ts).
 */
export async function computeFormula(env: EngineEnv, state: RuntimeState, action: ActionOf<'compute'>): Promise<ActionResult> {
  const lang = env.spec.lang;
  const here = currentScreen(env.spec, state);
  const found = findCounter(env, action.target);
  const screen: KalamScreen = found?.screen ?? here;
  const defs = screenFieldDefs(env.spec, screen);
  const form = lenientForm(defs, getForm(env.spec, state, screen, env.now));
  const res = evaluate(action.formula, formulaContext(collectionValues(env.spec, env.data.records), form, env.data.state, env.now, selectedId(env.spec, state)), lang);
  if (!res.ok) return fail(state, 'formula_failed', formulaHint(res, lang)?.message, 'warning');
  const raw: RecordValue = Array.isArray(res.value) ? res.value.length : (res.value as RecordValue);
  const effects: RuntimeEffect[] = [];

  if (found && !found.counter.field) {
    if (raw === null) return done(applyThen(env, state, action.then, effects), effects);
    const n = typeof raw === 'number' ? raw : parseNumber(typeof raw === 'string' ? raw : undefined);
    if (n === undefined) return fail(state, 'formula_failed', engineText(lang, 'formulaFailed'), 'warning');
    const value = clamp(tidy(n), found.counter.min, found.counter.max);
    try {
      await env.services.state.set(env.appId, action.target, value);
    } catch {
      return fail(state, 'storage_failed', engineText(lang, 'saveFailed'));
    }
    return done(applyThen(env, state, action.then, effects), effects, { kvWrites: { [action.target]: value } });
  }

  const field = found?.counter.field ?? action.target;
  const def = defs[field];
  if (!def) return fail(state, 'missing_input', engineText(lang, 'formulaFailed'), 'warning');
  const c = raw === null ? ({ ok: true, value: '' } as const) : coerceValue(def, raw, env.now, lang);
  if (!c.ok) return fail(state, 'validation_failed', c.error, 'warning');
  return done(applyThen(env, setFieldValue(env.spec, state, screen.id, field, c.value ?? '', env.now), action.then, effects), effects);
}

// ─── AI blocks ────────────────────────────────────────────────────────────────
/** The plain sentence for an AI failure, in the app's language (`spec.lang`). Unknown or missing codes get the general one. */
export function aiErrorMessage(code: AIErrorCode | undefined, lang?: string): string {
  switch (code) {
    case 'offline': return engineText(lang, 'aiOffline');
    case 'consent_denied': return engineText(lang, 'aiConsentDenied');
    case 'model_unavailable': return engineText(lang, 'aiModelUnavailable');
    case 'not_configured': return engineText(lang, 'aiNotConfigured');
    case 'timeout': return engineText(lang, 'aiTimeout');
    case 'invalid_output': return engineText(lang, 'aiInvalidOutput');
    case 'quota': return engineText(lang, 'aiQuota');
    case 'unsupported_modality': return engineText(lang, 'aiUnsupported');
    case 'cancelled': return engineText(lang, 'aiCancelled');
    default: return engineText(lang, 'aiFailed');
  }
}

function outputFields(env: EngineEnv, block: KalamAIBlock): string[] {
  if (block.kind === 'extractFromPhoto') {
    // With no list, every field the model may fill: never a link or a signature (aiWritableFields).
    return block.fields ?? aiWritableFields(env.spec, block.target);
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
  const lang = env.spec.lang;
  if (!block) return fail(state, 'ai_unavailable', engineText(lang, 'aiMissing'));
  const unavailable = (badge: ExecutionBadge, message: string): ActionResult => ({
    ok: false, state, error: 'ai_unavailable', effects: [{ type: 'aiUnavailable', blockId, badge, message }],
  });
  // Cloud-preferred blocks cannot run offline; skip the picker instead of failing after it. A step set to
  // fallback 'none' never uses the cloud, so being offline is not a reason to refuse it.
  if (!env.services.online() && block.verified !== 'onDevice' && block.fallback !== 'none') return unavailable('offline', aiErrorMessage('offline', lang));

  const screen = currentScreen(env.spec, state);
  const form = lenientForm(screenFieldDefs(env.spec, screen), getForm(env.spec, state, screen, env.now));
  let image = opts.image;
  if (block.kind === 'extractFromPhoto') {
    image ??= await env.services.pickImage();
    if (!image) return { ok: false, error: 'cancelled', state, effects: [] };
  } else {
    const input = form[block.inputField];
    if (input === null || input === undefined || String(input).trim() === '') {
      const label = screenFieldDefs(env.spec, screen)[block.inputField]?.label;
      return fail(state, 'missing_input', label ? engineText(lang, 'enterFirst', { label }) : engineText(lang, 'enterTextFirst'), 'warning');
    }
  }

  let res: AIExecutionResult<Record<string, RecordValue>>;
  try {
    res = await env.services.runAIBlock({ appId: env.appId, blockId, block, spec: env.spec, image, formValues: nonNull(form) });
  } catch {
    return unavailable(env.services.online() ? 'cloud' : 'offline', aiErrorMessage(undefined, lang));
  }
  if (!res.success || !res.output) {
    const offline = res.errorCode === 'offline' || !env.services.online();
    const reason = aiErrorMessage(offline ? 'offline' : res.errorCode, lang);
    return {
      ...unavailable(offline ? 'offline' : res.source, block.onError === 'manual_entry' ? engineText(lang, 'manualEntry', { message: reason }) : reason),
      error: 'ai_failed',
    };
  }
  const { values, rejected } = validateProposal(env, screen, block, res.output);
  if (!Object.keys(values).length) {
    return { ...unavailable(res.source, engineText(lang, 'aiNothingFound')), error: 'ai_failed' };
  }
  const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const uncertain = (res.uncertainFields ?? []).filter((f) => has(values, f));
  const readings = Object.fromEntries(Object.entries(res.fieldReadings ?? {}).filter(([f]) => has(values, f)));
  const proposal: AIProposal = {
    blockId, screenId: screen.id, values, rejected, source: res.source, provider: res.provider,
    model: res.model, latencyMs: res.latencyMs, then: opts.then,
    ...(uncertain.length ? { uncertain } : {}),
    ...(Object.keys(readings).length ? { readings } : {}),
  };
  return done(state, [{ type: 'aiProposal', proposal }]);
}

/** Applies reviewed AI values to the form, then the block action's `then`. */
export function acceptProposal(env: EngineEnv, state: RuntimeState, proposal: AIProposal): ActionResult {
  const effects: RuntimeEffect[] = [];
  const merged = mergeForm(env.spec, state, proposal.screenId, proposal.values, env.now);
  const n = Object.keys(proposal.values).length;
  const filled = n === 1 ? engineText(env.spec.lang, 'filledOne') : engineText(env.spec.lang, 'filledMany', { count: n });
  return done(applyThen(env, merged, proposal.then, effects, filled), effects);
}
