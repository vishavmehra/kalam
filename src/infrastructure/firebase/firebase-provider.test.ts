/**
 * Firebase AI Logic provider tests (docs/17 §13.1, FAI-06/07). The SDK entry points `getAI` and
 * `getGenerativeModel` are mocked; constants, backend classes and `AIError` are the real ones from
 * firebase@13.4, so mode strings, thinking levels and error shapes cannot drift from the SDK.
 * These tests prove Kalam's wiring and policy. They are NOT proof of real model execution: the real
 * cloud and Nano runs are recorded in docs and scripts/verify-*.mjs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentPlatformBackend, AIError, AIErrorCode as SdkErrorCode, GoogleAIBackend, InferenceMode, ThinkingLevel,
} from 'firebase/ai';
import { z } from 'zod';
import { modelForRole, ON_DEVICE_MODEL } from '@/core/ai/model-config';
import { applyRemoteConfig, resetRemoteConfig } from '@/core/ai/remote-config';
import type { AIImage, InferenceMode as KalamMode, StructuredRequest } from '@/core/contracts';
import { PROMPT_API_LANGUAGES, textIO } from './prompt-io';

const h = vi.hoisted(() => ({
  generateContent: vi.fn(),
  getGenerativeModel: vi.fn(),
  getAI: vi.fn(),
  appCheckReady: vi.fn(),
  onDeviceStatus: vi.fn(),
  world: { app: undefined as object | undefined, languageModel: undefined as object | undefined },
}));

vi.mock('firebase/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/ai')>();
  return {
    ...actual,
    getAI: (...args: unknown[]) => { h.getAI(...args); return { fakeAi: true }; },
    getGenerativeModel: (...args: unknown[]) => {
      h.getGenerativeModel(...args);
      return { generateContent: h.generateContent };
    },
  };
});
vi.mock('./app', () => ({
  getFirebaseApp: () => h.world.app,
  isFirebaseConfigured: () => h.world.app !== undefined,
  appCheckReady: (ms: number) => h.appCheckReady(ms),
}));
vi.mock('./on-device', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./on-device')>()),
  getLanguageModel: () => h.world.languageModel,
  onDeviceStatus: () => h.onDeviceStatus(),
}));

const { createFirebaseProvider } = await import('./firebase-provider');
const onDeviceModule = await import('./on-device');

// ─── Helpers ──────────────────────────────────────────────────────────────────
type Answer = { answer: string };
const answerSchema = z.object({ answer: z.string() }).strict();
const schema = {
  type: 'object',
  properties: { answer: { type: 'string' }, tags: { type: 'array', maxItems: 3, items: { type: 'string' } } },
  required: ['answer'],
};
const req = (over: Partial<StructuredRequest<Answer>> = {}): StructuredRequest<Answer> => ({
  taskType: 'create_app', system: 'You build apps.', prompt: 'A notes app', jsonSchema: schema, mode: 'only_in_cloud',
  parse: (raw) => {
    const r = answerSchema.safeParse(raw);
    return r.success ? { success: true, data: r.data } : { success: false, error: r.error.issues.map((i) => i.message).join('; ') };
  },
  ...over,
});
const reply = (text: string, inferenceSource: 'in_cloud' | 'on_device' = 'in_cloud') =>
  ({ response: { inferenceSource, text: () => text } });
const ok = reply('{"answer":"yes"}');
const never = () => new Promise<never>(() => {});

/** A duck-typed HTTP failure, as `makeRequest()` raises it. */
const httpError = (status: number) =>
  Object.assign(new Error(`[${status}] Request contains an invalid argument.`), { name: 'FirebaseError', code: 'fetch-error', customErrorData: { status } });
/** A real SDK AIError. */
const fetchError = (status: number, message: string) => new AIError(SdkErrorCode.FETCH_ERROR, message, { status });

type CloudParams = { model: string; systemInstruction?: string; generationConfig: Record<string, unknown> };
type DeviceParams = {
  createOptions: { expectedInputs?: unknown[]; expectedOutputs?: unknown[]; initialPrompts?: unknown[]; signal?: AbortSignal };
  promptOptions: { responseConstraint?: unknown; signal?: AbortSignal };
};
type ModelParams = { mode: string; inCloudParams: CloudParams; onDeviceParams: DeviceParams };
const modelParams = (call = 0) => h.getGenerativeModel.mock.calls[call]?.[1] as ModelParams;
const cloudParams = (call = 0) => modelParams(call).inCloudParams;
const sentParts = (call = 0) => h.generateContent.mock.calls[call]?.[0] as unknown[];
const sentOptions = (call = 0) => h.generateContent.mock.calls[call]?.[1] as { signal: AbortSignal; timeout: number };

const run = (over: Partial<StructuredRequest<Answer>> = {}) => createFirebaseProvider().generateStructured(req(over));

