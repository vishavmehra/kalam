/**
 * iOS on-device bridge (docs/17 §3.2). The kalam-apple native module is a fake on globalThis.expo.modules,
 * where Expo installs the real one; Metro picks on-device.ios.ts over on-device.native.ts on iOS. The last
 * block drives the real firebase/ai esm build through Kalam's unchanged firebase-provider.
 * NOT proof that Apple's model runs on an iPhone: that needs a device build (modules/kalam-apple/README.md).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { LanguageModelCreateOptions, LanguageModelMessage } from 'firebase/ai';
import type { StructuredRequest } from '@/core/contracts';
import type { AppleGenerateOptions, AppleStatus, KalamAppleModule } from '../../../modules/kalam-apple';
import { mapFirebaseError } from './errors';

const esm = vi.hoisted(() => ({
  ai: new URL('../../../node_modules/@firebase/ai/dist/esm/index.esm.js', import.meta.url).href,
}));
// Vitest would load firebase/ai's Node build, which has no on-device path. iOS gets the esm build.
vi.mock('firebase/ai', async () => import(/* @vite-ignore */ esm.ai));
// firebase-provider imports './on-device'; on iOS Metro resolves that to on-device.ios.ts.
vi.mock('./on-device', async () => import('./on-device.ios'));

type G = { expo?: unknown; LanguageModel?: unknown };
const g = globalThis as G;

const AVAILABLE: AppleStatus = { availability: 'available', languages: ['en', 'es', 'ja', 'fr'] };

function fakeApple(status: AppleStatus = AVAILABLE) {
  return {
    availability: vi.fn(async (): Promise<AppleStatus> => status),
    generate: vi.fn(async (_id: string, _o: AppleGenerateOptions) => ({ text: '{"category":"shopping"}', source: 'on_device' as const })),
    cancel: vi.fn(() => true),
    supportsOnDeviceSpeech: vi.fn(() => false),
    installAppAttest: vi.fn(),
    getAppCheckToken: vi.fn(async () => ({ token: 't', expireTimeMillis: 0 })),
  };
}

async function load(native?: KalamAppleModule) {
  vi.resetModules();
  delete g.LanguageModel;
  if (native) g.expo = { modules: { KalamApple: native } };
  else delete g.expo;
  return import('./on-device.ios');
}

const userMessage = (text: string): LanguageModelMessage[] => [{ role: 'user', content: [{ type: 'text', value: text }] }];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete g.LanguageModel;
  delete g.expo;
});

describe('iOS bridge: no native module (Expo Go, unit tests)', () => {
  it('reports unavailable with the reason and installs no adapter, so requests go to the cloud', async () => {
    const mod = await load();
    expect(await mod.onDeviceStatus()).toEqual({
      platform: 'ios', apiExposed: false, availability: 'unavailable', detail: expect.stringMatching(/kalam-apple.*Expo Go/),
    });
    expect(mod.getLanguageModel()).toBeUndefined();
    expect(g.LanguageModel).toBeUndefined();
    expect((await mod.prepareOnDevice()).availability).toBe('unavailable');
    expect((await mod.warmUpOnDevice()).availability).toBe('unavailable');
  });

  it('never loads the Android module on iOS', async () => {
    g.expo = { modules: { KalamNano: { availability: vi.fn() } } };
    vi.resetModules();
    const mod = await import('./on-device.ios');
    expect(mod.getLanguageModel()).toBeUndefined();
    expect((await mod.onDeviceStatus()).detail).toMatch(/kalam-apple/);
  });
});

