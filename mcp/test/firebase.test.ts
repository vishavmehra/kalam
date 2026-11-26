import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIExecutionResult, AIProvider, StructuredRequest } from '@/core/contracts';
import { validateSpec } from '@/core/spec/validate';
import { parseOptions } from '../src/config';
import {
  compileWithFirebaseTool, createNodeFirebaseProvider, errorCode, exchangeDebugToken, firebaseEnv, stripFences, type FirebaseEnv,
} from '../src/firebase';
import { buildContext, createKalamServer } from '../src/server';
import { connect, data, tailorIR } from './helpers';

const ENV = {
  EXPO_PUBLIC_FIREBASE_API_KEY: 'AIzaSyTEST-not-a-real-key-0000000',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'kalam-test',
  EXPO_PUBLIC_FIREBASE_APP_ID: '1:123456789:web:abcdef123456',
  EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN: '11111111-2222-3333-4444-555555555555',
};

function fakeProvider(output: unknown): AIProvider & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    name: 'firebase', prompts, isConfigured: () => true,
    onDeviceStatus: async () => ({ platform: 'other', apiExposed: false, availability: 'unavailable' }),
    async generateStructured<T>(req: StructuredRequest<T>): Promise<AIExecutionResult<T>> {
      prompts.push(req.prompt);
      const parsed = req.parse(output);
      return parsed.success
        ? { success: true, output: parsed.data, provider: 'firebase', source: 'cloud', model: 'test-model', latencyMs: 1, fallbackUsed: false }
        : { success: false, provider: 'firebase', source: 'cloud', model: 'test-model', latencyMs: 1, fallbackUsed: false, errorCode: 'invalid_output', errorMessage: parsed.error };
    },
  };
}

describe('Firebase gate', () => {
  it('reads the app variable names and rejects incomplete or malformed config', () => {
    expect(firebaseEnv(ENV)).toMatchObject({ projectId: 'kalam-test', backend: 'google' });
    expect(firebaseEnv({ ...ENV, EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN: undefined })).toBeUndefined();
    expect(firebaseEnv({ ...ENV, EXPO_PUBLIC_FIREBASE_PROJECT_ID: '../../evil' })).toBeUndefined();
    expect(firebaseEnv({ ...ENV, EXPO_PUBLIC_AI_BACKEND: 'agent_platform', EXPO_PUBLIC_AI_LOCATION: 'global' })?.backend).toBe('agent_platform');
  });

  it('stays off without --firebase, and without the variables even with it', async () => {
    const log = vi.fn();
    expect((await buildContext(parseOptions([]), ENV, log)).firebase).toBeUndefined();
    expect((await buildContext(parseOptions(['--firebase']), {}, log)).firebase).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/stays off/));
    const on = await buildContext(parseOptions(['--firebase', '--cloud-calls', '2']), ENV, log);
    expect(on.firebase?.budget.left).toBe(2);
    const client = await connect(createKalamServer(on));
    const tool = (await client.listTools()).tools.find((t) => t.name === 'kalam_compile_with_firebase');
    // Not read-only: hosts that auto-approve read-only tools must still ask before text goes to Google.
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
    await client.close();
  });
});

describe('kalam_compile_with_firebase', () => {
  it("runs the app's compiler on the model answer and labels the source honestly", async () => {
    const provider = fakeProvider(tailorIR());
    const budget = { left: 3 };
    // The classifier maps a tailor shop to the measurement_log template, so the cloud call is forced here.
    const r = await compileWithFirebaseTool({ request: 'a tailor shop with customers and measurements', force: true }, provider, budget);
    expect(r.isError).toBeFalsy();
    const d = data(r);
    expect(validateSpec(d.spec).ok).toBe(true);
    expect(d).toMatchObject({ provider: 'firebase', source: 'cloud', model: 'test-model', route: 'cloud' });
    expect(budget.left).toBe(2);
    expect(provider.prompts[0]).toContain('tailor shop');
  });

  it('rejects a bad model answer and stops at the call budget', async () => {
    const bad = await compileWithFirebaseTool({ request: 'a tailor shop', force: true }, fakeProvider({ nonsense: true }), { left: 5 });
    expect(bad.isError).toBe(true);
    const provider = fakeProvider(tailorIR());
    const spent = await compileWithFirebaseTool({ request: 'a tailor shop', force: true }, provider, { left: 0 });
    expect(spent.isError).toBe(true);
    expect(data(spent).errorCode).toBe('quota');
    expect(provider.prompts).toEqual([]);
  });

  it('refuses a simple request that a template covers, unless forced', async () => {
    const provider = fakeProvider(tailorIR());
    const budget = { left: 3 };
    const r = await compileWithFirebaseTool({ request: 'a checklist for packing' }, provider, budget);
    expect(r.isError).toBe(true);
    expect(data(r).templateId).toBe('checklist');
    expect(provider.prompts).toEqual([]);
    expect(budget.left).toBe(3);
    await compileWithFirebaseTool({ request: 'a checklist for packing', force: true }, provider, budget);
    expect(provider.prompts).toHaveLength(1);
  });
});

