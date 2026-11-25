import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SPEECH, type AccessModes, type AIOrchestrator, type KalamRecord, type RuntimeServices, type SpeechPreferences,
} from '@/core/contracts';
import { kalamSpecSchema, type KalamSpec } from '@/core/spec/schema';
import { createVoiceService } from '@/core/tasks/voice-service';
import type { DictationSession, SpeechCapability, StartDictationOptions } from '@/infrastructure/platform/speech.shared';
import type { SpeakRequest } from '@/infrastructure/platform/tts-queue';
import { createMemoryStores, createRuntimeState, type DataSnapshot, type RuntimeState } from '../engine';
import { createVoiceController, type VoiceContext, type VoiceRunner } from './controller';
import { speechVoiceFor } from './speech-voice';

const NOW = new Date(2026, 10, 17, 10, 30);
const NORMAL: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false };
const VOICE_ONLY: AccessModes = { ...NORMAL, voiceOnly: true };

const spec: KalamSpec = kalamSpecSchema.parse({
  id: 'app_voice',
  schemaVersion: '1.0.0',
  version: 1,
  name: 'Tailor book',
  lang: 'en',
  theme: { primary: '#315C4C', radius: 12, fontScale: 1, preset: 'calm_green' },
  collections: {
    orders: {
      label: 'Orders',
      fields: {
        customer: { type: 'text', label: 'Customer', required: true },
        chest: { type: 'number', label: 'Chest', min: 10, max: 80, unit: 'in' },
      },
    },
  },
  screens: [
    {
      id: 'home', title: 'Orders', children: [
        { id: 'new_btn', type: 'bigButton', label: 'New order', action: 'go_new' },
        { id: 'orders_list', type: 'list', source: 'orders', primary: 'customer', detailScreen: 'edit', allowDelete: true },
      ],
    },
    {
      id: 'new', title: 'New order', form: 'orders', children: [
        { id: 'customer_in', type: 'textInput', label: 'Customer', field: 'customer', required: true },
        { id: 'chest_in', type: 'number', label: 'Chest', field: 'chest' },
        { id: 'save_btn', type: 'bigButton', label: 'Save', action: 'save_order' },
      ],
    },
    {
      id: 'edit', title: 'Edit order', form: 'orders', children: [
        { id: 'customer_ed', type: 'textInput', label: 'Customer', field: 'customer', required: true },
        { id: 'delete_btn', type: 'bigButton', label: 'Delete', action: 'delete_order', tone: 'danger' },
      ],
    },
  ],
  initialScreen: 'home',
  actions: {
    go_new: { type: 'navigate', screen: 'new' },
    save_order: { type: 'insert', collection: 'orders', then: { navigate: 'home' } },
    delete_order: { type: 'delete', collection: 'orders', record: 'selected', confirm: 'Delete this order?' },
  },
  aiBlocks: {},
  intents: { save_order: ['save', 'done'], go_new: ['new order'] },
  meta: { createdAt: 0 },
});

const RECORD: KalamRecord = { id: 'r1', appId: spec.id, collectionId: 'orders', createdAt: 1, updatedAt: 1, values: { customer: 'Raju' } };
const MEENA: KalamRecord = { ...RECORD, id: 'r2', createdAt: 2, updatedAt: 2, values: { customer: 'Meena' } };
const AVAILABLE: SpeechCapability = { supported: true, onDevice: 'available', locale: 'en-IN' };

interface Options {
  screen?: string;
  selection?: RuntimeState['selection'];
  modes?: AccessModes;
  cap?: SpeechCapability;
  aiMode?: 'hybrid' | 'offline_only';
  allowCloud?: boolean;
  online?: boolean;
  speech?: SpeechPreferences;
  interpretThrows?: boolean;
  /** Records already saved in the app. */
  records?: KalamRecord[];
}

