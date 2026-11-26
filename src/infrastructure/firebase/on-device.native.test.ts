/**
 * Android on-device bridge (docs/17 FAI-04 and FAI-07, docs/07 §6.6). The kalam-nano native module is a
 * fake placed on globalThis.expo.modules, where Expo installs the real one. The last block drives the real
 * firebase/ai esm build (the build Metro bundles for Android) through Kalam's unchanged firebase-provider, to
 * show its hybrid router sends on-device work to the bridge and reports where it ran.
 * NOT proof that Gemini Nano runs on a phone: that needs a device build (modules/kalam-nano/README.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { LanguageModelCreateOptions, LanguageModelMessage } from 'firebase/ai';
import { ON_DEVICE_MODEL } from '@/core/ai/model-config';
import type { StructuredRequest } from '@/core/contracts';
import type { KalamNanoModule, NativeStatus } from '../../../modules/kalam-nano';
import { mapFirebaseError } from './errors';

const esm = vi.hoisted(() => ({
  ai: new URL('../../../node_modules/@firebase/ai/dist/esm/index.esm.js', import.meta.url).href,
}));
// Vitest would load firebase/ai's Node build, which has no on-device path. Android gets the esm build.
vi.mock('firebase/ai', async () => import(/* @vite-ignore */ esm.ai));
// firebase-provider imports './on-device'; on Android Metro resolves that to on-device.native.ts.
vi.mock('./on-device', async () => import('./on-device.native'));

type Listener = (e: { bytesDownloaded: number; bytesToDownload?: number | null }) => void;
type G = { expo?: unknown; LanguageModel?: unknown };
const g = globalThis as G;

function fakeNano(status: NativeStatus = { availability: 'available', model: 'nano-v4-full' }) {
  const listeners = new Set<Listener>();
  const native = {
    configure: vi.fn(),
    availability: vi.fn(async (): Promise<NativeStatus> => status),
    prepare: vi.fn(async (): Promise<NativeStatus> => ({ availability: 'available' })),
    warmUp: vi.fn(async () => true),
    generate: vi.fn(async (_id: string, _o: { prompt: string }) => ({ text: '{"category":"shopping"}', source: 'on_device' as const })),
    cancel: vi.fn(() => true),
    installPlayIntegrity: vi.fn(),
    getAppCheckToken: vi.fn(async () => ({ token: 't', expireTimeMillis: 0 })),
    addListener: vi.fn((_event: 'onDownloadProgress', l: Listener) => {
      listeners.add(l);
      return { remove: () => { listeners.delete(l); } };
    }),
  };
  const emit = (e: Parameters<Listener>[0]) => listeners.forEach((l) => l(e));
  return { native, listeners, emit };
}

/** Fresh module state, with or without the native module linked. */
async function load(native?: KalamNanoModule) {
  vi.resetModules();
  delete g.LanguageModel;
  if (native) g.expo = { modules: { KalamNano: native } };
  else delete g.expo;
  return import('./on-device.native');
}

const userMessage = (text: string): LanguageModelMessage[] => [{ role: 'user', content: [{ type: 'text', value: text }] }];

beforeEach(() => {
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_API_KEY', 'test-api-key');
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'test-project');
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_APP_ID', '1:123:web:abc');
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete g.LanguageModel;
  delete g.expo;
});

describe('Android bridge: no native module (Expo Go, web, unit tests)', () => {
  it('reports unavailable with the reason and installs no adapter, so requests go to the cloud', async () => {
    const mod = await load();
    expect(await mod.onDeviceStatus()).toEqual({
      platform: 'android', apiExposed: false, availability: 'unavailable', detail: expect.stringMatching(/Expo Go/),
    });
    expect(mod.getLanguageModel()).toBeUndefined();
    expect(g.LanguageModel).toBeUndefined();
    expect((await mod.prepareOnDevice()).availability).toBe('unavailable');
    expect((await mod.warmUpOnDevice()).availability).toBe('unavailable');
  });

  it('does not start without the public Firebase ids, and says so', async () => {
    vi.stubEnv('EXPO_PUBLIC_FIREBASE_API_KEY', '');
    const { native } = fakeNano();
    const mod = await load(native);
    expect(await mod.onDeviceStatus()).toMatchObject({ apiExposed: false, availability: 'unavailable', detail: expect.stringMatching(/Firebase/) });
    expect(native.configure).not.toHaveBeenCalled();
    expect(mod.getLanguageModel()).toBeUndefined();
  });
});

