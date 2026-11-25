/**
 * Voice agent controller (docs/10 §4.5, docs/03 §16, docs/17 §7.4). A small state machine with no
 * React in it, so the whole flow runs under Vitest:
 *
 *   tap mic → listen → text → interpret (allowlisted action + typed fields) → plan
 *     → refuse | fill | run | confirm (spoken and on screen) → dispatch through the engine → speak the result
 *
 * Rules it keeps:
 *  - Listening starts only from an explicit tap. It stops on a second tap, on Cancel, after a short
 *    silence, and after a hard time limit. Nothing listens in the background.
 *  - On-device recognition is used when the device has it. The platform's online speech service
 *    needs the person's OK for this session, and is refused when Settings say offline only.
 *  - Raw audio is never kept (recordings are deleted right after transcription).
 *  - Destructive or unclear commands are read back and need "confirm". Unknown actions are refused.
 *  - Typed commands go through the same path, so a person is never stuck when speech fails.
 */
import type {
  AccessModes, RuntimeServices, SpeechPreferences, VoiceActionResult,
} from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { blockedMessage, chooseSpeechPath } from '@/infrastructure/platform/speech-policy';
import type { DictationSession, SpeechCapability, StartDictationOptions } from '@/infrastructure/platform/speech.shared';
import type { SpeakRequest, SpeechPriorityName, SpeechQueue } from '@/infrastructure/platform/tts-queue';
import {
  buildHelpText, buildScreenAnnouncement, executeDeleteRecord, executeOpenRecord, executeVoiceCommand, findScreen,
  interpretConfirmation, matchMetaCommand, parseRecordCommand, planRecordCommand, planVoiceCommand, voiceHints,
  type ActionResult, type ConfirmReason, type EngineEnv, type FormValues, type RecordCommand, type RecordDeletePlan,
  type RecordOpenPlan, type RecordPlan, type RuntimeState, type VoiceExecution,
} from '../engine';
import { speechVoiceFor } from './speech-voice';

export type VoicePhase = 'idle' | 'consent' | 'starting' | 'listening' | 'thinking' | 'confirming';

export interface VoicePending {
  actionId?: string;
  fields: FormValues;
  /** A list record to delete once confirmed ("delete the last order"). */
  deleteRecord?: RecordDeletePlan;
  reason: ConfirmReason;
  /** What was said and is shown: the question plus "Say confirm or cancel." */
  prompt: string;
}

export interface VoiceUiState {
  phase: VoicePhase;
  /** Words heard so far, or the last command. */
  transcript: string;
  /** One plain line under the microphone. */
  status: string;
  /** The last thing Kalam said as an answer (not screen announcements). */
  reply?: string;
  pending?: VoicePending;
  where?: 'on_device' | 'cloud_service';
  /** Set while waiting for the person to allow the online speech service. */
  consent?: { canDownload: boolean };
  capability?: SpeechCapability;
  /** Set when listening cannot work here. Typed commands still work. */
  unavailable?: string;
}

export interface VoiceContext {
  spec: KalamSpec;
  screenId: string;
  accessModes: AccessModes;
  speech: SpeechPreferences;
  aiMode: 'hybrid' | 'offline_only';
  allowCloud: boolean;
}

export interface VoiceDictation {
  getCapability(lang: string): Promise<SpeechCapability>;
  install(lang: string): Promise<boolean>;
  start(opts: StartDictationOptions): Promise<DictationSession>;
}

/** The runtime's "run one engine operation" function (commits state, shows toasts, speaks effects). */
export type VoiceRunner = (
  op: (env: EngineEnv, state: RuntimeState) => Promise<ActionResult> | ActionResult,
  overrides?: Partial<RuntimeServices>,
) => Promise<ActionResult | undefined>;

export interface VoiceControllerDeps {
  context(): VoiceContext;
  interpret(spec: KalamSpec, screenId: string, transcript: string): Promise<VoiceActionResult>;
  run: VoiceRunner;
  getState(): RuntimeState;
  goBack?(): void;
  /** False while the device has no network. Defaults to online. */
  online?(): boolean;
  speaker: Pick<SpeechQueue, 'say' | 'stop' | 'repeatLast' | 'isSpeaking'>;
  dictation: VoiceDictation;
  /** "your browser's speech service" / "Android's speech service". */
  serviceName: string;
  timers?: { set: typeof setTimeout; clear: typeof clearTimeout };
  limits?: { maxListenMs?: number; settleMs?: number; endGuardMs?: number };
}