describe('Node glue for Firebase AI Logic (network stubbed, no real call)', () => {
  const env = firebaseEnv(ENV) as FirebaseEnv;
  afterEach(() => vi.unstubAllGlobals());

  it('exchanges the App Check debug token with the documented REST call', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ token: 'app-check-token', ttl: '3600s' }));
    vi.stubGlobal('fetch', fetchMock);
    const before = Date.now();
    const t = await exchangeDebugToken(env);
    expect(t.token).toBe('app-check-token');
    expect(t.expireTimeMillis).toBeGreaterThanOrEqual(before + 3_600_000);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://firebaseappcheck.googleapis.com/v1/projects/kalam-test/apps/${ENV.EXPO_PUBLIC_FIREBASE_APP_ID}:exchangeDebugToken?key=${ENV.EXPO_PUBLIC_FIREBASE_API_KEY}`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ debugToken: ENV.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN });
  });

  it('refuses a failed or malformed exchange', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 403 }));
    await expect(exchangeDebugToken(env)).rejects.toThrow(/HTTP 403/);
    vi.stubGlobal('fetch', async () => Response.json({ token: 'x', ttl: 'soon' }));
    await expect(exchangeDebugToken(env)).rejects.toThrow();
  });

  it('maps provider errors to an error kind and strips code fences', () => {
    expect(errorCode(new Error('AI: App Check token is invalid'))).toBe('app_check_failed');
    expect(errorCode(new Error('[429] quota exceeded'))).toBe('quota');
    expect(errorCode(new Error('The operation was aborted'))).toBe('timeout');
    expect(errorCode(new Error('[400] bad schema'))).toBe('bad_request');
    expect(errorCode(new Error('something else'))).toBe('provider_error');
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });

  it('sends the request with the App Check token through the real SDK and validates the reply', async () => {
    const calls: Array<{ url: string; headers: Headers; body: string }> = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, headers: new Headers(init.headers), body: String(init.body ?? '') });
      if (url.includes(':exchangeDebugToken')) return Response.json({ token: 'app-check-token', ttl: '3600s' });
      if (url.includes(':generateContent')) {
        return Response.json({
          candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: '```json\n' + JSON.stringify(tailorIR()) + '\n```' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
        });
      }
      return new Response('{}', { status: 404 });
    });
    const budget = { left: 2 };
    const r = await compileWithFirebaseTool({ request: 'a tailor shop with customers and measurements', force: true }, createNodeFirebaseProvider(env), budget);
    expect(r.isError).toBeFalsy();
    expect(validateSpec(data(r).spec).ok).toBe(true);
    expect(data(r)).toMatchObject({ provider: 'firebase', source: 'cloud' });
    const gen = calls.find((c) => c.url.includes(':generateContent'));
    expect(gen?.url).toMatch(/^https:\/\/firebasevertexai\.googleapis\.com\/.*projects\/kalam-test\//);
    expect(gen?.headers.get('x-firebase-appcheck')).toBe('app-check-token');
    expect(gen?.body).toContain('tailor shop');
    expect(calls.some((c) => c.url.includes(':exchangeDebugToken'))).toBe(true);
    expect(budget.left).toBe(1);
  }, 20_000);
});

describe('options', () => {
  it('parses flags and refuses unsafe values', () => {
    expect(parseOptions([])).toMatchObject({ http: false, firebase: false, port: 3917, cloudCalls: 5 });
    expect(parseOptions(['--app-url', 'https://kalam.example.com/']).appUrl).toBe('https://kalam.example.com');
    expect(parseOptions(['--app-url', 'http://localhost:8081']).appUrl).toBe('http://localhost:8081');
    expect(() => parseOptions(['--app-url', 'http://evil.example.com'])).toThrow(/https/);
    expect(() => parseOptions(['--app-url', 'https://x.example.com/#a'])).toThrow();
    expect(() => parseOptions(['--port', '80'])).toThrow();
    expect(() => parseOptions(['--cloud-calls', '500'])).toThrow();
    expect(() => parseOptions(['--host', '0.0.0.0'])).toThrow();
    // The HTTP endpoint has no login, so file writes and cloud calls stay on stdio.
    expect(() => parseOptions(['--http', '--workspace', '.'])).toThrow(/cannot be combined/);
    expect(() => parseOptions(['--http', '--firebase'])).toThrow(/cannot be combined/);
  });
});