describe('Android bridge: capability detection (FAI-07)', () => {
  it('configures the native Firebase app once, preferring the Android app id', async () => {
    vi.stubEnv('EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID', '1:123:android:def');
    const { native } = fakeNano();
    const mod = await load(native);
    await mod.onDeviceStatus();
    await mod.onDeviceStatus();
    expect(native.configure).toHaveBeenCalledTimes(1);
    expect(native.configure).toHaveBeenCalledWith({ apiKey: 'test-api-key', projectId: 'test-project', appId: '1:123:android:def' });
  });

  it.each([
    [{ availability: 'available', model: 'nano-v4-full' }, { availability: 'available', warm: false, detail: 'Model on this phone: nano-v4-full' }],
    [{ availability: 'downloadable' }, { availability: 'downloadable', detail: undefined }],
    [{ availability: 'downloading' }, { availability: 'downloading' }],
    [{ availability: 'unavailable', detail: 'AICore failed with error code 606-FEATURE_NOT_FOUND' }, { availability: 'unavailable', detail: 'AICore failed with error code 606-FEATURE_NOT_FOUND' }],
    [{ availability: 'something-new' }, { availability: 'unknown' }],
  ] as const)('maps native %j to %j', async (native, expected) => {
    const mod = await load(fakeNano(native as NativeStatus).native);
    expect(await mod.onDeviceStatus()).toMatchObject({ platform: 'android', apiExposed: true, ...expected });
  });

  it('reports unknown with the reason when the native check throws', async () => {
    const { native } = fakeNano();
    native.availability.mockRejectedValue(new Error('AICore service failed to bind'));
    const mod = await load(native);
    expect(await mod.onDeviceStatus()).toMatchObject({ apiExposed: true, availability: 'unknown', detail: 'AICore service failed to bind' });
  });
});

describe('Android bridge: why Gemini Nano cannot run (Firebase Test Lab, 2026-11-25)', () => {
  const pixel10 = '[ErrorCode 601] AICore failed with error type 4-CONNECTION_ERROR and error code 601-BINDING_FAILURE: AiCore service failed to bind to primary or fallback.';

  it('passes the reason and AICore code on, with plain English instead of the raw AICore text', async () => {
    const mod = await load(fakeNano({ availability: 'unavailable', reason: 'binding_failure', code: 601, detail: pixel10 }).native);
    const s = await mod.onDeviceStatus();
    expect(s).toEqual({
      platform: 'android', apiExposed: true, availability: 'unavailable', progress: undefined,
      reason: 'binding_failure', reasonCode: 601, detail: `${mod.REASON_TEXT.binding_failure} (error code 601)`,
    });
    expect(s.detail).toMatch(/could not connect to Android AICore.*reinstall Kalam/);
    expect(s.detail).not.toContain('CONNECTION_ERROR');
  });

  it.each([
    ['aicore_missing', /does not have Android AICore/],
    ['aicore_not_ready', /not finished setting up.*unlocked bootloader/],
    ['device_not_supported', /not offered on this phone/],
    ['needs_system_update', /newer version of Android/],
    ['low_storage', /not enough free storage/],
    ['battery_or_network_conditions', /battery.*internet connection/],
  ] as const)('explains %s in plain English', async (reason, text) => {
    const mod = await load(fakeNano({ availability: 'unavailable', reason }).native);
    const s = await mod.onDeviceStatus();
    expect(s).toMatchObject({ availability: 'unavailable', reason, detail: expect.stringMatching(text) });
    expect(s).not.toHaveProperty('reasonCode');
  });

  it('explains a downloadable model with its size and the Wi-Fi advice', async () => {
    const mod = await load(fakeNano({ availability: 'downloadable', reason: 'model_downloadable' }).native);
    expect(await mod.onDeviceStatus()).toMatchObject({ reason: 'model_downloadable', detail: expect.stringMatching(/a few GB.*Wi-Fi/) });
  });

  it('reads a reason this build does not know as unknown, and keeps what Android said', async () => {
    const mod = await load(fakeNano({ availability: 'unavailable', reason: 'brand_new_reason', code: 42, detail: 'AICore said no' }).native);
    expect(await mod.onDeviceStatus()).toMatchObject({
      reason: 'unknown', reasonCode: 42, detail: `${mod.REASON_TEXT.unknown} (error code 42) Android said: AICore said no`,
    });
  });

  it('gives no reason once the model is available', async () => {
    const mod = await load(fakeNano({ availability: 'available', model: 'nano-v4-full', reason: 'unknown' }).native);
    const s = await mod.onDeviceStatus();
    expect(s).toMatchObject({ availability: 'available', detail: 'Model on this phone: nano-v4-full' });
    expect(s).not.toHaveProperty('reason');
  });

  it('a failed download comes back with its reason', async () => {
    const { native } = fakeNano({ availability: 'downloadable', reason: 'model_downloadable' });
    native.prepare.mockResolvedValue({ availability: 'downloadable', reason: 'low_storage', code: 501, detail: 'Not enough storage' });
    const mod = await load(native);
    expect(await mod.prepareOnDevice()).toMatchObject({ availability: 'downloadable', reason: 'low_storage', reasonCode: 501 });
  });
});

