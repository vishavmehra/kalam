/**
 * Voice command planning and execution (docs/05 §10.4, docs/10 §4.5 "Confirmation policy",
 * docs/03 §16.4, docs/17 §7.4). The voice service has already turned speech into an allowlisted
 * action id plus typed fields. This module decides what to do with that result:
 *
 *   refuse  unknown action, nothing to act on, a photo is needed, no item is open
 *   fill    only field values were heard: put them in the form
 *   run     safe and clear: fill the fields (if any) and dispatch the action
 *   confirm consequential or unclear: read it back and wait for "confirm"
 *
 * Destructive actions always need a confirmation, whatever the confidence. In Voice-only Mode
 * the person cannot see the form, so saving heard values is also read back first.
 *
 * Execution goes through the engine's `dispatchAction`. Nothing here runs generated code.
 * Pure TypeScript, no React.
 */
import type { AccessModes, RecordValue, VoiceActionResult } from '@/core/contracts';
import type { KalamAction, KalamScreen, KalamSpec } from '@/core/spec/schema';
import { formatFieldValue } from './data';
import { deleteListRecord, dispatchAction } from './dispatch';
import { coerceValue, screenFieldDefs } from './fields';
import { currentScreen, findScreen, getForm, mergeForm, openRecord } from './state';
import type { ActionResult, EngineEnv, FieldDef, FormValues, RuntimeState } from './types';
import { ensureStop, listPhrase, spokenActionLabels } from './voice-announce';
import type { RecordDeletePlan, RecordOpenPlan } from './voice-records';

export type ConfirmReason = 'destructive' | 'low_confidence' | 'readback' | 'external_ai';
export type RefuseReason = 'not_understood' | 'unknown_action' | 'needs_selection' | 'needs_photo';

export type VoicePlan =
  | { kind: 'refuse'; reason: RefuseReason; say: string }
  | { kind: 'fill'; fields: FormValues }
  | { kind: 'run'; actionId: string; fields: FormValues }
  | { kind: 'confirm'; actionId: string; fields: FormValues; reason: ConfirmReason; prompt: string };

export interface SpokenLine {
  text: string;
  /** critical: errors and warnings. completion: things that worked. */
  priority: 'critical' | 'completion';
}

/** Read-aloud and Voice-only both speak results; they share one speech queue. */
export function speaksResults(modes: AccessModes): boolean {
  return modes.readAloud || modes.voiceOnly === true;
}

/** Voice-only speaks a screen's title together with its commands, so the runtime must not say it twice. */
export function runtimeAnnouncesTitle(modes: AccessModes): boolean {
  return modes.readAloud && modes.voiceOnly !== true;
}

const isDestructive = (a: KalamAction) => a.type === 'delete' || a.type === 'reset' || a.type === 'clearForm';

// ─── Wording helpers ─────────────────────────────────────────────────────────
function collectionLabel(spec: KalamSpec, id: string): string {
  return spec.collections[id]?.label ?? id.replace(/_/g, ' ');
}

function humanize(id: string): string {
  return id.replace(/_/g, ' ');
}

/** The button label for an action on this screen, else the action id in words. */
function actionLabel(spec: KalamSpec, screen: KalamScreen, actionId: string): string {
  for (const c of screen.children) if (c.type === 'bigButton' && c.action === actionId) return c.label;
  return humanize(actionId);
}

function counterLabel(spec: KalamSpec, target: string, screen: KalamScreen): string {
  for (const s of spec.screens) for (const c of s.children) if (c.type === 'counter' && c.id === target) return c.label;
  return screenFieldDefs(spec, screen)[target]?.label ?? humanize(target);
}

/** What the action does, as a verb phrase: "save this to Orders". */
export function describeActionForSpeech(spec: KalamSpec, screen: KalamScreen, actionId: string): string {
  const a = spec.actions[actionId];
  if (!a) return humanize(actionId);
  switch (a.type) {
    case 'navigate': return `open ${findScreen(spec, a.screen)?.title ?? 'that screen'}`;
    case 'insert': return `save this to ${collectionLabel(spec, a.collection)}`;
    case 'update': return `save your changes to ${collectionLabel(spec, a.collection)}`;
    case 'delete': return `delete the open item from ${collectionLabel(spec, a.collection)}`;
    case 'increment': return `increase ${counterLabel(spec, a.target, screen)}`;
    case 'decrement': return `decrease ${counterLabel(spec, a.target, screen)}`;
    case 'reset': return `reset ${counterLabel(spec, a.target, screen)}`;
    case 'runAI': return `run ${actionLabel(spec, screen, actionId)}`;
    case 'speak': return 'read a message aloud';
    case 'feedback': return 'show a message';
    case 'clearForm': return 'clear this form';
  }
}