function build(o: Options = {}) {
  const start = o.screen ?? 'home';
  let state: RuntimeState = { ...createRuntimeState(spec), stack: start === 'home' ? ['home'] : ['home', start], selection: o.selection ?? null };
  const stores = createMemoryStores(spec.id, { records: { orders: o.records ?? (o.selection ? [RECORD] : []) } });
  const platformConfirm = vi.fn(async () => false);
  const services: RuntimeServices = {
    ...stores, runAIBlock: vi.fn(), pickImage: vi.fn(), confirm: platformConfirm, speak: vi.fn(), online: () => o.online ?? true,
  };
  const data: DataSnapshot = { records: {}, state: {} };
  const run: VoiceRunner = async (op, overrides) => {
    data.records = await stores.records.listAll(spec.id);
    const res = await op({ spec, appId: spec.id, services: overrides ? { ...services, ...overrides } : services, data, now: NOW }, state);
    state = res.state;
    return res;
  };

  const said: SpeakRequest[] = [];
  const speaker = {
    say: vi.fn((r: SpeakRequest) => {
      said.push(r);
      return true;
    }),
    stop: vi.fn(),
    repeatLast: vi.fn(() => true),
    isSpeaking: vi.fn(() => false),
  };

  const sessions: Array<{ opts: StartDictationOptions; session: DictationSession & { stop: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> } }> = [];
  const dictation = {
    getCapability: vi.fn(async () => o.cap ?? AVAILABLE),
    install: vi.fn(async () => true),
    start: vi.fn(async (opts: StartDictationOptions) => {
      const session = { location: opts.onDevice ? ('on_device' as const) : ('cloud_service' as const), stop: vi.fn(), abort: vi.fn() };
      sessions.push({ opts, session });
      return session;
    }),
  };

  const ai = {
    status: async () => ({ onDevice: { availability: 'unavailable' } }),
    run: vi.fn(),
  } as unknown as AIOrchestrator;
  const realVoice = createVoiceService({ ai, now: () => NOW });
  const interpret = o.interpretThrows
    ? async (): Promise<never> => { throw new Error('boom'); }
    : (s: KalamSpec, id: string, t: string) => realVoice.interpret(s, id, t);

  const goBack = vi.fn();
  const context = (): VoiceContext => ({
    spec,
    screenId: state.stack[state.stack.length - 1]!,
    accessModes: o.modes ?? NORMAL,
    speech: o.speech ?? DEFAULT_SPEECH,
    aiMode: o.aiMode ?? 'hybrid',
    allowCloud: o.allowCloud ?? true,
  });
  const controller = createVoiceController({
    context, interpret, run, getState: () => state, goBack, speaker, dictation,
    serviceName: "your browser's speech service", online: () => o.online ?? true,
  });

  const lines = () => said.map((r) => r.text);
  /** One full spoken turn: tap, say `text`, silence, the platform ends the session. */
  async function turn(text: string) {
    await controller.listen();
    const { opts } = sessions[sessions.length - 1]!;
    opts.onText(text, true);
    await vi.advanceTimersByTimeAsync(1000);
    opts.onEnd({});
    await vi.advanceTimersByTimeAsync(20);
  }
  return { controller, state: () => state, stores, platformConfirm, said, lines, speaker, dictation, sessions, turn, goBack };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('voice agent: one spoken turn', () => {
  it('listens on tap, fills the form from what was heard, and reads it back', async () => {
    const t = build({ screen: 'new' });
    await t.turn('customer Raju chest 40');
    expect(t.dictation.start).toHaveBeenCalledTimes(1);
    const { opts } = t.sessions[0]!;
    expect(opts).toMatchObject({ lang: 'en-IN', onDevice: true, keepRecording: false });
    expect(opts.hints).toEqual(expect.arrayContaining(['Save', 'Customer']));
    expect(t.state().forms.new).toMatchObject({ customer: 'Raju', chest: 40 });
    expect(t.lines()).toEqual(['Set Customer Raju, Chest 40 in.']);
    expect(t.controller.getState().phase).toBe('idle');
    expect(t.controller.getState().reply).toBe('Set Customer Raju, Chest 40 in.');
  });

  it('saves through the engine on a second turn and says it', async () => {
    const t = build({ screen: 'new' });
    await t.turn('customer Raju');
    await t.turn('save');
    expect(await t.stores.records.list(spec.id, 'orders')).toHaveLength(1);
    expect(t.state().stack).toEqual(['home']);
    expect(t.lines().at(-1)).toBe('Saved.');
    expect(t.platformConfirm).not.toHaveBeenCalled();
  });

  it('moves to another screen on a spoken command', async () => {
    const t = build();
    await t.turn('new order');
    expect(t.state().stack).toEqual(['home', 'new']);
    expect(t.lines()).toEqual(['Opened New order.']);
  });

  it('refuses what it does not understand, with a short spoken reason', async () => {
    const t = build();
    await t.turn('make me a sandwich');
    expect(t.lines()).toEqual(['I did not understand that. You can say: New order.']);
    expect(t.said[0]!.priority).toBe('critical');
    expect(t.state().stack).toEqual(['home']);
  });

  it('says so when nothing was heard', async () => {
    const t = build();
    await t.controller.listen();
    const { opts } = t.sessions[0]!;
    opts.onError('Kalam did not hear anything. Try again a little closer to the microphone.');
    opts.onEnd({});
    await vi.advanceTimersByTimeAsync(20);
    expect(t.lines()).toEqual(['Kalam did not hear anything. Try again a little closer to the microphone.']);
    expect(t.controller.getState().phase).toBe('idle');
  });

  it('stops listening on a second tap and uses what was heard', async () => {
    const t = build({ screen: 'new' });
    await t.controller.listen();
    const { opts, session } = t.sessions[0]!;
    opts.onText('customer Meena', false);
    expect(t.controller.getState().phase).toBe('listening');
    await t.controller.listen();
    expect(session.stop).toHaveBeenCalled();
    opts.onEnd({});
    await vi.advanceTimersByTimeAsync(20);
    expect(t.state().forms.new).toMatchObject({ customer: 'Meena' });
  });

  it('stops by itself at the time limit, and finishes even if the platform never reports the end', async () => {
    const t = build({ screen: 'new' });
    await t.controller.listen();
    const { opts, session } = t.sessions[0]!;
    opts.onText('customer Asha', false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(session.stop).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600); // no onEnd ever arrives
    expect(session.abort).toHaveBeenCalled();
    expect(t.state().forms.new).toMatchObject({ customer: 'Asha' });
  });

  it('cancel drops a session in progress and ignores its late end', async () => {
    const t = build({ screen: 'new' });
    await t.controller.listen();
    const { opts, session } = t.sessions[0]!;
    opts.onText('customer Asha', true);
    t.controller.cancel();
    expect(session.abort).toHaveBeenCalled();
    opts.onEnd({});
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.state().forms.new).toBeUndefined();
    expect(t.lines()).toEqual([]);
    expect(t.controller.getState().phase).toBe('idle');
  });

  it('stops talking before it listens, so the microphone never hears Kalam', async () => {
    const t = build();
    await t.controller.listen();
    expect(t.speaker.stop).toHaveBeenCalled();
  });

  it('speaks an error when the voice service fails, and does nothing else', async () => {
    const t = build({ interpretThrows: true });
    await t.turn('new order');
    expect(t.lines()).toEqual(['Voice commands are not working right now. You can use the buttons instead.']);
    expect(t.state().stack).toEqual(['home']);
  });
});