describe('iOS bridge: availability mapping', () => {
  it.each([
    [AVAILABLE, { availability: 'available', detail: undefined }],
    [{ availability: 'unavailable', reason: 'deviceNotEligible' }, { availability: 'unavailable', detail: expect.stringMatching(/cannot run Apple Intelligence/) }],
    [{ availability: 'unavailable', reason: 'appleIntelligenceNotEnabled' }, { availability: 'unavailable', detail: expect.stringMatching(/Apple Intelligence is off/) }],
    // Apple's modelNotReady does not say a download is running, so it is never reported as downloading.
    [{ availability: 'unavailable', reason: 'modelNotReady' }, { availability: 'unavailable', detail: expect.stringMatching(/not ready on this device yet/) }],
    [{ availability: 'unavailable', reason: 'osTooOld' }, { availability: 'unavailable', detail: expect.stringMatching(/iOS 26/) }],
    [{ availability: 'unavailable', reason: 'something-new' }, { availability: 'unavailable', detail: 'Apple Intelligence is not available right now.' }],
    [{ availability: 'unavailable', reason: 'constructor' }, { availability: 'unavailable', detail: 'Apple Intelligence is not available right now.' }],
    // A simulator whose Mac has no Apple Intelligence (GitHub macOS runner, run 45615319769).
    [{ availability: 'unavailable', reason: 'simulatorNoModel' }, { availability: 'unavailable', detail: expect.stringMatching(/simulator has no working Apple Intelligence/) }],
    // Anything but Apple's own "available" is unavailable with a reason, never "ready" and never "unknown".
    [{ availability: 'downloading' }, { availability: 'unavailable', detail: 'Apple Intelligence is not available right now.' }],
    [{ availability: 'Available' }, { availability: 'unavailable' }],
  ] as const)('maps native %j to %j', async (native, expected) => {
    const mod = await load(fakeApple(native as AppleStatus));
    expect(await mod.onDeviceStatus()).toMatchObject({ platform: 'ios', apiExposed: true, ...expected });
  });

  it('reports unavailable with the reason when the native check throws', async () => {
    const native = fakeApple();
    native.availability.mockRejectedValue(new Error('model service crashed'));
    const mod = await load(native);
    expect(await mod.onDeviceStatus()).toMatchObject({
      platform: 'ios', apiExposed: true, availability: 'unavailable', detail: 'Apple Intelligence is not available right now. model service crashed',
    });
  });

  it('always names the platform ios, so Settings never shows "other"', async () => {
    for (const status of [AVAILABLE, { availability: 'unavailable', reason: 'deviceNotEligible' }] as AppleStatus[]) {
      const mod = await load(fakeApple(status));
      expect((await mod.onDeviceStatus()).platform).toBe('ios');
    }
    expect((await (await load()).onDeviceStatus()).platform).toBe('ios');
  });

  it('prepare and warm-up only report: iOS downloads the model itself and Kalam claims no warm state', async () => {
    const native = fakeApple({ availability: 'unavailable', reason: 'modelNotReady' });
    const mod = await load(native);
    expect(await mod.prepareOnDevice()).toMatchObject({ availability: 'unavailable' });
    const warm = await mod.warmUpOnDevice();
    expect(warm.availability).toBe('unavailable');
    expect(warm).not.toHaveProperty('warm');
    expect(native.generate).not.toHaveBeenCalled();
  });
});

describe('iOS bridge: Prompt API adapter for firebase/ai', () => {
  async function adapter(status?: AppleStatus) {
    const native = fakeApple(status);
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

  it('is available only for text when Apple\'s model is ready', async () => {
    const { lm, mod } = await adapter();
    expect(await lm.availability(mod.TEXT_IO)).toBe('available');
    expect(await lm.availability({ expectedInputs: [{ type: 'text' }, { type: 'image' }] })).toBe('unavailable');
  });

  it.each([
    [['en'], 'available'], [['en-GB', 'ja'], 'available'], [['hi'], 'unavailable'],
  ])('languages %j are %s, following the model\'s supported languages', async (languages, expected) => {
    const { lm } = await adapter();
    const io = [{ type: 'text', languages }];
    expect(await lm.availability({ expectedInputs: io, expectedOutputs: io })).toBe(expected);
  });

  it('claims no language when the model lists none', async () => {
    const { lm, mod } = await adapter({ availability: 'available', languages: [] });
    expect(await lm.availability(mod.TEXT_IO)).toBe('unavailable');
  });

  it('reports a model that is not ready as unavailable, so PREFER_ON_DEVICE uses the cloud', async () => {
    const { lm } = await adapter({ availability: 'unavailable', reason: 'modelNotReady' });
    expect(await lm.availability()).toBe('unavailable');
  });

  it('keeps the system instructions apart from the request and its JSON Schema', async () => {
    const { lm, native } = await adapter();
    const schema = { type: 'object', properties: { category: { enum: ['shopping', 'work'] } }, required: ['category'] };
    const session = await lm.create({ initialPrompts: [{ role: 'system', content: [{ type: 'text', value: 'Classify the note.' }] }] });
    expect(await session.prompt(userMessage('Buy milk tomorrow.'), { responseConstraint: schema })).toBe('{"category":"shopping"}');
    expect(native.generate.mock.calls[0]?.[0]).toMatch(/^apple-/);
    expect(native.generate.mock.calls[0]?.[1]).toEqual({
      instructions: 'Classify the note.',
      prompt: `Buy milk tomorrow.\n\nReply with only one JSON value that matches this JSON Schema. No other text.\n${JSON.stringify(schema)}`,
    });
  });

  it('sends no instructions field when there is no system text', async () => {
    const { lm, native } = await adapter();
    await (await lm.create()).prompt(userMessage('Buy milk tomorrow.'));
    expect(native.generate.mock.calls[0]?.[1]).toEqual({ prompt: 'Buy milk tomorrow.' });
  });

  it('refuses a request with a part that is not text, instead of answering from the text alone', async () => {
    const { lm, native } = await adapter();
    const session = await lm.create();
    const withImage = [{ role: 'user', content: [{ type: 'text', value: 'What is this?' }, { type: 'image', value: {} }] }] as unknown as LanguageModelMessage[];
    await expect(session.prompt(withImage)).rejects.toMatchObject({ name: 'NotSupportedError' });
    expect(native.generate).not.toHaveBeenCalled();
  });

  it('refuses a request too long for Apple\'s context window before the device runs it', async () => {
    const { lm, native } = await adapter();
    const session = await lm.create({ initialPrompts: [{ role: 'system', content: [{ type: 'text', value: 'Classify the note.' }] }] });
    const error = await session.prompt(userMessage('x'.repeat(9_000))).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'QuotaExceededError' });
    expect(mapFirebaseError(error).code).toBe('bad_request');
    expect(native.generate).not.toHaveBeenCalled();
    await session.prompt(userMessage('x'.repeat(8_000)));
    expect(native.generate).toHaveBeenCalledTimes(1);
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
    expect(native.cancel).toHaveBeenCalledWith(native.generate.mock.calls[0]?.[0]);
  });

  it.each([
    ['ERR_APPLE_NOT_SUPPORTED', 'NotSupportedError', 'model_unavailable'],
    ['ERR_APPLE_NOT_ALLOWED', 'NotAllowedError', 'model_unavailable'],
    ['ERR_APPLE_TOO_LARGE', 'QuotaExceededError', 'bad_request'],
    ['ERR_APPLE_FAILED', 'UnknownError', 'provider_error'],
  ])('maps the Swift error code %s to %s (Kalam code %s)', async (code, name, kalam) => {
    const { lm, native } = await adapter();
    native.generate.mockRejectedValue(Object.assign(new Error('native failure'), { code }));
    const session = await lm.create();
    const error = await session.prompt(userMessage('x')).catch((e: unknown) => e);
    expect(error).toMatchObject({ name, message: 'native failure' });
    expect(mapFirebaseError(error).code).toBe(kalam);
  });
});