export interface VoiceController {
  getState(): VoiceUiState;
  subscribe(listener: () => void): () => void;
  /** Checks what speech recognition this device offers (no microphone use). */
  prepare(): Promise<void>;
  /** The microphone button: start listening, or stop and use what was heard. */
  listen(): Promise<void>;
  /** Cancel: drop listening, a pending question and anything being said. */
  cancel(): void;
  confirm(): Promise<void>;
  decline(): void;
  /** "Change details": keep what was heard in the form instead of running the action (docs/03 §16.4). */
  changeDetails(): Promise<void>;
  /** Typed command: the same path as a spoken one. */
  submitText(text: string): Promise<void>;
  allowService(): Promise<void>;
  downloadModel(): Promise<void>;
  repeat(): void;
  stopSpeaking(): void;
  announceScreen(): void;
  onScreenChanged(): void;
  dismiss(): void;
  /** Stops all work. The controller can be used again afterwards. */
  shutdown(): void;
}

const SAY_AGAIN = 'I did not catch that. Tap the microphone and try again.';
const FAILED = 'That did not work. Nothing was changed.';

export function createVoiceController(deps: VoiceControllerDeps): VoiceController {
  const setTimer = deps.timers?.set ?? setTimeout;
  const clearTimer = deps.timers?.clear ?? clearTimeout;
  const maxListenMs = deps.limits?.maxListenMs ?? 15_000;
  const settleMs = deps.limits?.settleMs ?? 900;
  const endGuardMs = deps.limits?.endGuardMs ?? 1500;

  let state: VoiceUiState = { phase: 'idle', transcript: '', status: '' };
  const listeners = new Set<() => void>();
  /** Bumped by every new listen, cancel and shutdown: older callbacks see a different number and stop. */
  let session = 0;
  let active: DictationSession | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let guardTimer: ReturnType<typeof setTimeout> | undefined;
  /** Ends the current listening session once, with whatever was heard. */
  let finishCurrent: (() => void) | undefined;
  let cloudConsent = false;
  let announcedFirst = false;
  let working = false;

  const set = (patch: Partial<VoiceUiState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  const clearTimers = () => {
    if (maxTimer) clearTimer(maxTimer);
    if (settleTimer) clearTimer(settleTimer);
    if (guardTimer) clearTimer(guardTimer);
    maxTimer = settleTimer = guardTimer = undefined;
  };

  function say(
    text: string, priority: SpeechPriorityName = 'completion', extra: Partial<SpeakRequest> & { show?: boolean } = {},
  ) {
    const { show = true, ...request } = extra;
    const ctx = deps.context();
    deps.speaker.say({ text, priority, ...speechVoiceFor(ctx.speech, ctx.spec.lang), ...request });
    if (show) set({ reply: text });
  }

  const alive = (my: number) => my === session;

  // ─── Running a command ──────────────────────────────────────────────────────
  interface VoiceCmd {
    actionId?: string;
    fields: FormValues;
    openRecord?: RecordOpenPlan;
    deleteRecord?: RecordDeletePlan;
  }
  const toCmd = (p: VoicePending): VoiceCmd => ({ actionId: p.actionId, fields: p.fields, deleteRecord: p.deleteRecord });

  async function execute(cmd: VoiceCmd, confirmed: boolean, my: number) {
    const out: { exec?: VoiceExecution } = {};
    const res = await deps.run(
      async (env, st) => {
        out.exec = cmd.deleteRecord
          ? await executeDeleteRecord(env, st, cmd.deleteRecord)
          : cmd.openRecord
            ? executeOpenRecord(env, st, cmd.openRecord)
            : await executeVoiceCommand(env, st, cmd);
        return out.exec.result;
      },
      // The person already confirmed by voice or button; a second system dialog would trap a voice-only user.
      confirmed ? { confirm: async () => true } : undefined,
    );
    if (!alive(my)) return;
    set({ phase: 'idle', status: '', pending: undefined });
    if (res === undefined || !out.exec) say(FAILED, 'critical');
    else if (out.exec.say) say(out.exec.say.text, out.exec.say.priority);
  }

  async function answerPending(text: string, my: number) {
    const pending = state.pending;
    if (!pending) return;
    const meta = matchMetaCommand(text);
    if (meta === 'repeat' || meta === 'help') {
      set({ phase: 'confirming', status: 'Waiting for your answer' });
      say(pending.prompt, 'critical', { interrupt: true });
      return;
    }
    if (meta === 'stop') {
      deps.speaker.stop();
      set({ phase: 'confirming', status: 'Waiting for your answer' });
      return;
    }
    const answer = interpretConfirmation(text);
    if (answer === 'confirm') {
      await execute(toCmd(pending), true, my);
    } else if (answer === 'change') {
      await changeDetails(pending, my);
    } else if (answer === 'cancel') {
      set({ phase: 'idle', status: '', pending: undefined });
      say('Cancelled.', 'completion');
    } else {
      set({ phase: 'confirming', status: 'Waiting for your answer' });
      say('I did not catch that. Say confirm or cancel.', 'critical');
    }
  }

  /** Fill what was heard into the form and stop there, so the person can fix it and say "save". */
  async function changeDetails(pending: VoicePending, my: number) {
    if (Object.keys(pending.fields).length === 0) {
      set({ phase: 'idle', status: '', pending: undefined });
      say('Cancelled.', 'completion');
      return;
    }
    set({ pending: undefined });
    await execute({ fields: pending.fields }, false, my);
  }

  /** Works out which list record was meant. The check runs inside the runtime, which owns the live data. */
  async function planRecords(cmd: RecordCommand): Promise<RecordPlan | undefined> {
    const ctx = deps.context();
    const out: { plan?: RecordPlan } = {};
    const res = await deps.run((env, st) => {
      out.plan = planRecordCommand(env.spec, st, env.data, env.now, ctx.accessModes, cmd);
      return { ok: true, state: st, effects: [] };
    });
    return res ? out.plan : undefined;
  }

  async function applyRecordPlan(plan: RecordPlan, my: number) {
    if (plan.kind === 'say') {
      set({ phase: 'idle', status: '' });
      say(plan.say, 'critical');
    } else if (plan.kind === 'open') {
      await execute({ fields: {}, openRecord: plan }, false, my);
    } else {
      set({
        phase: 'confirming', status: 'Waiting for your answer',
        pending: { fields: {}, deleteRecord: plan, reason: 'destructive', prompt: plan.prompt },
      });
      say(plan.prompt, 'critical', { interrupt: true });
    }
  }

  async function handle(text: string, my: number) {
    const ctx = deps.context();
    set({ phase: 'thinking', status: 'Working on it', transcript: text });
    if (state.pending) return answerPending(text, my);

    const meta = matchMetaCommand(text);
    const screen = findScreen(ctx.spec, ctx.screenId) ?? ctx.spec.screens[0];
    if (meta === 'repeat') {
      set({ phase: 'idle', status: '' });
      if (!deps.speaker.repeatLast()) say('There is nothing to repeat yet.', 'completion');
      return;
    }
    if (meta === 'stop') {
      deps.speaker.stop();
      set({ phase: 'idle', status: '' });
      return;
    }
    if (meta === 'help' && screen) {
      set({ phase: 'idle', status: '' });
      say(buildHelpText(ctx.spec, screen, ctx.accessModes), 'result', { interrupt: true });
      return;
    }
    if (meta === 'cancel') {
      set({ phase: 'idle', status: '' });
      say('There is nothing to cancel.', 'completion');
      return;
    }

    // "Open the last order", "delete Raju": picking a record is a voice command of its own. Position words
    // win over the app's phrases; a name only counts when the app has no command of that name.
    const recordCmd = parseRecordCommand(text);
    if (recordCmd && recordCmd.ref.kind !== 'text') {
      const plan = await planRecords(recordCmd);
      if (!alive(my)) return;
      if (plan) return applyRecordPlan(plan, my);
    }

    let result: VoiceActionResult;
    try {
      result = await deps.interpret(ctx.spec, ctx.screenId, text);
    } catch {
      if (!alive(my)) return;
      set({ phase: 'idle', status: '' });
      say('Voice commands are not working right now. You can use the buttons instead.', 'critical');
      return;
    }
    if (!alive(my)) return;

    if (meta === 'back' && result.action === null && Object.keys(result.fields).length === 0) {
      set({ phase: 'idle', status: '' });
      if (deps.goBack) deps.goBack();
      else say('There is no earlier screen.', 'completion');
      return;
    }

    if (recordCmd && recordCmd.ref.kind === 'text' && result.action === null && Object.keys(result.fields).length === 0) {
      const byName = await planRecords(recordCmd);
      if (!alive(my)) return;
      if (byName) return applyRecordPlan(byName, my);
    }

    const plan = planVoiceCommand(ctx.spec, deps.getState(), result, { modes: ctx.accessModes, now: new Date() });
    switch (plan.kind) {
      case 'refuse':
        set({ phase: 'idle', status: '' });
        say(plan.say, 'critical');
        return;
      case 'fill':
        await execute({ fields: plan.fields }, false, my);
        return;
      case 'run':
        await execute({ actionId: plan.actionId, fields: plan.fields }, false, my);
        return;
      case 'confirm':
        set({
          phase: 'confirming', status: 'Waiting for your answer',
          pending: { actionId: plan.actionId, fields: plan.fields, reason: plan.reason, prompt: plan.prompt },
        });
        say(plan.prompt, 'critical', { interrupt: true });
        return;
    }
  }

  async function process(text: string, my: number) {
    if (working) return;
    working = true;
    try {
      await handle(text, my);
    } catch {
      if (alive(my)) {
        set({ phase: state.pending ? 'confirming' : 'idle', status: '' });
        say('Something went wrong. Nothing was changed.', 'critical');
      }
    } finally {
      working = false;
    }
  }

  // ─── Listening ──────────────────────────────────────────────────────────────
  async function begin(onDevice: boolean, my: number) {
    const ctx = deps.context();
    const screen = findScreen(ctx.spec, ctx.screenId) ?? ctx.spec.screens[0];
    let heard = '';
    let lastError = '';
    let handled = false;

    const finish = () => {
      if (handled || !alive(my)) return;
      handled = true;
      finishCurrent = undefined;
      clearTimers();
      active = undefined;
      const text = heard.trim();
      if (!text) {
        const message = lastError || SAY_AGAIN;
        set({ phase: 'idle', status: '' });
        say(message, 'critical');
        return;
      }
      void process(text, my);
    };

    try {
      const dictation = await deps.dictation.start({
        lang: ctx.speech.sttLanguage,
        onDevice,
        // Voice commands are throwaway: never keep the recording (docs/11 §7.3).
        keepRecording: false,
        hints: screen ? voiceHints(ctx.spec, screen) : undefined,
        onText: (text, isFinal) => {
          if (!alive(my)) return;
          heard = text;
          set({ transcript: text });
          if (isFinal) {
            if (settleTimer) clearTimer(settleTimer);
            settleTimer = setTimer(() => stopListening(), settleMs);
          }
        },
        onError: (message) => {
          if (alive(my)) lastError = message;
        },
        onEnd: () => finish(),
      });
      if (!alive(my)) {
        dictation.abort();
        return;
      }
      active = dictation;
      finishCurrent = finish;
      set({ phase: 'listening', status: 'Listening', where: dictation.location });
      maxTimer = setTimer(() => stopListening(), maxListenMs);
    } catch (e) {
      if (!alive(my)) return;
      const message = e instanceof Error && e.message ? e.message : 'Listening could not start. You can type a command instead.';
      set({ phase: 'idle', status: '', unavailable: message });
      say(message, 'critical');
    }
  }

  function stopListening() {
    if (!active) return;
    active.stop();
    // Some platforms never report the end of a stopped session: finish anyway.
    if (guardTimer) clearTimer(guardTimer);
    guardTimer = setTimer(() => {
      const a = active;
      finishCurrent?.();
      a?.abort();
    }, endGuardMs);
  }

  const controller: VoiceController = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async prepare() {
      const lang = deps.context().speech.sttLanguage;
      const cap = await deps.dictation.getCapability(lang).catch(() => undefined);
      set({ capability: cap ?? { supported: false, onDevice: 'unavailable', locale: lang } });
    },

    async listen() {
      if (state.phase === 'listening' || state.phase === 'starting') {
        stopListening();
        return;
      }
      if (state.phase === 'thinking') return;
      // Stop talking first: the microphone must not hear Kalam's own voice.
      deps.speaker.stop();
      const ctx = deps.context();
      const my = ++session;
      set({ phase: 'starting', status: 'Getting the microphone ready', transcript: '', unavailable: undefined, consent: undefined });
      const cap = await deps.dictation.getCapability(ctx.speech.sttLanguage).catch(() => undefined);
      if (!alive(my)) return;
      set({ capability: cap });
      const path = chooseSpeechPath(cap, { aiMode: ctx.aiMode, allowCloud: ctx.allowCloud, consent: cloudConsent });
      if (path.kind === 'unsupported' || path.kind === 'blocked') {
        const message = blockedMessage(path);
        set({ phase: 'idle', status: '', unavailable: message });
        say(message, 'critical');
        return;
      }
      // The online speech service cannot hear anyone without a network.
      if ((path.kind === 'needs_consent' || path.kind === 'cloud_service') && deps.online?.() === false) {
        const message = 'You are offline, and this device needs the internet to hear you. You can type a command instead.';
        set({ phase: 'idle', status: '', unavailable: message });
        say(message, 'critical');
        return;
      }
      if (path.kind === 'needs_consent') {
        set({ phase: 'consent', status: '', consent: { canDownload: path.canDownload } });
        say(`To hear you, this device needs ${deps.serviceName}. Choose Allow, or type a command instead.`, 'critical');
        return;
      }
      await begin(path.kind === 'on_device', my);
    },

    cancel() {
      session += 1;
      finishCurrent = undefined;
      clearTimers();
      const a = active;
      active = undefined;
      a?.abort();
      deps.speaker.stop();
      set({ phase: 'idle', status: '', transcript: '', pending: undefined, consent: undefined, reply: undefined });
    },

    async confirm() {
      const pending = state.pending;
      if (!pending || working) return;
      working = true;
      const my = ++session;
      try {
        set({ phase: 'thinking', status: 'Working on it' });
        await execute(toCmd(pending), true, my);
      } catch {
        if (alive(my)) {
          set({ phase: 'idle', status: '', pending: undefined });
          say(FAILED, 'critical');
        }
      } finally {
        working = false;
      }
    },

    async changeDetails() {
      const pending = state.pending;
      if (!pending || working) return;
      working = true;
      const my = ++session;
      try {
        set({ phase: 'thinking', status: 'Working on it' });
        await changeDetails(pending, my);
      } catch {
        if (alive(my)) {
          set({ phase: 'idle', status: '', pending: undefined });
          say(FAILED, 'critical');
        }
      } finally {
        working = false;
      }
    },

    decline() {
      if (!state.pending) return;
      session += 1;
      set({ phase: 'idle', status: '', pending: undefined });
      say('Cancelled.', 'completion', { interrupt: true });
    },

    async submitText(text) {
      const trimmed = text.trim().slice(0, 300);
      if (!trimmed || state.phase === 'thinking') return;
      const my = ++session;
      finishCurrent = undefined;
      clearTimers();
      const a = active;
      active = undefined;
      a?.abort();
      deps.speaker.stop();
      await process(trimmed, my);
    },

    async allowService() {
      cloudConsent = true;
      set({ consent: undefined, phase: 'idle' });
      await controller.listen();
    },

    async downloadModel() {
      const lang = deps.context().speech.sttLanguage;
      set({ status: 'Downloading the speech model' });
      const ok = await deps.dictation.install(lang).catch(() => false);
      const cap = await deps.dictation.getCapability(lang).catch(() => undefined);
      set({ capability: cap });
      if (ok && cap?.onDevice === 'available') {
        set({ consent: undefined, phase: 'idle', status: 'The speech model is ready. Tap the microphone.' });
      } else {
        set({ status: 'The speech model could not be downloaded right now.' });
      }
    },

    repeat() {
      if (!deps.speaker.repeatLast()) say('There is nothing to repeat yet.', 'completion');
    },

    stopSpeaking() {
      deps.speaker.stop();
    },

    announceScreen() {
      const ctx = deps.context();
      const screen = findScreen(ctx.spec, ctx.screenId);
      if (!screen) return;
      const a = buildScreenAnnouncement(ctx.spec, screen, ctx.accessModes, { first: !announcedFirst });
      announcedFirst = true;
      say(a.text, 'navigation', { key: 'screen', show: false });
    },

    onScreenChanged() {
      // A question about the old screen would act on the wrong thing.
      if (state.pending || state.consent) {
        set({ pending: undefined, consent: undefined, phase: state.phase === 'listening' ? 'listening' : 'idle', status: '' });
      }
    },

    dismiss() {
      if (state.phase === 'idle') set({ reply: undefined, status: '', unavailable: undefined });
    },

    shutdown() {
      session += 1;
      finishCurrent = undefined;
      clearTimers();
      const a = active;
      active = undefined;
      a?.abort();
      deps.speaker.stop();
      working = false;
      state = { phase: 'idle', transcript: '', status: '', capability: state.capability };
      listeners.forEach((l) => l());
    },
  };
  return controller;
}