/** "Customer Raju, chest 40 in". Only fields that were heard. */
export function readbackFields(spec: KalamSpec, screen: KalamScreen, fields: FormValues): string {
  const defs = screenFieldDefs(spec, screen);
  const parts: string[] = [];
  for (const [id, value] of Object.entries(fields)) {
    const def = defs[id];
    if (!def || value === null || value === '') continue;
    parts.push(`${def.label} ${formatFieldValue(def, value, spec.lang)}`);
  }
  return parts.join(', ');
}

const SAY_CONFIRM = 'Say confirm or cancel.';

// ─── Planning ────────────────────────────────────────────────────────────────
/** Keeps only fields this screen has, validated against their definitions. Untrusted input. */
export function sanitizeVoiceFields(
  defs: Readonly<Record<string, FieldDef>>, raw: Readonly<Record<string, RecordValue>>, now: Date,
): FormValues {
  const out: FormValues = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!Object.prototype.hasOwnProperty.call(defs, id)) continue;
    const r = coerceValue(defs[id]!, value, now);
    if (r.ok && r.value !== null) out[id] = r.value;
  }
  return out;
}

export function planVoiceCommand(
  spec: KalamSpec, state: RuntimeState, result: VoiceActionResult, opts: { modes: AccessModes; now: Date },
): VoicePlan {
  const screen = currentScreen(spec, state);
  const fields = sanitizeVoiceFields(screenFieldDefs(spec, screen), result.fields, opts.now);
  const hasFields = Object.keys(fields).length > 0;
  const eyesFree = opts.modes.voiceOnly === true;

  if (result.action === null || result.action === undefined) {
    if (hasFields) return { kind: 'fill', fields };
    const labels = spokenActionLabels(spec, screen, opts.modes).slice(0, 3);
    return {
      kind: 'refuse', reason: 'not_understood',
      say: labels.length ? `I did not understand that. You can say: ${listPhrase(labels)}.` : 'I did not understand that.',
    };
  }

  const actionId = result.action;
  // Defence in depth: the voice service already filters, but model output is untrusted.
  if (!Object.prototype.hasOwnProperty.call(spec.actions, actionId)) {
    return { kind: 'refuse', reason: 'unknown_action', say: 'This app cannot do that by voice.' };
  }
  const action = spec.actions[actionId]!;

  if ((action.type === 'update' || action.type === 'delete') && state.selection?.collection !== action.collection) {
    return { kind: 'refuse', reason: 'needs_selection', say: 'Open the item you mean first, then try again.' };
  }

  if (action.type === 'runAI') {
    const block = spec.aiBlocks[action.aiBlock];
    if (!block) return { kind: 'refuse', reason: 'unknown_action', say: 'This app cannot do that by voice.' };
    // The photo picker is a touch dialog; a person using only their voice could not finish it.
    if (block.kind === 'extractFromPhoto') {
      return { kind: 'refuse', reason: 'needs_photo', say: 'That step needs a photo. Please tap the photo button.' };
    }
    if (block.verified !== 'onDevice') {
      const label = actionLabel(spec, screen, actionId);
      return {
        kind: 'confirm', actionId, fields, reason: 'external_ai',
        prompt: `This may send your text to online AI. Run ${label}? ${SAY_CONFIRM}`,
      };
    }
  }

  if (isDestructive(action)) {
    const question = action.type === 'delete'
      ? ensureQuestion(action.confirm)
      : action.type === 'reset'
        ? `Reset ${counterLabel(spec, action.target, screen)}?`
        : 'Clear what you typed on this screen?';
    return { kind: 'confirm', actionId, fields, reason: 'destructive', prompt: `${question} ${SAY_CONFIRM}` };
  }

  const verb = describeActionForSpeech(spec, screen, actionId);
  if (result.confidence === 'low') {
    const heard = hasFields ? `I understood: ${readbackFields(spec, screen, fields)}. Should I ${verb}?` : `I think you want to ${verb}.`;
    return { kind: 'confirm', actionId, fields, reason: 'low_confidence', prompt: `${heard} ${SAY_CONFIRM}` };
  }

  if (eyesFree && hasFields && (action.type === 'insert' || action.type === 'update')) {
    return {
      kind: 'confirm', actionId, fields, reason: 'readback',
      prompt: `I understood: ${readbackFields(spec, screen, fields)}. Should I ${verb}? ${SAY_CONFIRM}`,
    };
  }
  return { kind: 'run', actionId, fields };
}

