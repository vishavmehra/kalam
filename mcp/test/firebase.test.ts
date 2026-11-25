import { describe, expect, it, vi } from 'vitest';
import type { AIExecutionResult, AIProvider, StructuredRequest } from '@/core/contracts';
import { validateSpec } from '@/core/spec/validate';
import { parseOptions } from '../src/config';
import { compileWithFirebaseTool, firebaseEnv } from '../src/firebase';
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
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('kalam_compile_with_firebase');
    await client.close();
  });
});

describe('kalam_compile_with_firebase', () => {
  it("runs the app's compiler on the model answer and labels the source honestly", async () => {
    const provider = fakeProvider(tailorIR());
    const budget = { left: 3 };
    const r = await compileWithFirebaseTool({ request: 'a tailor shop with customers and measurements' }, provider, budget);
    expect(r.isError).toBeFalsy();
    const d = data(r);
    expect(validateSpec(d.spec).ok).toBe(true);
    expect(d).toMatchObject({ provider: 'firebase', source: 'cloud', model: 'test-model', route: 'cloud' });
    expect(budget.left).toBe(2);
    expect(provider.prompts[0]).toContain('tailor shop');
  });

  it('rejects a bad model answer and stops at the call budget', async () => {
    const bad = await compileWithFirebaseTool({ request: 'a tailor shop' }, fakeProvider({ nonsense: true }), { left: 5 });
    expect(bad.isError).toBe(true);
    const provider = fakeProvider(tailorIR());
    const spent = await compileWithFirebaseTool({ request: 'a tailor shop' }, provider, { left: 0 });
    expect(spent.isError).toBe(true);
    expect(data(spent).errorCode).toBe('quota');
    expect(provider.prompts).toEqual([]);
  });
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
  });
});