beforeEach(() => {
  h.generateContent.mockReset();
  h.getGenerativeModel.mockReset();
  h.getAI.mockReset();
  h.appCheckReady.mockReset().mockResolvedValue(true);
  h.onDeviceStatus.mockReset().mockResolvedValue({ platform: 'web', apiExposed: true, availability: 'available' });
  h.world.app = {};
  h.world.languageModel = undefined;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── Cloud response schema (existing coverage) ────────────────────────────────
describe('firebase provider: cloud response schema', () => {
  it('sends the cloud an ordered schema without array bounds, and Nano the original', async () => {
    h.generateContent.mockResolvedValueOnce(ok);
    const res = await run();
    expect(res).toMatchObject({ success: true, output: { answer: 'yes' }, source: 'cloud', provider: 'firebase' });
    const sent = JSON.stringify(cloudParams(0).generationConfig.responseJsonSchema);
    expect(sent).toContain('"tags"');
    expect(sent).not.toContain('maxItems');
    expect(cloudParams(0).generationConfig.responseJsonSchema).toMatchObject({ propertyOrdering: ['answer', 'tags'] });
    expect(JSON.stringify(modelParams(0).onDeviceParams.promptOptions.responseConstraint)).toContain('maxItems');
  });

  it('retries once without constrained decoding when the service rejects the request (400)', async () => {
    h.generateContent.mockRejectedValueOnce(httpError(400)).mockResolvedValueOnce(ok);
    const res = await run();
    expect(res).toMatchObject({ success: true, output: { answer: 'yes' } });
    expect(h.generateContent).toHaveBeenCalledTimes(2);
    expect(cloudParams(0).generationConfig.responseJsonSchema).toBeDefined();
    expect(cloudParams(1).generationConfig.responseJsonSchema).toBeUndefined();
    expect(cloudParams(1).generationConfig.responseMimeType).toBe('application/json');
    expect(cloudParams(1).systemInstruction).toMatch(/^You build apps\.\n\nReply with one JSON value that matches this JSON Schema:\n\{/);
  });

  it('reports bad_request (not retried again) when the schema-less attempt is rejected too', async () => {
    h.generateContent.mockRejectedValue(httpError(400));
    const res = await run();
    expect(res).toMatchObject({ success: false, errorCode: 'bad_request' });
    expect(h.generateContent).toHaveBeenCalledTimes(2);
  });

  it('does not use the fallback for other failures', async () => {
    h.generateContent.mockRejectedValueOnce(httpError(503));
    const res = await run();
    expect(res).toMatchObject({ success: false, errorCode: 'provider_error' });
    expect(h.generateContent).toHaveBeenCalledTimes(1);
  });

  it('does not retry an on-device request that was rejected with 400', async () => {
    h.world.languageModel = {};
    h.generateContent.mockRejectedValue(httpError(400));
    const res = await run({ mode: 'only_on_device' });
    expect(res).toMatchObject({ success: false, errorCode: 'bad_request', source: 'on_device' });
    expect(h.generateContent).toHaveBeenCalledTimes(1);
  });
});

// ─── Hybrid adapter invocation and mode mapping ───────────────────────────────
describe('firebase provider: hybrid adapter invocation', () => {
  it('identifies itself and exposes the on-device hooks from the on-device module', () => {
    const provider = createFirebaseProvider();
    expect(provider.name).toBe('firebase');
    expect(provider.isConfigured()).toBe(true);
    h.world.app = undefined;
    expect(provider.isConfigured()).toBe(false);
    expect(provider.prepareOnDevice).toBe(onDeviceModule.prepareOnDevice);
    expect(provider.warmUpOnDevice).toBe(onDeviceModule.warmUpOnDevice);
  });

  it.each([
    ['only_on_device', InferenceMode.ONLY_ON_DEVICE],
    ['prefer_on_device', InferenceMode.PREFER_ON_DEVICE],
    ['only_in_cloud', InferenceMode.ONLY_IN_CLOUD],
    ['prefer_in_cloud', InferenceMode.PREFER_IN_CLOUD],
  ] as const)('maps Kalam mode %s to the SDK InferenceMode %s', async (mode, sdkMode) => {
    h.world.languageModel = {};
    h.generateContent.mockResolvedValueOnce(reply('{"answer":"yes"}', mode.includes('on_device') ? 'on_device' : 'in_cloud'));
    const res = await run({ mode });
    expect(res.success).toBe(true);
    expect(modelParams().mode).toBe(sdkMode);
    expect(h.getGenerativeModel).toHaveBeenCalledTimes(1);
    expect(h.generateContent).toHaveBeenCalledTimes(1);
  });

  it('passes the AI instance from getAI(app) and the text prompt as the first part', async () => {
    h.generateContent.mockResolvedValueOnce(ok);
    await run();
    expect(h.getAI).toHaveBeenCalledTimes(1);
    expect(h.getAI.mock.calls[0]?.[0]).toBe(h.world.app);
    expect(h.getGenerativeModel.mock.calls[0]?.[0]).toEqual({ fakeAi: true });
    expect(sentParts()).toEqual([{ type: 'text', text: 'A notes app' }]);
  });

  it('creates the AI instance once per provider and reuses it', async () => {
    h.generateContent.mockResolvedValue(ok);
    const provider = createFirebaseProvider();
    await provider.generateStructured(req());
    await provider.generateStructured(req());
    expect(h.getAI).toHaveBeenCalledTimes(1);
    expect(h.getGenerativeModel).toHaveBeenCalledTimes(2);
  });

  it('resolves the cloud model from the task role and uses the configured instruction', async () => {
    h.generateContent.mockResolvedValue(ok);
    await run();
    await run({ role: 'safety' });
    expect(cloudParams(0).model).toBe(modelForRole('compiler'));
    expect(cloudParams(1).model).toBe(modelForRole('safety'));
    expect(cloudParams(0).systemInstruction).toBe('You build apps.');
  });

  it('keeps instructions apart from user content on-device (system initial prompt, no systemInstruction)', async () => {
    h.world.languageModel = {};
    h.generateContent.mockResolvedValueOnce(reply('{"answer":"yes"}', 'on_device'));
    await run({ mode: 'prefer_on_device' });
    const { createOptions } = modelParams().onDeviceParams;
    expect(createOptions.initialPrompts).toEqual([{ role: 'system', content: [{ type: 'text', value: 'You build apps.' }] }]);
    expect(createOptions.expectedInputs).toEqual([{ type: 'text', languages: ['en'] }]);
    expect(createOptions.expectedOutputs).toEqual([{ type: 'text', languages: ['en'] }]);
    h.getGenerativeModel.mockClear();
    h.generateContent.mockResolvedValueOnce(reply('{"answer":"yes"}', 'on_device'));
    await run({ mode: 'prefer_on_device', system: undefined });
    expect(modelParams().onDeviceParams.createOptions.initialPrompts).toBeUndefined();
  });
});

// ─── Inference source reporting ───────────────────────────────────────────────
describe('firebase provider: inference source comes from the response', () => {
  it.each([
    ['prefer_on_device', true, 'on_device', 'on_device', false],
    ['prefer_on_device', true, 'in_cloud', 'cloud', true],
    ['prefer_on_device', false, 'in_cloud', 'cloud', true],
    ['only_on_device', true, 'on_device', 'on_device', false],
    ['only_in_cloud', false, 'in_cloud', 'cloud', false],
    ['prefer_in_cloud', true, 'in_cloud', 'cloud', false],
    ['prefer_in_cloud', true, 'on_device', 'on_device', true],
    // The mode is a request, not a promise: whatever the SDK says it did is what we report.
    ['only_in_cloud', false, 'on_device', 'on_device', true],
  ] as const)('%s (Nano present: %s), SDK says %s, reports source %s, fallbackUsed %s', async (mode, nano, sdkSource, source, fallbackUsed) => {
    h.world.languageModel = nano ? {} : undefined;
    h.generateContent.mockResolvedValueOnce(reply('{"answer":"yes"}', sdkSource));
    const res = await run({ mode: mode as KalamMode });
    expect(res).toMatchObject({
      success: true, provider: 'firebase', source, fallbackUsed,
      model: source === 'on_device' ? ON_DEVICE_MODEL : modelForRole('compiler'),
    });
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('does not report on-device just because Nano exists and the mode prefers it', async () => {
    h.world.languageModel = {};
    h.generateContent.mockResolvedValueOnce(reply('{"answer":"yes"}', 'in_cloud'));
    expect(await run({ mode: 'prefer_on_device' })).toMatchObject({ source: 'cloud', fallbackUsed: true });
  });
});

// ─── Output parsing and validation ────────────────────────────────────────────
describe('firebase provider: output handling', () => {
  it('parses the JSON text and hands the object to req.parse', async () => {
    const parse = vi.fn((raw: unknown) => ({ success: true as const, data: raw as Answer }));
    h.generateContent.mockResolvedValueOnce(reply('{"answer":"hello","extra":1}'));
    const res = await run({ parse });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledWith({ answer: 'hello', extra: 1 });
    expect(res).toMatchObject({ success: true, output: { answer: 'hello', extra: 1 } });
  });

  it('accepts JSON wrapped in a markdown code fence', async () => {
    h.generateContent.mockResolvedValueOnce(reply('```json\n{"answer":"fenced"}\n```'));
    expect(await run()).toMatchObject({ success: true, output: { answer: 'fenced' } });
  });

  it('rejects text that is not JSON with invalid_output, without calling req.parse', async () => {
    const parse = vi.fn();
    h.generateContent.mockResolvedValueOnce(reply('Sure! Here is your app.'));
    const res = await run({ parse: parse as unknown as StructuredRequest<Answer>['parse'] });
    expect(res).toMatchObject({ success: false, errorCode: 'invalid_output', source: 'cloud', model: modelForRole('compiler') });
    expect(res.output).toBeUndefined();
    expect(parse).not.toHaveBeenCalled();
  });

  it('rejects an empty reply as invalid_output', async () => {
    h.generateContent.mockResolvedValueOnce(reply(''));
    expect(await run()).toMatchObject({ success: false, errorCode: 'invalid_output' });
  });

  it('rejects valid JSON that fails the Zod parser, with the validation message', async () => {
    h.generateContent.mockResolvedValueOnce(reply('{"answer":42}'));
    const res = await run();
    expect(res).toMatchObject({ success: false, errorCode: 'invalid_output' });
    expect(res.errorMessage).toMatch(/failed validation/i);
    expect(res.output).toBeUndefined();
  });

  it('rejects unknown properties when the request parser is strict', async () => {
    h.generateContent.mockResolvedValueOnce(reply('{"answer":"ok","script":"alert(1)"}'));
    expect(await run()).toMatchObject({ success: false, errorCode: 'invalid_output' });
  });

  it('reports the on-device source and model on an invalid on-device answer', async () => {
    h.world.languageModel = {};
    h.generateContent.mockResolvedValueOnce(reply('not json', 'on_device'));
    expect(await run({ mode: 'only_on_device' })).toMatchObject({
      success: false, errorCode: 'invalid_output', source: 'on_device', model: ON_DEVICE_MODEL,
    });
  });

  it('does not retry invalid output (no hidden second call)', async () => {
    h.generateContent.mockResolvedValue(reply('nope'));
    await run();
    expect(h.generateContent).toHaveBeenCalledTimes(1);
  });
});

// ─── Cloud generation settings ────────────────────────────────────────────────
describe('firebase provider: cloud generation settings', () => {
  it('uses thinking level LOW for every role (MINIMAL is rejected by gemini-3.8-flash)', async () => {
    h.generateContent.mockResolvedValue(ok);
    for (const role of ['compiler', 'repair', 'judge', 'safety', 'local_assistant', 'edit', 'voice', 'ai_block', 'translation'] as const) {
      h.getGenerativeModel.mockClear();
      await run({ role });
      const { thinkingConfig } = cloudParams().generationConfig as { thinkingConfig: { thinkingLevel: string } };
      expect(thinkingConfig).toEqual({ thinkingLevel: ThinkingLevel.LOW });
      expect(thinkingConfig.thinkingLevel).not.toBe(ThinkingLevel.MINIMAL);
    }
  });

  it('asks for JSON output', async () => {
    h.generateContent.mockResolvedValueOnce(ok);
    await run();
    expect(cloudParams().generationConfig.responseMimeType).toBe('application/json');
  });

  it('raises a small maxOutputTokens to the floor so thinking tokens cannot truncate the JSON', async () => {
    h.generateContent.mockResolvedValue(ok);
    await run({ maxOutputTokens: 256 });
    await run({ maxOutputTokens: 8000 });
    await run();
    expect(cloudParams(0).generationConfig.maxOutputTokens).toBe(2048);
    expect(cloudParams(1).generationConfig.maxOutputTokens).toBe(8000);
    expect(cloudParams(2).generationConfig.maxOutputTokens).toBeUndefined();
  });

  it('forwards temperature only when the caller sets one', async () => {
    h.generateContent.mockResolvedValue(ok);
    await run({ temperature: 0.2 });
    await run();
    expect(cloudParams(0).generationConfig.temperature).toBe(0.2);
    expect(cloudParams(1).generationConfig).not.toHaveProperty('temperature');
  });
});

// ─── Backend selection ────────────────────────────────────────────────────────
describe('firebase provider: backend switch (EXPO_PUBLIC_AI_BACKEND)', () => {
  const backendUsed = () => (h.getAI.mock.calls[0]?.[1] as { backend: unknown }).backend;

  it('uses the Agent Platform backend with the configured location', async () => {
    vi.stubEnv('EXPO_PUBLIC_AI_BACKEND', 'agent_platform');
    vi.stubEnv('EXPO_PUBLIC_AI_LOCATION', 'global');
    h.generateContent.mockResolvedValueOnce(ok);
    await run();
    expect(backendUsed()).toBeInstanceOf(AgentPlatformBackend);
    expect((backendUsed() as AgentPlatformBackend).location).toBe('global');
  });

  it('honours another Agent Platform location', async () => {
    vi.stubEnv('EXPO_PUBLIC_AI_BACKEND', 'agent_platform');
    vi.stubEnv('EXPO_PUBLIC_AI_LOCATION', 'us-central1');
    h.generateContent.mockResolvedValueOnce(ok);
    await run();
    expect((backendUsed() as AgentPlatformBackend).location).toBe('us-central1');
  });

  it('falls back to the SDK default location when none is set', async () => {
    vi.stubEnv('EXPO_PUBLIC_AI_BACKEND', 'agent_platform');
    vi.stubEnv('EXPO_PUBLIC_AI_LOCATION', '');
    h.generateContent.mockResolvedValueOnce(ok);
    await run();
    expect(backendUsed()).toBeInstanceOf(AgentPlatformBackend);
    expect((backendUsed() as AgentPlatformBackend).location).toBe(new AgentPlatformBackend().location);
  });

  it.each(['google', '', 'something_else'])('uses the Gemini Developer API backend for EXPO_PUBLIC_AI_BACKEND=%j', async (value) => {
    vi.stubEnv('EXPO_PUBLIC_AI_BACKEND', value);
    h.generateContent.mockResolvedValueOnce(ok);
    await run();
    expect(backendUsed()).toBeInstanceOf(GoogleAIBackend);
    expect(backendUsed()).not.toBeInstanceOf(AgentPlatformBackend);
  });

  it('uses the Gemini Developer API backend when the variable is not set at all', async () => {
    vi.stubEnv('EXPO_PUBLIC_AI_BACKEND', undefined);
    h.generateContent.mockResolvedValueOnce(ok);
    await run();
    expect(backendUsed()).toBeInstanceOf(GoogleAIBackend);
  });
});

// ─── Images ───────────────────────────────────────────────────────────────────
describe('firebase provider: image input', () => {
  const png: AIImage = { mimeType: 'image/png', base64: 'AAAA' };
  const jpeg: AIImage = { mimeType: 'image/jpeg', base64: 'BBBB' };
  const webp: AIImage = { mimeType: 'image/webp', base64: 'CCCC' };

  it('sends images as inlineData parts after the text, in order', async () => {
    h.generateContent.mockResolvedValueOnce(ok);
    await run({ images: [png, jpeg] });
    expect(sentParts()).toEqual([
      { type: 'text', text: 'A notes app' },
      { type: 'inlineData', inlineData: { mimeType: 'image/png', data: 'AAAA' } },
      { type: 'inlineData', inlineData: { mimeType: 'image/jpeg', data: 'BBBB' } },
    ]);
  });

  it('allows WebP in the cloud', async () => {
    h.generateContent.mockResolvedValueOnce(ok);
    const res = await run({ images: [webp] });
    expect(res.success).toBe(true);
    expect(sentParts()[1]).toMatchObject({ inlineData: { mimeType: 'image/webp' } });
  });

  it('declares an image expected input for Nano only when images are sent', async () => {
    h.world.languageModel = {};
    h.generateContent.mockResolvedValue(reply('{"answer":"yes"}', 'on_device'));
    await run({ mode: 'prefer_on_device', images: [png] });
    await run({ mode: 'prefer_on_device' });
    expect(modelParams(0).onDeviceParams.createOptions.expectedInputs).toEqual([{ type: 'text', languages: ['en'] }, { type: 'image' }]);
    expect(modelParams(1).onDeviceParams.createOptions.expectedInputs).toEqual([{ type: 'text', languages: ['en'] }]);
  });

  it('refuses WebP on-device with unsupported_modality and never calls the SDK', async () => {
    h.world.languageModel = {};
    const res = await run({ mode: 'only_on_device', images: [png, webp] });
    expect(res).toMatchObject({ success: false, errorCode: 'unsupported_modality', source: 'on_device', provider: 'firebase' });
    expect(h.getGenerativeModel).not.toHaveBeenCalled();
    expect(h.generateContent).not.toHaveBeenCalled();
  });

  it('runs JPEG and PNG on-device', async () => {
    h.world.languageModel = {};
    h.generateContent.mockResolvedValueOnce(reply('{"answer":"yes"}', 'on_device'));
    expect(await run({ mode: 'only_on_device', images: [png, jpeg] })).toMatchObject({ success: true, source: 'on_device' });
  });
});

// ─── Local-only and cloud-only policy ─────────────────────────────────────────
describe('firebase provider: local-only and cloud-only policy', () => {
  it('only_on_device without the Prompt API fails clearly and never reaches the cloud', async () => {
    h.world.languageModel = undefined;
    const res = await run({ mode: 'only_on_device' });
    expect(res).toMatchObject({ success: false, errorCode: 'model_unavailable', source: 'on_device', provider: 'firebase', fallbackUsed: false });
    expect(res.errorMessage).toMatch(/on-device/i);
    expect(h.getAI).not.toHaveBeenCalled();
    expect(h.getGenerativeModel).not.toHaveBeenCalled();
    expect(h.generateContent).not.toHaveBeenCalled();
    expect(h.appCheckReady).not.toHaveBeenCalled();
  });

  it('only_on_device with a model-unavailable SDK error stays on-device and is not retried', async () => {
    h.world.languageModel = {};
    h.generateContent.mockRejectedValue(new AIError(SdkErrorCode.UNSUPPORTED, 'ONLY_ON_DEVICE but no model'));
    const res = await run({ mode: 'only_on_device' });
    expect(res).toMatchObject({ success: false, errorCode: 'model_unavailable', source: 'on_device' });
    expect(h.generateContent).toHaveBeenCalledTimes(1);
  });

  it('only_on_device does not wait for App Check (no cloud leg is allowed)', async () => {
    h.world.languageModel = {};
    h.generateContent.mockResolvedValueOnce(reply('{"answer":"yes"}', 'on_device'));
    await run({ mode: 'only_on_device' });
    expect(h.appCheckReady).not.toHaveBeenCalled();
  });

  it('only_in_cloud works without Nano and checks App Check first', async () => {
    h.generateContent.mockResolvedValueOnce(ok);
    expect(await run({ mode: 'only_in_cloud' })).toMatchObject({ success: true, source: 'cloud' });
    expect(h.appCheckReady).toHaveBeenCalledTimes(1);
  });

  it('prefer_on_device without Nano may use the cloud, so it checks App Check', async () => {
    h.generateContent.mockResolvedValueOnce(ok);
    expect(await run({ mode: 'prefer_on_device' })).toMatchObject({ success: true, source: 'cloud', fallbackUsed: true });
    expect(h.appCheckReady).toHaveBeenCalledTimes(1);
  });

  it('prefer_on_device with Nano present does not pre-check App Check', async () => {
    h.world.languageModel = {};
    h.generateContent.mockResolvedValueOnce(reply('{"answer":"yes"}', 'on_device'));
    await run({ mode: 'prefer_on_device' });
    expect(h.appCheckReady).not.toHaveBeenCalled();
  });

  it('prefer_in_cloud checks App Check', async () => {
    h.generateContent.mockResolvedValueOnce(ok);
    await run({ mode: 'prefer_in_cloud' });
    expect(h.appCheckReady).toHaveBeenCalledTimes(1);
  });

  // The SDK uses Nano for prefer_on_device only when the model is `available`; otherwise it goes to the
  // cloud and awaits the App Check token itself with no timeout. The provider mirrors that decision so
  // the App Check wait stays bounded and a failure is attributed to the leg that really ran.
  it.each(['downloadable', 'downloading', 'unavailable', 'unknown'] as const)(
    'prefer_on_device with the Prompt API present but Nano %s counts as a cloud leg and bounds the App Check wait',
    async (availability) => {
      h.world.languageModel = {};
      h.onDeviceStatus.mockResolvedValue({ platform: 'web', apiExposed: true, availability });
      h.appCheckReady.mockResolvedValue(false);
      h.generateContent.mockResolvedValue(ok);
      const res = await run({ mode: 'prefer_on_device' });
      expect(res).toMatchObject({ success: false, errorCode: 'app_check_failed', source: 'cloud' });
      expect(h.appCheckReady).toHaveBeenCalledTimes(1);
      expect(h.generateContent).not.toHaveBeenCalled();
    },
  );

  it('prefer_on_device with Nano available runs on-device and attributes a failure to the on-device leg', async () => {
    h.world.languageModel = {};
    h.generateContent.mockRejectedValue(Object.assign(new Error('The model could not be created.'), { name: 'NotAllowedError' }));
    const res = await run({ mode: 'prefer_on_device' });
    expect(res).toMatchObject({ success: false, errorCode: 'model_unavailable', source: 'on_device' });
    expect(h.appCheckReady).not.toHaveBeenCalled();
  });

  it('treats a prefer_on_device availability probe that never answers as unknown (cloud leg) after a short budget', async () => {
    vi.useFakeTimers();
    try {
      h.world.languageModel = {};
      h.onDeviceStatus.mockReturnValue(never());
      h.appCheckReady.mockResolvedValue(false);
      const pending = run({ mode: 'prefer_on_device' });
      await vi.advanceTimersByTimeAsync(1_500);
      expect(await pending).toMatchObject({ success: false, errorCode: 'app_check_failed', source: 'cloud' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefer_on_device with an availability probe that throws is treated as a cloud leg', async () => {
    h.world.languageModel = {};
    h.onDeviceStatus.mockRejectedValue(new Error('probe failed'));
    h.generateContent.mockResolvedValueOnce(ok);
    expect(await run({ mode: 'prefer_on_device' })).toMatchObject({ success: true, source: 'cloud', fallbackUsed: true });
    expect(h.appCheckReady).toHaveBeenCalledTimes(1);
  });
});

// ─── Configuration and App Check gate ─────────────────────────────────────────
describe('firebase provider: configuration and App Check gate', () => {
  it('returns not_configured when there is no Firebase app, without touching the SDK', async () => {
    h.world.app = undefined;
    const res = await run();
    expect(res).toMatchObject({ success: false, errorCode: 'not_configured', provider: 'firebase', source: 'cloud' });
    expect(res.errorMessage).toMatch(/EXPO_PUBLIC_FIREBASE/);
    expect(h.getAI).not.toHaveBeenCalled();
    expect(h.getGenerativeModel).not.toHaveBeenCalled();
  });

  it('labels a not-configured on-device request with the on-device source', async () => {
    h.world.app = undefined;
    expect(await run({ mode: 'only_on_device' })).toMatchObject({ errorCode: 'not_configured', source: 'on_device' });
  });

  it('returns app_check_failed when no token arrives in time, and does not call the model', async () => {
    h.appCheckReady.mockResolvedValue(false);
    const res = await run();
    expect(res).toMatchObject({ success: false, errorCode: 'app_check_failed', source: 'cloud', provider: 'firebase' });
    expect(res.errorMessage).toMatch(/App Check/);
    expect(h.getGenerativeModel).not.toHaveBeenCalled();
    expect(h.generateContent).not.toHaveBeenCalled();
  });

  it('waits at most 8 s for App Check, or less when the request timeout is shorter', async () => {
    h.generateContent.mockResolvedValue(ok);
    await run();
    await run({ timeoutMs: 3000 });
    await run({ timeoutMs: 120_000 });
    expect(h.appCheckReady.mock.calls.map((c) => c[0])).toEqual([8000, 3000, 8000]);
  });
});

// ─── Timeout and cancellation ─────────────────────────────────────────────────
describe('firebase provider: timeout and cancellation', () => {
  it('returns timeout when the model never answers, even if the SDK ignores the signal', async () => {
    h.generateContent.mockReturnValue(never());
    const started = Date.now();
    const res = await run({ timeoutMs: 25 });
    expect(res).toMatchObject({ success: false, errorCode: 'timeout', source: 'cloud', provider: 'firebase' });
    expect(res.errorMessage).toMatch(/No response within/);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(h.generateContent).toHaveBeenCalledTimes(1); // a timeout is not retried
    expect(sentOptions().signal.aborted).toBe(true);
  });

  it('labels an on-device timeout with the on-device source', async () => {
    h.world.languageModel = {};
    h.generateContent.mockReturnValue(never());
    expect(await run({ mode: 'only_on_device', timeoutMs: 25 })).toMatchObject({ errorCode: 'timeout', source: 'on_device' });
  });

  it('gives the SDK request a timeout a little longer than ours, so ours always fires first', async () => {
    h.generateContent.mockResolvedValue(ok);
    await run({ timeoutMs: 1000 });
    await run();
    expect(sentOptions(0).timeout).toBe(6000);
    expect(sentOptions(1).timeout).toBe(95_000);
  });

  it('returns cancelled when the caller aborts mid-request, and aborts the SDK signal', async () => {
    h.generateContent.mockReturnValue(never());
    const ac = new AbortController();
    const pending = run({ signal: ac.signal, timeoutMs: 5000 });
    setTimeout(() => ac.abort(), 10);
    const res = await pending;
    expect(res).toMatchObject({ success: false, errorCode: 'cancelled', provider: 'firebase' });
    expect(sentOptions().signal.aborted).toBe(true);
    expect(h.generateContent).toHaveBeenCalledTimes(1);
  });

  it('returns cancelled for a signal that is already aborted', async () => {
    h.generateContent.mockReturnValue(never());
    const ac = new AbortController();
    ac.abort();
    expect(await run({ signal: ac.signal, timeoutMs: 5000 })).toMatchObject({ success: false, errorCode: 'cancelled' });
  });

  it('maps an AbortError thrown by the SDK (not our timer) to cancelled', async () => {
    h.generateContent.mockRejectedValue(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
    expect(await run()).toMatchObject({ success: false, errorCode: 'cancelled' });
  });

  it('removes its abort listener from the caller signal when done', async () => {
    h.generateContent.mockResolvedValue(ok);
    const ac = new AbortController();
    const remove = vi.spyOn(ac.signal, 'removeEventListener');
    await run({ signal: ac.signal });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

// ─── Error mapping ────────────────────────────────────────────────────────────
describe('firebase provider: SDK error mapping', () => {
  it('quota (429) maps to quota and is not retried', async () => {
    h.generateContent.mockRejectedValue(fetchError(429, '[429 Too Many Requests] Resource exhausted'));
    const res = await run();
    expect(res).toMatchObject({ success: false, errorCode: 'quota', provider: 'firebase' });
    expect(res.errorMessage).toMatch(/quota|rate limit/i);
    expect(h.generateContent).toHaveBeenCalledTimes(1);
  });

  it('permission denied (403) maps to not_configured', async () => {
    h.generateContent.mockRejectedValue(fetchError(403, '[403 Forbidden] PERMISSION_DENIED: caller lacks permission'));
    expect(await run()).toMatchObject({ success: false, errorCode: 'not_configured' });
  });

  it('API not enabled maps to not_configured with an actionable message', async () => {
    h.generateContent.mockRejectedValue(new AIError(SdkErrorCode.API_NOT_ENABLED, 'Firebase AI Logic API has not been used', { status: 403 }));
    const res = await run();
    expect(res).toMatchObject({ success: false, errorCode: 'not_configured' });
    expect(res.errorMessage).toMatch(/AI Logic/);
  });

  it.each([401, 403])('an App Check rejection (%i) maps to app_check_failed', async (status) => {
    h.generateContent.mockRejectedValue(fetchError(status, `[${status}] Firebase App Check token is invalid.`));
    expect(await run()).toMatchObject({ success: false, errorCode: 'app_check_failed' });
  });

  it('a network failure from the SDK maps to offline', async () => {
    h.generateContent.mockRejectedValue(new AIError(SdkErrorCode.ERROR, 'Error fetching from https://example.test: Failed to fetch'));
    expect(await run()).toMatchObject({ success: false, errorCode: 'offline' });
  });

  it('a bare TypeError from fetch maps to offline', async () => {
    h.generateContent.mockRejectedValue(new TypeError('Network request failed'));
    expect(await run()).toMatchObject({ success: false, errorCode: 'offline' });
  });

  it('an unknown model (404) maps to model_unavailable', async () => {
    h.generateContent.mockRejectedValue(fetchError(404, '[404 Not Found] models/x is not found'));
    expect(await run()).toMatchObject({ success: false, errorCode: 'model_unavailable' });
  });

  it('a 5xx failure maps to provider_error and is not retried', async () => {
    h.generateContent.mockRejectedValue(fetchError(503, '[503 Service Unavailable]'));
    expect(await run()).toMatchObject({ success: false, errorCode: 'provider_error' });
    expect(h.generateContent).toHaveBeenCalledTimes(1);
  });

  it('a blocked response (response-error) maps to provider_error', async () => {
    h.generateContent.mockRejectedValue(new AIError(SdkErrorCode.RESPONSE_ERROR, 'Response was blocked due to SAFETY'));
    expect(await run()).toMatchObject({ success: false, errorCode: 'provider_error' });
  });

  it('a Prompt API NotSupportedError on-device maps to model_unavailable', async () => {
    h.world.languageModel = {};
    h.generateContent.mockRejectedValue(Object.assign(new Error('The requested language is not supported.'), { name: 'NotSupportedError' }));
    expect(await run({ mode: 'only_on_device' })).toMatchObject({ errorCode: 'model_unavailable', source: 'on_device' });
  });

  it('a throw while building the model (initialisation failure) maps instead of escaping', async () => {
    h.getGenerativeModel.mockImplementationOnce(() => { throw new AIError(SdkErrorCode.NO_MODEL, 'Missing model name'); });
    const res = await run();
    expect(res).toMatchObject({ success: false, errorCode: 'not_configured', provider: 'firebase' });
    expect(h.generateContent).not.toHaveBeenCalled();
  });

  it('never throws: an arbitrary rejection becomes provider_error', async () => {
    h.generateContent.mockRejectedValue('boom');
    expect(await run()).toMatchObject({ success: false, errorCode: 'provider_error', provider: 'firebase' });
  });

  it('every failure carries latency and no output', async () => {
    h.generateContent.mockRejectedValue(fetchError(429, '[429] quota'));
    const res = await run();
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    expect(res.output).toBeUndefined();
    expect(res.fallbackUsed).toBe(false);
  });
});

// ─── On-device languages (StructuredRequest.languages) ────────────────────────
describe('firebase provider: on-device languages', () => {
  it('declares the Prompt API languages the request names, English always, and drops the rest', async () => {
    h.world.languageModel = {};
    h.generateContent.mockResolvedValue(reply('{"answer":"yes"}', 'on_device'));
    await run({ mode: 'prefer_on_device', languages: ['es-MX', 'hi', 'JA'] });
    const { createOptions } = modelParams().onDeviceParams;
    expect(createOptions.expectedInputs).toEqual([{ type: 'text', languages: ['en', 'es', 'ja'] }]);
    expect(createOptions.expectedOutputs).toEqual([{ type: 'text', languages: ['en', 'es', 'ja'] }]);
  });

  it('keeps English alone for languages Chrome does not document, and adds the image input when needed', async () => {
    h.world.languageModel = {};
    h.generateContent.mockResolvedValue(reply('{"answer":"yes"}', 'on_device'));
    await run({ mode: 'prefer_on_device', languages: ['hi', 'ta-IN'], images: [{ mimeType: 'image/png', base64: 'AAAA' }] });
    expect(modelParams().onDeviceParams.createOptions.expectedInputs).toEqual([{ type: 'text', languages: ['en'] }, { type: 'image' }]);
    expect(modelParams().onDeviceParams.createOptions.expectedOutputs).toEqual([{ type: 'text', languages: ['en'] }]);
  });

  it('textIO: English by default, only documented Prompt API languages otherwise', () => {
    expect(PROMPT_API_LANGUAGES).toEqual(['en', 'es', 'ja']);
    expect(textIO()).toEqual({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] });
    expect(textIO(['ja_JP', 'ja', ' es '])).toMatchObject({ expectedInputs: [{ languages: ['en', 'es', 'ja'] }] });
    expect(textIO(['', 'kok', 'fr'])).toMatchObject({ expectedInputs: [{ languages: ['en'] }] });
  });
});

// ─── Token usage (docs/07 §16.4) ──────────────────────────────────────────────
describe('firebase provider: token usage', () => {
  const withUsage = (text: string, usage?: Record<string, number>) =>
    ({ response: { inferenceSource: 'in_cloud', text: () => text, usageMetadata: usage } });

  it('reports prompt and output tokens, counting thinking tokens as output', async () => {
    h.generateContent.mockResolvedValueOnce(withUsage('{"answer":"yes"}', { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 50, totalTokenCount: 200 }));
    const onUsage = vi.fn();
    expect((await run({ onUsage })).success).toBe(true);
    expect(onUsage).toHaveBeenCalledWith({ input: 120, output: 80 });
  });

  it('reports the tokens of an answer that then fails validation, since they were spent', async () => {
    h.generateContent.mockResolvedValueOnce(withUsage('{"answer":42}', { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 }));
    const onUsage = vi.fn();
    expect(await run({ onUsage })).toMatchObject({ success: false, errorCode: 'invalid_output' });
    expect(onUsage).toHaveBeenCalledWith({ input: 10, output: 4 });
  });

  it('reports nothing when the response carries no usage, and a throwing callback never fails the request', async () => {
    h.generateContent.mockResolvedValueOnce(ok);
    const quiet = vi.fn();
    await run({ onUsage: quiet });
    expect(quiet).not.toHaveBeenCalled();
    h.generateContent.mockResolvedValueOnce(withUsage('{"answer":"yes"}', { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }));
    expect((await run({ onUsage: () => { throw new Error('ledger full'); } })).success).toBe(true);
  });
});

// ─── Remote Config ────────────────────────────────────────────────────────────
describe('firebase provider: Remote Config', () => {
  afterEach(() => resetRemoteConfig());

  it('sends the model Remote Config names for the role, and the default otherwise', async () => {
    h.generateContent.mockResolvedValue(ok);
    applyRemoteConfig({ model_compile: 'gemini-3.9-pro' });
    await run();
    await run({ role: 'safety' });
    expect(cloudParams(0).model).toBe('gemini-3.9-pro');
    expect(cloudParams(1).model).toBe(modelForRole('safety'));
  });
});

// ─── Hermes shim ──────────────────────────────────────────────────────────────
describe('firebase provider: AbortSignal.any shim for Hermes', () => {
  it('installs a working AbortSignal.any when the runtime has none', async () => {
    const ctor = AbortSignal as unknown as { any?: unknown };
    const original = ctor.any;
    try {
      delete ctor.any;
      expect(typeof AbortSignal.any).toBe('undefined');
      vi.resetModules();
      await import('./firebase-provider');
      expect(typeof AbortSignal.any).toBe('function');

      const a = new AbortController();
      const b = new AbortController();
      const combined = AbortSignal.any([a.signal, b.signal]);
      expect(combined.aborted).toBe(false);
      b.abort('stop');
      expect(combined.aborted).toBe(true);
      expect(combined.reason).toBe('stop');

      const already = new AbortController();
      already.abort('early');
      const pre = AbortSignal.any([new AbortController().signal, already.signal]);
      expect(pre.aborted).toBe(true);
      expect(pre.reason).toBe('early');
    } finally {
      ctor.any = original;
    }
  });
});
