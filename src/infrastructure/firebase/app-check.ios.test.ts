/**
 * iOS App Check (docs/17 §3.3). firebase/app-check is mocked and the kalam-apple native module is a fake on
 * globalThis.expo.modules. These prove which provider Kalam picks and when it claims 'active'. They do not
 * prove App Attest issues tokens: that needs a device build registered in Firebase with the Apple Team ID.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ initializeAppCheck: vi.fn(), getToken: vi.fn(), custom: vi.fn() }));

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: (...args: unknown[]) => sdk.initializeAppCheck(...args),
  getToken: (...args: unknown[]) => sdk.getToken(...args),
  CustomProvider: class {
    constructor(readonly options: { getToken: () => Promise<unknown> }) { sdk.custom(options); }
  },
}));

type G = { expo?: unknown; FIREBASE_APPCHECK_DEBUG_TOKEN?: unknown };
const g = globalThis as G;
const fakeApp = { name: '[DEFAULT]' } as never;

function fakeApple() {
  return {
    installAppAttest: vi.fn(),
    getAppCheckToken: vi.fn(async (_force: boolean) => ({ token: 'app-attest-token', expireTimeMillis: 1_900_000_000_000 })),
  };
}

async function load(native?: ReturnType<typeof fakeApple>, nano?: unknown) {
  vi.resetModules();
  g.expo = { modules: { ...(native ? { KalamApple: native } : {}), ...(nano ? { KalamNano: nano } : {}) } };
  return import('./app-check.ios');
}

const providerGetToken = () => (sdk.custom.mock.calls[0]?.[0] as { getToken: () => Promise<unknown> }).getToken;

beforeEach(() => {
  Object.values(sdk).forEach((fn) => fn.mockReset());
  delete g.FIREBASE_APPCHECK_DEBUG_TOKEN;
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN', '');
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_API_KEY', 'test-api-key');
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'test-project');
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', '123');
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_IOS_APP_ID', '1:123:ios:abc');
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete g.expo;
  delete g.FIREBASE_APPCHECK_DEBUG_TOKEN;
});

describe('App Check (iOS)', () => {
  it('development build: uses the registered debug token through the JS SDK, no native module needed', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN', 'registered-debug-token');
    const mod = await load();
    mod.setupAppCheck(fakeApp);
    expect(g.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe('registered-debug-token');
    expect(mod.appCheckStatus()).toEqual({ status: 'debug', detail: undefined });
  });

  it('release build: never uses the debug token, and installs App Attest with the iOS app id on the first token request', async () => {
    vi.stubEnv('EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN', 'registered-debug-token');
    const native = fakeApple();
    const mod = await load(native);
    mod.setupAppCheck(fakeApp);
    expect(g.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
    expect(sdk.initializeAppCheck).toHaveBeenCalledWith(fakeApp, expect.objectContaining({ isTokenAutoRefreshEnabled: false }));
    expect(native.installAppAttest).not.toHaveBeenCalled();
    expect(native.getAppCheckToken).not.toHaveBeenCalled();
    await providerGetToken()();
    expect(native.installAppAttest).toHaveBeenCalledWith({
      apiKey: 'test-api-key', projectId: 'test-project', appId: '1:123:ios:abc', gcmSenderId: '123',
    });
  });

  it('stays pending until App Attest returns a real token, then reports active', async () => {
    const native = fakeApple();
    const mod = await load(native);
    mod.setupAppCheck(fakeApp);
    expect(mod.appCheckStatus()).toEqual({ status: 'not_configured', detail: undefined });
    expect(await providerGetToken()()).toEqual({ token: 'app-attest-token', expireTimeMillis: 1_900_000_000_000 });
    expect(native.getAppCheckToken).toHaveBeenCalledWith(false);
    expect(mod.appCheckStatus()).toEqual({ status: 'active', detail: undefined });
  });

  it('reports error with the reason when App Attest gives no token', async () => {
    const native = fakeApple();
    native.getAppCheckToken.mockRejectedValue(new Error('DCError 2: feature unsupported'));
    const mod = await load(native);
    mod.setupAppCheck(fakeApp);
    await expect(providerGetToken()()).rejects.toThrow('DCError 2');
    expect(mod.appCheckStatus()).toEqual({ status: 'error', detail: 'App Attest gave no token: DCError 2: feature unsupported' });
  });

  it('without kalam-apple it is unsupported, and never falls back to the Android module', async () => {
    const nano = { installPlayIntegrity: vi.fn(), getAppCheckToken: vi.fn() };
    const mod = await load(undefined, nano);
    mod.setupAppCheck(fakeApp);
    expect(mod.appCheckStatus()).toMatchObject({ status: 'unsupported_on_platform', detail: expect.stringMatching(/^App Attest is not available.*kalam-apple/) });
    expect(nano.installPlayIntegrity).not.toHaveBeenCalled();
    expect(sdk.initializeAppCheck).not.toHaveBeenCalled();
  });

  it('is not configured without the iOS app id', async () => {
    vi.stubEnv('EXPO_PUBLIC_FIREBASE_IOS_APP_ID', '');
    const native = fakeApple();
    const mod = await load(native);
    mod.setupAppCheck(fakeApp);
    expect(mod.appCheckStatus()).toEqual({
      status: 'not_configured', detail: 'App Attest needs EXPO_PUBLIC_FIREBASE_IOS_APP_ID, the iOS app registered in Firebase.',
    });
    expect(native.installAppAttest).not.toHaveBeenCalled();
  });

  it('reports missing public Firebase ids as an error on the first token request, without throwing at start-up', async () => {
    vi.stubEnv('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', '');
    const native = fakeApple();
    const mod = await load(native);
    expect(() => mod.setupAppCheck(fakeApp)).not.toThrow();
    await expect(providerGetToken()()).rejects.toThrow(/MESSAGING_SENDER_ID/);
    expect(mod.appCheckStatus()).toMatchObject({ status: 'error', detail: expect.stringMatching(/MESSAGING_SENDER_ID/) });
    expect(native.installAppAttest).not.toHaveBeenCalled();
  });
});