function ensureQuestion(s: string): string {
  const t = s.trim();
  return /[?.!।]$/.test(t) ? t : `${t}?`;
}

// ─── Execution ───────────────────────────────────────────────────────────────
/** Required fields still empty, as labels. Used to tell a person what is left to say. */
export function missingRequiredLabels(spec: KalamSpec, screen: KalamScreen, form: FormValues): string[] {
  const out: string[] = [];
  for (const def of Object.values(screenFieldDefs(spec, screen))) {
    if (!def.required) continue;
    const v = form[def.id];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) out.push(def.label);
  }
  return out;
}

export interface VoiceExecution {
  result: ActionResult;
  /** What to say afterwards. Undefined when the runtime already said everything worth saying. */
  say?: SpokenLine;
}

/**
 * Fills the heard fields into the current screen's form, then dispatches the action through the
 * engine. With no action id it only fills. Never throws for ordinary failures: the ActionResult says what happened.
 */
export async function executeVoiceCommand(
  env: EngineEnv, state: RuntimeState, cmd: { actionId?: string; fields: FormValues },
): Promise<VoiceExecution> {
  const screen = currentScreen(env.spec, state);
  const fields = sanitizeVoiceFields(screenFieldDefs(env.spec, screen), cmd.fields, env.now);
  const filled = Object.keys(fields).length ? mergeForm(env.spec, state, screen.id, fields, env.now) : state;

  if (!cmd.actionId) {
    const result: ActionResult = { ok: true, state: filled, effects: [] };
    const heard = readbackFields(env.spec, screen, fields);
    if (!heard) return { result, say: { text: 'I did not hear a value for this screen.', priority: 'critical' } };
    const missing = missingRequiredLabels(env.spec, screen, getForm(env.spec, filled, screen, env.now));
    const text = `Set ${heard}.${missing.length ? ` Still needed: ${listPhrase(missing)}.` : ''}`;
    return { result, say: { text, priority: 'completion' } };
  }

  const result = await dispatchAction(env, filled, cmd.actionId);
  return { result, say: outcomeLine(env.spec, state, result) };
}

/** "Open the last order": selects the record and opens the list's detail screen, exactly like a tap. */
export function executeOpenRecord(env: EngineEnv, state: RuntimeState, plan: RecordOpenPlan): VoiceExecution {
  const next = openRecord(env.spec, state, plan.list, plan.record, env.now);
  if (!next) {
    return {
      result: { ok: false, state, error: 'invalid_screen', effects: [] },
      say: { text: 'That item cannot be opened.', priority: 'critical' },
    };
  }
  return { result: { ok: true, state: next, effects: [] }, say: { text: `Opened ${plan.name}.`, priority: 'completion' } };
}

/** "Delete the last record", after the person confirmed. The engine's own delete rules still apply. */
export async function executeDeleteRecord(env: EngineEnv, state: RuntimeState, plan: RecordDeletePlan): Promise<VoiceExecution> {
  const result = await deleteListRecord(env, state, plan.list.source, plan.record.id, plan.message);
  return { result, say: outcomeLine(env.spec, state, result) };
}

/** The line to speak for a finished action. Messages come from the engine, so they are already plain. */
export function outcomeLine(spec: KalamSpec, before: RuntimeState, result: ActionResult): SpokenLine | undefined {
  const proposal = result.effects.find((e) => e.type === 'aiProposal');
  if (proposal) {
    return { text: 'The AI has suggestions. Check the screen, then choose Fill in or Discard.', priority: 'completion' };
  }
  const unavailable = result.effects.find((e) => e.type === 'aiUnavailable');
  if (unavailable && unavailable.type === 'aiUnavailable') return { text: unavailable.message, priority: 'critical' };
  const toast = result.effects.find((e) => e.type === 'toast');
  if (toast && toast.type === 'toast') {
    return { text: ensureStop(toast.message), priority: toast.tone === 'error' || toast.tone === 'warning' ? 'critical' : 'completion' };
  }
  if (!result.ok) {
    return result.error === 'cancelled'
      ? { text: 'Cancelled.', priority: 'completion' }
      : { text: 'That did not work. Nothing was changed.', priority: 'critical' };
  }
  // The runtime speaks `speak` effects itself.
  if (result.effects.some((e) => e.type === 'speak')) return undefined;
  const from = before.stack[before.stack.length - 1];
  const to = result.state.stack[result.state.stack.length - 1];
  if (to !== undefined && to !== from) {
    const title = findScreen(spec, to)?.title;
    if (title) return { text: `Opened ${title}.`, priority: 'completion' };
  }
  return { text: 'Done.', priority: 'completion' };
}