describe('voice agent: confirmation', () => {
  it('reads a delete back, waits, and deletes only after "confirm"', async () => {
    const t = build({ screen: 'edit', selection: { collection: 'orders', recordId: 'r1' } });
    await t.turn('delete');
    expect(t.controller.getState().phase).toBe('confirming');
    expect(t.controller.getState().pending?.prompt).toBe('Delete this order? Say confirm or cancel.');
    expect(t.said.at(-1)).toMatchObject({ text: 'Delete this order? Say confirm or cancel.', interrupt: true, priority: 'critical' });
    expect(await t.stores.records.list(spec.id, 'orders')).toHaveLength(1);

    await t.turn('confirm');
    expect(await t.stores.records.list(spec.id, 'orders')).toHaveLength(0);
    // The voice confirmation replaces the system dialog, which a voice-only user could not answer.
    expect(t.platformConfirm).not.toHaveBeenCalled();
    expect(t.lines().at(-1)).toBe('Deleted.');
    expect(t.controller.getState().pending).toBeUndefined();
  });

  it('cancel by voice keeps the record', async () => {
    const t = build({ screen: 'edit', selection: { collection: 'orders', recordId: 'r1' } });
    await t.turn('delete');
    await t.turn('cancel');
    expect(await t.stores.records.list(spec.id, 'orders')).toHaveLength(1);
    expect(t.lines().at(-1)).toBe('Cancelled.');
    expect(t.controller.getState().phase).toBe('idle');
  });

  it('the on-screen buttons do the same as the spoken answers', async () => {
    const yes = build({ screen: 'edit', selection: { collection: 'orders', recordId: 'r1' } });
    await yes.turn('delete');
    await yes.controller.confirm();
    expect(await yes.stores.records.list(spec.id, 'orders')).toHaveLength(0);

    const no = build({ screen: 'edit', selection: { collection: 'orders', recordId: 'r1' } });
    await no.turn('delete');
    no.controller.decline();
    expect(await no.stores.records.list(spec.id, 'orders')).toHaveLength(1);
    expect(no.lines().at(-1)).toBe('Cancelled.');
  });

  it('asks again on an unclear answer and repeats the question on "repeat"', async () => {
    const t = build({ screen: 'edit', selection: { collection: 'orders', recordId: 'r1' } });
    await t.turn('delete');
    await t.turn('maybe later');
    expect(t.lines().at(-1)).toBe('I did not catch that. Say confirm or cancel.');
    expect(t.controller.getState().phase).toBe('confirming');
    await t.turn('repeat');
    expect(t.lines().at(-1)).toBe('Delete this order? Say confirm or cancel.');
    expect(await t.stores.records.list(spec.id, 'orders')).toHaveLength(1);
  });

  it('drops the question when the screen changes underneath it', async () => {
    const t = build({ screen: 'edit', selection: { collection: 'orders', recordId: 'r1' } });
    await t.turn('delete');
    t.controller.onScreenChanged();
    expect(t.controller.getState().pending).toBeUndefined();
    expect(t.controller.getState().phase).toBe('idle');
  });

  it('Voice-only Mode reads heard values back before saving', async () => {
    const t = build({ screen: 'new', modes: VOICE_ONLY });
    await t.turn('customer Raju save');
    expect(t.controller.getState().pending?.reason).toBe('readback');
    expect(t.lines().at(-1)).toBe('I understood: Customer Raju. Should I save this to Orders? Say confirm or cancel.');
    expect(await t.stores.records.list(spec.id, 'orders')).toHaveLength(0);
    await t.turn('yes');
    expect(await t.stores.records.list(spec.id, 'orders')).toHaveLength(1);
    expect(t.lines().at(-1)).toBe('Saved.');
  });
});

