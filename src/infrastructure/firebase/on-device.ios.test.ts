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
import type { AppleStatus, KalamAppleModule } from '../../../modules/kalam-apple';
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
    generate: vi.fn(async (_id: string, _o: { prompt: string }) => ({ text: '{"category":"shopping"}', source: 'on_device' as const })),
    cancel: vi.fn(() => true),
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
      platform: 'other', apiExposed: false, availability: 'unavailable', detail: expect.stringMatching(/kalam-apple.*Expo Go/),
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
    [{ availability: 'downloading', reason: 'modelNotReady' }, { availability: 'downloading', detail: expect.stringMatching(/getting its model ready/) }],
    [{ availability: 'unavailable', reason: 'osTooOld' }, { availability: 'unavailable', detail: expect.stringMatching(/iOS 26/) }],
    [{ availability: 'unavailable', reason: 'something-new' }, { availability: 'unavailable', detail: 'Apple Intelligence is not available right now.' }],
    [{ availability: 'something-new' }, { availability: 'unknown' }],
  ] as const)('maps native %j to %j', async (native, expected) => {
    const mod = await load(fakeApple(native as AppleStatus));
    expect(await mod.onDeviceStatus()).toMatchObject({ platform: 'other', apiExposed: true, ...expected });
  });

  it('reports unknown with the reason when the native check throws', async () => {
    const native = fakeApple();
    native.availability.mockRejectedValue(new Error('model service crashed'));
    const mod = await load(native);
    expect(await mod.onDeviceStatus()).toMatchObject({ apiExposed: true, availability: 'unknown', detail: 'model service crashed' });
  });

  it('prepare and warm-up only report: iOS downloads the model itself and Kalam claims no warm state', async () => {
    const mod = await load(fakeApple({ availability: 'downloading', reason: 'modelNotReady' }));
    expect(await mod.prepareOnDevice()).toMatchObject({ availability: 'downloading' });
    const warm = await mod.warmUpOnDevice();
    expect(warm.availability).toBe('downloading');
    expect(warm).not.toHaveProperty('warm');
  });

  it('labels answers with the name Firebase AI Logic gives Apple\'s model, not Gemini Nano', async () => {
    const mod = await load(fakeApple());
    expect(mod.ON_DEVICE_MODEL_NAME).toBe('apple-foundation-models-system-language-model');
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

  it.each(['downloading', 'unavailable'] as const)('reports %s as unavailable, so PREFER_ON_DEVICE uses the cloud', async (a) => {
    const { lm } = await adapter({ availability: a });
    expect(await lm.availability()).toBe('unavailable');
  });

  it('sends one single-turn prompt: system text, the request, then the JSON Schema', async () => {
    const { lm, native } = await adapter();
    const schema = { type: 'object', properties: { category: { enum: ['shopping', 'work'] } }, required: ['category'] };
    const session = await lm.create({ initialPrompts: [{ role: 'system', content: [{ type: 'text', value: 'Classify the note.' }] }] });
    expect(await session.prompt(userMessage('Buy milk tomorrow.'), { responseConstraint: schema })).toBe('{"category":"shopping"}');
    expect(native.generate.mock.calls[0]?.[0]).toMatch(/^apple-/);
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
      success: true, source: 'on_device', output: { category: 'shopping' }, fallbackUsed: false,
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