describe('iOS hybrid through the real firebase/ai router and the unchanged firebase-provider', () => {
  const schema = { type: 'object', properties: { category: { type: 'string' } }, required: ['category'] };
  const parse = (raw: unknown) => {
    const r = z.object({ category: z.string() }).strict().safeParse(raw);
    return r.success ? { success: true as const, data: r.data } : { success: false as const, error: r.error.message };
  };
  const req = (mode: StructuredRequest<unknown>['mode']): StructuredRequest<{ category: string }> => ({
    taskType: 'classify', system: 'Classify the note.', prompt: 'Buy milk tomorrow.', jsonSchema: schema, parse, mode,
    role: 'local_assistant', timeoutMs: 5_000,
  });
  const cloudReply = () => vi.fn(async () => new Response(
    JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '{"category":"work"}' }] }, finishReason: 'STOP' }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));

  /** A fresh bridge wired into a fresh provider: vi.doMock so the provider never sees an earlier test's bridge. */
  async function provider(native: ReturnType<typeof fakeApple> | null = fakeApple()) {
    vi.stubEnv('EXPO_PUBLIC_FIREBASE_API_KEY', 'test-api-key');
    vi.stubEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'test-project');
    vi.stubEnv('EXPO_PUBLIC_FIREBASE_APP_ID', '1:123:web:abc');
    const bridge = await load(native ?? undefined); // installs the adapter, as the app does at start-up
    vi.doMock('./on-device', () => bridge);
    const { createFirebaseProvider } = await import('./firebase-provider');
    return { native, firebase: createFirebaseProvider() };
  }

  it('ONLY_ON_DEVICE runs on the iPhone and is labelled on_device; the Zod parse decides', async () => {
    const cloud = vi.fn();
    vi.stubGlobal('fetch', cloud);
    const { native, firebase } = await provider();
    expect(await firebase.generateStructured(req('only_on_device'))).toMatchObject({
      success: true, source: 'on_device', model: 'apple-foundation-models-system-language-model', output: { category: 'shopping' }, fallbackUsed: false,
    });
    expect(native?.generate).toHaveBeenCalledTimes(1);
    expect(cloud).not.toHaveBeenCalled();
  });

  it('PREFER_ON_DEVICE with Apple Intelligence off goes to the cloud once and is labelled cloud', async () => {
    const cloud = cloudReply();
    vi.stubGlobal('fetch', cloud);
    const { native, firebase } = await provider(fakeApple({ availability: 'unavailable', reason: 'appleIntelligenceNotEnabled' }));
    expect(await firebase.generateStructured(req('prefer_on_device'))).toMatchObject({
      success: true, source: 'cloud', output: { category: 'work' }, fallbackUsed: true,
    });
    expect(native?.generate).not.toHaveBeenCalled();
    expect(cloud).toHaveBeenCalledTimes(1);
  });

  it('ONLY_ON_DEVICE with Apple Intelligence off fails on the device and never calls the cloud', async () => {
    const cloud = vi.fn();
    vi.stubGlobal('fetch', cloud);
    const { native, firebase } = await provider(fakeApple({ availability: 'unavailable', reason: 'appleIntelligenceNotEnabled' }));
    expect(await firebase.generateStructured(req('only_on_device'))).toMatchObject({ success: false, source: 'on_device', errorCode: 'model_unavailable' });
    expect(native?.generate).not.toHaveBeenCalled();
    expect(cloud).not.toHaveBeenCalled();
  });

  it('without the native module, ONLY_ON_DEVICE fails as unavailable instead of calling the cloud', async () => {
    const cloud = vi.fn();
    vi.stubGlobal('fetch', cloud);
    const { firebase } = await provider(null);
    expect(await firebase.generateStructured(req('only_on_device'))).toMatchObject({
      success: false, errorCode: 'model_unavailable',
    });
    expect(cloud).not.toHaveBeenCalled();
  });
});