describe('voice agent: speech recognition rules', () => {
  const NO_ON_DEVICE: SpeechCapability = { supported: true, onDevice: 'unavailable', locale: 'en-IN' };

  it('asks before using the online speech service, and listens only after the person allows it', async () => {
    const t = build({ cap: NO_ON_DEVICE });
    await t.controller.listen();
    expect(t.dictation.start).not.toHaveBeenCalled();
    expect(t.controller.getState().phase).toBe('consent');
    expect(t.lines().at(-1)).toContain("your browser's speech service");
    await t.controller.allowService();
    expect(t.dictation.start).toHaveBeenCalledTimes(1);
    expect(t.sessions[0]!.opts.onDevice).toBe(false);
    expect(t.controller.getState().where).toBe('cloud_service');
  });

  it('never uses the online service in offline-only mode, and says how to carry on', async () => {
    const t = build({ cap: NO_ON_DEVICE, aiMode: 'offline_only' });
    await t.controller.listen();
    expect(t.dictation.start).not.toHaveBeenCalled();
    expect(t.lines().at(-1)).toMatch(/type a command/i);
    expect(t.controller.getState().unavailable).toBeDefined();
  });

  it('says it cannot hear when the device is offline and only the online service exists', async () => {
    const t = build({ cap: NO_ON_DEVICE, online: false });
    await t.controller.listen();
    expect(t.dictation.start).not.toHaveBeenCalled();
    expect(t.lines().at(-1)).toMatch(/offline/i);
  });

  it('typed commands work without any speech recognition at all', async () => {
    const t = build({ cap: { supported: false, onDevice: 'unavailable', locale: 'en-IN' } });
    await t.controller.prepare();
    expect(t.controller.getState().capability?.supported).toBe(false);
    await t.controller.submitText('new order');
    expect(t.dictation.start).not.toHaveBeenCalled();
    expect(t.state().stack).toEqual(['home', 'new']);
    expect(t.lines()).toEqual(['Opened New order.']);
  });

  it('listens in the language from the speech settings', async () => {
    const t = build({ speech: { ...DEFAULT_SPEECH, sttLanguage: 'hi-IN' } });
    await t.controller.listen();
    expect(t.sessions[0]!.opts.lang).toBe('hi-IN');
  });
});