describe('Android bridge: preparing the model (docs/07 §6.6)', () => {
  it('passes download progress as a fraction, removes its listener, then reports ready and warm', async () => {
    const { native, listeners, emit } = fakeNano();
    native.prepare.mockImplementation(async () => {
      emit({ bytesDownloaded: 0, bytesToDownload: 200 });
      emit({ bytesDownloaded: 100, bytesToDownload: 200 });
      emit({ bytesDownloaded: 150, bytesToDownload: null }); // size unknown: skipped
      emit({ bytesDownloaded: 200, bytesToDownload: 200 });
      return { availability: 'available' };
    });
    const mod = await load(native);
    const seen: number[] = [];
    const s = await mod.prepareOnDevice((p) => seen.push(p));
    expect(seen).toEqual([0, 0.5, 1]);
    expect(listeners.size).toBe(0);
    expect(s).toMatchObject({ availability: 'available', warm: true });
  });

  it('keeps the status and explains when the download fails', async () => {
    const { native, listeners } = fakeNano({ availability: 'downloadable' });
    native.prepare.mockRejectedValue(new Error('Download failed: no network'));
    const mod = await load(native);
    expect(await mod.prepareOnDevice()).toMatchObject({ availability: 'downloadable', detail: 'Download failed: no network' });
    expect(listeners.size).toBe(0);
  });

  it('warm-up loads an available model once, shares concurrent calls and never downloads', async () => {
    const { native } = fakeNano();
    const mod = await load(native);
    const [a, b] = await Promise.all([mod.warmUpOnDevice(), mod.warmUpOnDevice()]);
    expect(a).toMatchObject({ availability: 'available', warm: true });
    expect(b).toMatchObject({ warm: true });
    await mod.warmUpOnDevice();
    expect(native.warmUp).toHaveBeenCalledTimes(1);
    expect(native.prepare).not.toHaveBeenCalled();
  });

  it.each(['downloadable', 'downloading', 'unavailable'] as const)('warm-up does nothing while the model is %s', async (availability) => {
    const { native } = fakeNano({ availability });
    const mod = await load(native);
    expect((await mod.warmUpOnDevice()).availability).toBe(availability);
    expect(native.warmUp).not.toHaveBeenCalled();
    expect(native.prepare).not.toHaveBeenCalled();
  });
});

