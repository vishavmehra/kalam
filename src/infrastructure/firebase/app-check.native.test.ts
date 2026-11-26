/**
 * Android App Check (docs/17 FAI-08, docs/04 §15.5). firebase/app-check is mocked and the kalam-nano native
 * module is a fake on globalThis.expo.modules. These prove which provider Kalam picks and when it claims
 * 'active'. They do not prove Play Integrity issues tokens: that needs a device build registered in Firebase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  initializeAppCheck: vi.fn(),
  getToken: vi.fn(),
  custom: vi.fn(),
}));

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

function fakeNano() {
  return {
    configure: vi.fn(),
    installPlayIntegrity: vi.fn(),
    getAppCheckToken: vi.fn(async (_force: boolean) => ({ token: 'play-integrity-token', expireTimeMillis: 1_900_000_000_000 })),
  };
}

async function load(native?: ReturnType<typeof fakeNano>) {
  vi.resetModules();
  if (native) g.expo = { modules: { KalamNano: native } };
  else delete g.expo;
  return import('./app-check.native');
}

/** The getToken function Kalam handed to the CustomProvider. */
const providerGetToken = () => (sdk.custom.mock.calls[0]?.[0] as { getToken: () => Promise<unknown> }).getToken;

beforeEach(() => {
  Object.values(sdk).forEach((fn) => fn.mockReset());
  delete g.FIREBASE_APPCHECK_DEBUG_TOKEN;
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN', '');
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_API_KEY', 'test-api-key');
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'test-project');
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_APP_ID', '1:123:web:abc');
  vi.stubEnv('EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID', '1:123:android:def');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete g.expo;
  delete g.FIREBASE_APPCHECK_DEBUG_TOKEN;
});