describe('voice agent: spoken help and Voice-only screens', () => {
  it('repeat asks the speech queue to say the last line again', async () => {
    const t = build();
    await t.turn('repeat');
    expect(t.speaker.repeatLast).toHaveBeenCalled();
  });

  it('help speaks the commands for this screen', async () => {
    const t = build();
    await t.turn('what can I say');
    expect(t.lines().at(-1)).toContain('On this screen you can say: New order.');
  });

  it('"go back" goes back when the app has no command of that name', async () => {
    const t = build({ screen: 'new' });
    await t.turn('go back');
    expect(t.goBack).toHaveBeenCalledTimes(1);
  });

  it('announces a screen: title and commands, with the microphone hint only the first time', () => {
    const t = build({ modes: VOICE_ONLY });
    t.controller.announceScreen();
    t.controller.announceScreen();
    expect(t.said[0]).toMatchObject({
      text: 'Orders. Tap the microphone to talk. You can say: New order.', priority: 'navigation', key: 'screen',
    });
    expect(t.said[1]!.text).toBe('Orders. You can say: New order.');
    // Announcements are not shown as an answer.
    expect(t.controller.getState().reply).toBeUndefined();
  });

  it('speaks with the language, voice and rate from the settings', () => {
    const speech: SpeechPreferences = { ...DEFAULT_SPEECH, ttsLanguage: 'en-IN', voiceId: 'v1', rate: 1.5 };
    const t = build({ modes: VOICE_ONLY, speech });
    t.controller.announceScreen();
    expect(t.said[0]).toMatchObject({ language: 'en-IN', voiceId: 'v1', rate: 1.5 });
  });
});

