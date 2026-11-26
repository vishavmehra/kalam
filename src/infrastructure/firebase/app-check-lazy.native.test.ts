/**
 * App Check starts with the first cloud request, never with on-device work (Android). This drives the real
 * firebase/app-check, the real firebase/ai esm build (the one Metro bundles) and Kalam's unchanged
 * firebase-provider. The kalam-nano native module is a fake on globalThis.expo.modules and fetch is stubbed, so
 * nothing leaves the machine. NOT proof that Play Integrity issues tokens: that needs a device build.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { StructuredRequest } from '@/core/contracts';
import type { NativeStatus } from '../../../modules/kalam-nano';

const esm = vi.hoisted(() => ({
  ai: new URL('../../../node_modules/@firebase/ai/dist/esm/index.esm.js', import.meta.url).href,
}));
vi.mock('firebase/ai', async () => import(/* @vite-ignore */ esm.ai));
// On Android Metro resolves both to the .native files.
vi.mock('./on-device', async () => import('./on-device.native'));
vi.mock('./app-check', async () => import('./app-check.native'));

type G = { expo?: unknown; LanguageModel?: unknown };
const g = globalThis as G;

const schema = { type: 'object', properties: { category: { type: 'string' } }, required: ['category'] };
const req = (mode: StructuredRequest<unknown>['mode']): StructuredRequest<{ category: string }> => ({
  taskType: 'classify', system: 'Classify the note.', prompt: 'Buy milk tomorrow.', jsonSchema: schema, mode,
  role: 'local_assistant', timeoutMs: 5_000,
  parse: (raw) => {
    const r = z.object({ category: z.string() }).safeParse(raw);
    return r.success ? { success: true, data: r.data } : { success: false, error: r.error.message };
  },
});

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN', '');
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_API_KEY', 'test-api-key');
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'test-project');
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_APP_ID', '1:123:web:abc');
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID', '1:123:android:def');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete g.LanguageModel;
  delete g.expo;
});

it('an only_on_device request asks for no App Check token; the first cloud request installs Play Integrity and gets a token before the model call', async () => {
  const events: string[] = [];
  const native = {
    configure: vi.fn(),
    availability: vi.fn(async (): Promise<NativeStatus> => ({ availability: 'available', model: 'nano-v4-full' })),
    prepare: vi.fn(),
    warmUp: vi.fn(async () => true),
    generate: vi.fn(async () => ({ text: '{"category":"shopping"}', source: 'on_device' as const })),
    cancel: vi.fn(() => true),
    installPlayIntegrity: vi.fn(() => { events.push('install Play Integrity'); }),
    getAppCheckToken: vi.fn(async () => {
      events.push('App Check token');
      return { token: 'play-integrity-token', expireTimeMillis: Date.now() + 3_600_000 };
    }),
    addListener: vi.fn(() => ({ remove() {} })),
  };
  const cloud = vi.fn(async (_url: string, init?: RequestInit) => {
    events.push(`model call with token ${new Headers(init?.headers).get('X-Firebase-AppCheck')}`);
    return new Response(
      JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '{"category":"work"}' }] }, finishReason: 'STOP' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', cloud);
  vi.resetModules();
  g.expo = { modules: { KalamNano: native } };
  const { createFirebaseProvider } = await import('./firebase-provider');
  const { appCheckStatus } = await import('./app');
  const firebase = createFirebaseProvider();

  // On-device work starts Firebase (and registers App Check) but contacts nothing.
  expect(await firebase.generateStructured(req('only_on_device'))).toMatchObject({ success: true, source: 'on_device' });
  expect(events).toEqual([]);
  expect(cloud).not.toHaveBeenCalled();
  expect(appCheckStatus()).toEqual({ status: 'not_configured', detail: undefined });

  // The first cloud request: Play Integrity, then a token, then the model call carrying that token.
  expect(await firebase.generateStructured(req('only_in_cloud'))).toMatchObject({ success: true, source: 'cloud', output: { category: 'work' } });
  expect(events).toEqual(['install Play Integrity', 'App Check token', 'model call with token play-integrity-token']);
  expect(appCheckStatus()).toEqual({ status: 'active', detail: undefined });

  // Later cloud requests reuse the valid token; Play Integrity is installed once.
  await firebase.generateStructured(req('only_in_cloud'));
  expect(events.slice(3)).toEqual(['model call with token play-integrity-token']);
});