describe('Android bridge: Prompt API adapter for firebase/ai', () => {
  async function adapter(status?: NativeStatus) {
    const { native } = fakeNano(status);
    const mod = await load(native);
    const lm = mod.getLanguageModel() as unknown as {
      availability(o?: unknown): Promise<string>;
      create(o?: LanguageModelCreateOptions): Promise<{
        prompt(m: LanguageModelMessage[], o?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>;
      }>;
    };
    return { native, mod, lm };
  }

  it('is installed as globalThis.LanguageModel when the module loads', async () => {
    const { mod } = await adapter();
    expect(g.LanguageModel).toBeDefined();
    expect(mod.getLanguageModel()).toBe(g.LanguageModel);
  });

  it('replaces any other global LanguageModel, so firebase/ai only ever sees Kalam\'s adapter', async () => {
    const { native } = fakeNano();
    vi.resetModules();
    const foreign = { availability: async () => 'available', create: async () => ({ destroy() {} }) };
    g.LanguageModel = foreign;
    g.expo = { modules: { KalamNano: native } };
    const mod = await import('./on-device.native');
    expect(mod.getLanguageModel()).toBeDefined();
    expect(mod.getLanguageModel()).not.toBe(foreign);
    expect(g.LanguageModel).toBe(mod.getLanguageModel());
  });

  it('is available only for text when the phone model is ready', async () => {
    const { lm, mod } = await adapter();
    expect(await lm.availability(mod.TEXT_IO)).toBe('available');
    expect(await lm.availability({ expectedInputs: [{ type: 'text' }, { type: 'image' }] })).toBe('unavailable');
  });

  it.each([
    [['en'], 'available'], [['en-US'], 'available'], [['ko'], 'available'], [['hi'], 'unavailable'], [['kok'], 'unavailable'],
  ])('languages %j are %s (English and Korean are the validated on-device languages)', async (languages, expected) => {
    const { lm } = await adapter();
    const io = [{ type: 'text', languages }];
    expect(await lm.availability({ expectedInputs: io, expectedOutputs: io })).toBe(expected);
  });

  it.each(['downloadable', 'downloading', 'unavailable'] as const)('reports %s as unavailable, so the SDK never starts a download', async (a) => {
    const { lm } = await adapter({ availability: a });
    expect(await lm.availability()).toBe('unavailable');
  });

  it('reports unavailable when the native check throws, so PREFER_ON_DEVICE falls back to the cloud', async () => {
    const { lm, native } = await adapter();
    native.availability.mockRejectedValue(new Error('binder died'));
    expect(await lm.availability()).toBe('unavailable');
  });

  it('sends one single-turn prompt: system text, the request, then the JSON Schema', async () => {
    const { lm, native } = await adapter();
    const schema = { type: 'object', properties: { category: { enum: ['shopping', 'work'] } }, required: ['category'] };
    const session = await lm.create({ initialPrompts: [{ role: 'system', content: [{ type: 'text', value: 'Classify the note.' }] }] });
    const text = await session.prompt(userMessage('Buy milk tomorrow.'), { responseConstraint: schema });
    expect(text).toBe('{"category":"shopping"}');
    expect(native.generate).toHaveBeenCalledTimes(1);
    expect(native.generate.mock.calls[0]?.[1]).toEqual({
      prompt: `Classify the note.\n\nBuy milk tomorrow.\n\nReply with only one JSON value that matches this JSON Schema. No other text.\n${JSON.stringify(schema)}`,
    });
  });

  it('never passes off an answer that did not come from the device', async () => {
    const { lm, native } = await adapter();
    native.generate.mockResolvedValue({ text: '{}', source: 'cloud' as 'on_device' });
    const session = await lm.create();
    await expect(session.prompt(userMessage('x'))).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('cancels the native request on abort and rejects with AbortError', async () => {
    const { lm, native } = await adapter();
    native.generate.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const session = await lm.create();
    const pending = session.prompt(userMessage('x'), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const id = native.generate.mock.calls[0]?.[0];
    expect(native.cancel).toHaveBeenCalledWith(id);
  });

  it('does not call the model for an already aborted request', async () => {
    const { lm, native } = await adapter();
    const controller = new AbortController();
    controller.abort();
    const session = await lm.create({ signal: controller.signal });
    await expect(session.prompt(userMessage('x'))).rejects.toMatchObject({ name: 'AbortError' });
    expect(native.generate).not.toHaveBeenCalled();
  });

  it.each([
    ['ErrorCode.BACKGROUND_USE_BLOCKED', 'NotAllowedError', 'model_unavailable'],
    ['Request exceeds the 4000 token limit', 'QuotaExceededError', 'bad_request'],
    ['AICore failed with error code 7-BUSY', 'UnknownError', 'provider_error'],
  ])('maps the native failure %j to %s (Kalam code %s)', async (msg, name, code) => {
    const { lm, native } = await adapter();
    native.generate.mockRejectedValue(new Error(msg));
    const session = await lm.create();
    const error = await session.prompt(userMessage('x')).catch((e: unknown) => e);
    expect(error).toMatchObject({ name });
    expect(mapFirebaseError(error).code).toBe(code);
  });
});

describe('Android hybrid through the real firebase/ai router and the unchanged firebase-provider', () => {
  const schema = { type: 'object', properties: { category: { type: 'string' } }, required: ['category'] };
  const parse = (raw: unknown) => {
    const r = z.object({ category: z.string() }).strict().safeParse(raw);
    return r.success ? { success: true as const, data: r.data } : { success: false as const, error: r.error.message };
  };
  const req = (mode: StructuredRequest<unknown>['mode']): StructuredRequest<{ category: string }> => ({
    taskType: 'classify', system: 'Classify the note.', prompt: 'Buy milk tomorrow.', jsonSchema: schema, parse, mode,
    role: 'local_assistant', timeoutMs: 5_000,
  });

  async function provider(status?: NativeStatus) {
    const { native } = fakeNano(status);
    await load(native); // installs the adapter, as the app does at start-up
    const { createFirebaseProvider } = await import('./firebase-provider');
    return { native, firebase: createFirebaseProvider() };
  }

  it('ONLY_ON_DEVICE runs on the phone, with schema in the prompt and the Zod parse deciding', async () => {
    const cloud = vi.fn();
    vi.stubGlobal('fetch', cloud);
    const { native, firebase } = await provider();
    const res = await firebase.generateStructured(req('only_on_device'));
    expect(res).toMatchObject({ success: true, source: 'on_device', model: ON_DEVICE_MODEL, output: { category: 'shopping' }, fallbackUsed: false });
    const sent = native.generate.mock.calls[0]?.[1]?.prompt ?? '';
    expect(sent.startsWith('Classify the note.\n\nBuy milk tomorrow.\n\nReply with only one JSON value')).toBe(true);
    expect(cloud).not.toHaveBeenCalled();
  });

  it('rejects on-device output that fails the Zod parse instead of using it', async () => {
    const { native, firebase } = await provider();
    native.generate.mockResolvedValue({ text: '{"category":"shopping","extra":1}', source: 'on_device' });
    expect(await firebase.generateStructured(req('only_on_device'))).toMatchObject({ success: false, source: 'on_device', errorCode: 'invalid_output' });
  });

  it('PREFER_ON_DEVICE goes to the cloud when the phone model is not ready, and says so', async () => {
    const cloud = vi.fn(async () => new Response(
      JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '{"category":"work"}' }] }, finishReason: 'STOP' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', cloud);
    const { native, firebase } = await provider({ availability: 'downloadable' });
    const res = await firebase.generateStructured(req('prefer_on_device'));
    expect(res).toMatchObject({ success: true, source: 'cloud', output: { category: 'work' }, fallbackUsed: true });
    expect(native.generate).not.toHaveBeenCalled();
    expect(native.prepare).not.toHaveBeenCalled();
    expect(cloud).toHaveBeenCalledTimes(1);
  });
});