describe('App Check (Android): debug token in development builds', () => {
  it('uses the registered debug token through the JS SDK, with no native module needed', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN', 'registered-debug-token');
    const mod = await load();
    mod.setupAppCheck(fakeApp);
    expect(g.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe('registered-debug-token');
    // Automatic refresh would exchange the debug token right away; the first cloud request asks instead.
    expect(sdk.initializeAppCheck).toHaveBeenCalledWith(fakeApp, expect.objectContaining({ isTokenAutoRefreshEnabled: false }));
    expect(mod.appCheckStatus()).toEqual({ status: 'debug', detail: undefined });
    expect(JSON.stringify(mod.appCheckStatus())).not.toContain('registered-debug-token');
  });

  it('never uses the debug token in a release build', async () => {
    vi.stubEnv('EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN', 'registered-debug-token');
    const native = fakeNano();
    const mod = await load(native);
    mod.setupAppCheck(fakeApp);
    expect(g.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
    await providerGetToken()();
    expect(native.installPlayIntegrity).toHaveBeenCalledTimes(1);
  });
});

describe('App Check (Android): Play Integrity through the native module', () => {
  it('only registers when Firebase starts: no Play Integrity, no token, no automatic refresh', async () => {
    const native = fakeNano();
    const mod = await load(native);
    mod.setupAppCheck(fakeApp);
    expect(native.configure).toHaveBeenCalledWith({ apiKey: 'test-api-key', projectId: 'test-project', appId: '1:123:android:def' });
    expect(sdk.initializeAppCheck).toHaveBeenCalledTimes(1);
    expect(sdk.initializeAppCheck).toHaveBeenCalledWith(fakeApp, expect.objectContaining({ isTokenAutoRefreshEnabled: false }));
    expect(native.installPlayIntegrity).not.toHaveBeenCalled();
    expect(native.getAppCheckToken).not.toHaveBeenCalled();
    expect(sdk.getToken).not.toHaveBeenCalled();
    expect(mod.appCheckStatus()).toEqual({ status: 'not_configured', detail: undefined });
  });

  it('installs Play Integrity once, on the first token request, and reports active only after a real token', async () => {
    const native = fakeNano();
    const mod = await load(native);
    mod.setupAppCheck(fakeApp);
    expect(await providerGetToken()()).toEqual({ token: 'play-integrity-token', expireTimeMillis: 1_900_000_000_000 });
    expect(native.installPlayIntegrity).toHaveBeenCalledTimes(1);
    expect(native.installPlayIntegrity.mock.invocationCallOrder[0]).toBeLessThan(native.getAppCheckToken.mock.invocationCallOrder[0]!);
    expect(native.getAppCheckToken).toHaveBeenCalledWith(false);
    expect(mod.appCheckStatus()).toEqual({ status: 'active', detail: undefined });

    await providerGetToken()();
    expect(native.installPlayIntegrity).toHaveBeenCalledTimes(1);
    expect(native.getAppCheckToken).toHaveBeenCalledTimes(2);
  });

  it('reports error with the reason when Play Integrity gives no token, and passes the failure to the SDK', async () => {
    const native = fakeNano();
    native.getAppCheckToken.mockRejectedValue(new Error('App attestation failed'));
    const mod = await load(native);
    mod.setupAppCheck(fakeApp);
    await expect(providerGetToken()()).rejects.toThrow('App attestation failed');
    expect(mod.appCheckStatus()).toEqual({ status: 'error', detail: 'Play Integrity gave no token: App attestation failed' });
  });

  it('is unsupported without the native module, and asks for nothing', async () => {
    const mod = await load();
    mod.setupAppCheck(fakeApp);
    expect(mod.appCheckStatus().status).toBe('unsupported_on_platform');
    expect(mod.appCheckStatus().detail).toMatch(/Play Integrity.*kalam-nano/);
    expect(sdk.initializeAppCheck).not.toHaveBeenCalled();
    expect(await mod.appCheckReady(10)).toBe(true);
  });

  it('is not configured without the Android app id, and does not install Play Integrity', async () => {
    vi.stubEnv('EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID', '');
    const native = fakeNano();
    const mod = await load(native);
    mod.setupAppCheck(fakeApp);
    expect(mod.appCheckStatus()).toEqual({ status: 'not_configured', detail: expect.stringMatching(/EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID/) });
    expect(native.installPlayIntegrity).not.toHaveBeenCalled();
    expect(sdk.initializeAppCheck).not.toHaveBeenCalled();
  });

  it('reports a native start-up failure as error, and tries the install again on the next request', async () => {
    const native = fakeNano();
    native.installPlayIntegrity.mockImplementationOnce(() => { throw new Error('FirebaseApp kalam not initialised'); });
    const mod = await load(native);
    expect(() => mod.setupAppCheck(fakeApp)).not.toThrow();
    await expect(providerGetToken()()).rejects.toThrow('FirebaseApp kalam not initialised');
    expect(native.getAppCheckToken).not.toHaveBeenCalled();
    expect(mod.appCheckStatus()).toEqual({ status: 'error', detail: 'Play Integrity gave no token: FirebaseApp kalam not initialised' });
    await providerGetToken()();
    expect(native.installPlayIntegrity).toHaveBeenCalledTimes(2);
    expect(mod.appCheckStatus().status).toBe('active');
  });
});

describe('App Check (Android): appCheckReady bounds the token wait', () => {
  it('waits for a token on the App Check instance', async () => {
    const instance = { fake: true };
    sdk.initializeAppCheck.mockReturnValue(instance);
    sdk.getToken.mockResolvedValue({ token: 'abc' });
    const mod = await load(fakeNano());
    mod.setupAppCheck(fakeApp);
    expect(await mod.appCheckReady(5_000)).toBe(true);
    expect(sdk.getToken).toHaveBeenCalledWith(instance);
  });

  it('gives up after the budget so a stuck attestation cannot stall the AI request', async () => {
    sdk.initializeAppCheck.mockReturnValue({ fake: true });
    sdk.getToken.mockReturnValue(new Promise(() => {}));
    const mod = await load(fakeNano());
    mod.setupAppCheck(fakeApp);
    vi.useFakeTimers();
    const pending = mod.appCheckReady(8_000);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await pending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