describe('voice agent: choosing and deleting records by voice', () => {
  const two = { records: [RECORD, MEENA] };

  it('"delete the last order": names the record, waits, deletes only after "confirm"', async () => {
    const t = build({ ...two });
    await t.turn('delete the last order');
    expect(t.controller.getState().pending?.prompt).toBe('Delete Meena? Say confirm or cancel.');
    expect(await t.stores.records.list(spec.id, 'orders')).toHaveLength(2);
    await t.turn('confirm');
    expect((await t.stores.records.list(spec.id, 'orders')).map((r) => r.id)).toEqual(['r1']);
    expect(t.platformConfirm).not.toHaveBeenCalled();
    expect(t.lines().at(-1)).toBe('Deleted.');
  });

  it('cancelling leaves every record', async () => {
    const t = build({ ...two });
    await t.turn('delete the first order');
    expect(t.controller.getState().pending?.prompt).toBe('Delete Raju? Say confirm or cancel.');
    await t.turn('no');
    expect(await t.stores.records.list(spec.id, 'orders')).toHaveLength(2);
    expect(t.lines().at(-1)).toBe('Cancelled.');
  });

  it('opens a record by position or by name, like a tap', async () => {
    const byPosition = build({ ...two });
    await byPosition.turn('open the first order');
    expect(byPosition.state().stack).toEqual(['home', 'edit']);
    expect(byPosition.state().selection).toEqual({ collection: 'orders', recordId: 'r1' });
    expect(byPosition.lines()).toEqual(['Opened Raju.']);

    const byName = build({ ...two });
    await byName.turn('open Meena');
    expect(byName.state().selection).toEqual({ collection: 'orders', recordId: 'r2' });
  });

  it('then the app\'s own delete command works on the opened record', async () => {
    const t = build({ ...two });
    await t.turn('open Meena');
    await t.turn('delete');
    expect(t.controller.getState().pending?.prompt).toBe('Delete this order? Say confirm or cancel.');
    await t.turn('confirm');
    expect((await t.stores.records.list(spec.id, 'orders')).map((r) => r.id)).toEqual(['r1']);
  });

  it('keeps the app\'s own commands working, and refuses to guess between names', async () => {
    const t = build({ records: [RECORD, { ...MEENA, id: 'r3', values: { customer: 'Raju Kumar' } }] });
    await t.turn('open new order');
    expect(t.state().stack).toEqual(['home', 'new']);
    const u = build({ records: [RECORD, { ...MEENA, id: 'r3', values: { customer: 'Raju Kumar' } }] });
    await u.turn('open Raju');
    expect(u.lines()).toEqual(['I found 2 matches. Say more of the name.']);
    expect(u.state().stack).toEqual(['home']);
  });

  it('says why it cannot, on a screen without a list or with an empty one', async () => {
    const noList = build({ screen: 'new', ...two });
    await noList.turn('delete the last order');
    expect(noList.lines()).toEqual(['Go to the list first, then say which one.']);
    const empty = build();
    await empty.turn('delete the last order');
    expect(empty.lines()).toEqual(['There is nothing in the list yet.']);
  });
});

describe('voice agent: "Change details" (docs/03 §16.4)', () => {
  const heardOrder = async () => {
    const t = build({ screen: 'new', modes: VOICE_ONLY });
    await t.turn('customer Raju save');
    expect(t.controller.getState().pending?.reason).toBe('readback');
    return t;
  };

  it('keeps what was heard in the form and does not save', async () => {
    const t = await heardOrder();
    await t.controller.changeDetails();
    expect(t.state().forms.new).toMatchObject({ customer: 'Raju' });
    expect(await t.stores.records.list(spec.id, 'orders')).toHaveLength(0);
    expect(t.controller.getState().pending).toBeUndefined();
    expect(t.lines().at(-1)).toBe('Set Customer Raju.');
  });

  it('works by voice too', async () => {
    const t = await heardOrder();
    await t.turn('change details');
    expect(t.state().forms.new).toMatchObject({ customer: 'Raju' });
    expect(await t.stores.records.list(spec.id, 'orders')).toHaveLength(0);
  });

  it('a spoken correction replaces the pending command', async () => {
    const t = await heardOrder();
    await t.turn('change details');
    await t.turn('customer Meena');
    expect(t.lines().at(-1)).toBe('Set Customer Meena.');
    // The value was read back when it was set, so a bare "save" goes straight through.
    await t.turn('save');
    expect(t.controller.getState().pending).toBeUndefined();
    const saved = await t.stores.records.list(spec.id, 'orders');
    expect(saved).toHaveLength(1);
    expect(saved[0]!.values.customer).toBe('Meena');
  });
});

describe('speech voice for an app', () => {
  it('uses the saved voice only for the language it was chosen for', () => {
    const prefs: SpeechPreferences = { ...DEFAULT_SPEECH, ttsLanguage: 'en-IN', voiceId: 'v1', rate: 9 };
    expect(speechVoiceFor(prefs, 'en')).toEqual({ language: 'en-IN', voiceId: 'v1', rate: 2 });
    expect(speechVoiceFor(prefs, 'hi')).toEqual({ language: 'hi', rate: 2 });
  });
});
