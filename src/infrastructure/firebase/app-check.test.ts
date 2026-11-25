/**
 * App Check and Firebase app initialisation tests (docs/17 §3.3, §9.3, §13.1). `firebase/app-check` and
 * `firebase/app` are mocked: they prove Kalam picks the right provider, enables the debug token only in
 * development builds, and never lets a stuck token request stall the AI call. Real token exchange is
 * verified separately (scripts/verify-firebase-ai.mjs) and is not claimed here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  initializeAppCheck: vi.fn(),
  getToken: vi.fn(),
  enterprise: vi.fn(),
  v3: vi.fn(),
  getApps: vi.fn(),
  initializeApp: vi.fn(),
  setupAppCheck: vi.fn(),
}));

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: (...args: unknown[]) => sdk.initializeAppCheck(...args),
  getToken: (...args: unknown[]) => sdk.getToken(...args),
  ReCaptchaEnterpriseProvider: class {
    readonly kind = 'enterprise';
    constructor(readonly siteKey: string) { sdk.enterprise(siteKey); }
  },
  ReCaptchaV3Provider: class {
    readonly kind = 'v3';
    constructor(readonly siteKey: string) { sdk.v3(siteKey); }
  },
}));
vi.mock('firebase/app', () => ({
  getApps: () => sdk.getApps(),
  initializeApp: (...args: unknown[]) => sdk.initializeApp(...args),
}));
// app.ts imports the './app-check' shim; the tests of app-check.web.ts import './app-check.web' directly.
vi.mock('./app-check', () => ({
  setupAppCheck: (...args: unknown[]) => sdk.setupAppCheck(...args),
  appCheckReady: async () => true,
  appCheckStatus: () => ({ status: 'not_configured' }),
}));

const DEBUG_KEY = 'FIREBASE_APPCHECK_DEBUG_TOKEN';
const debugGlobal = () => (globalThis as Record<string, unknown>)[DEBUG_KEY];
const clearDebugGlobal = () => { delete (globalThis as Record<string, unknown>)[DEBUG_KEY]; };
const fakeApp = { name: '[DEFAULT]' } as never;

beforeEach(() => {
  Object.values(sdk).forEach((fn) => fn.mockReset());
  clearDebugGlobal();
  // Start every test from a known env, whatever the developer's shell exports.
  for (const key of ['EXPO_PUBLIC_RECAPTCHA_SITE_KEY', 'EXPO_PUBLIC_APPCHECK_PROVIDER', 'EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN']) {
    vi.stubEnv(key, '');
  }
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  clearDebugGlobal();
});

/** Fresh copy of the web module: its status and instance are module state. */
async function loadWeb() {
  vi.resetModules();
  return import('./app-check.web');
}

// ─── setupAppCheck (web) ──────────────────────────────────────────────────────
describe('App Check (web): initialisation', () => {
  it('without a site key reports not_configured and does not initialise App Check', async () => {
    const mod = await loadWeb();
    mod.setupAppCheck(fakeApp);
    expect(mod.appCheckStatus().status).toBe('not_configured');
    expect(mod.appCheckStatus().detail).toMatch(/EXPO_PUBLIC_RECAPTCHA_SITE_KEY/);
    expect(sdk.initializeAppCheck).not.toHaveBeenCalled();
    expect(sdk.enterprise).not.toHaveBeenCalled();
    expect(sdk.v3).not.toHaveBeenCalled();
    expect(debugGlobal()).toBeUndefined();
  });

  it('starts as not_configured before setup runs', async () => {
    const mod = await loadWeb();
    expect(mod.appCheckStatus()).toEqual({ status: 'not_configured', detail: undefined });
  });

  it('uses reCAPTCHA Enterprise by default, with token auto-refresh', async () => {
    vi.stubEnv('EXPO_PUBLIC_RECAPTCHA_SITE_KEY', 'site-key');
    const mod = await loadWeb();
    mod.setupAppCheck(fakeApp);
    expect(sdk.enterprise).toHaveBeenCalledWith('site-key');
    expect(sdk.v3).not.toHaveBeenCalled();
    expect(sdk.initializeAppCheck).toHaveBeenCalledTimes(1);
    const [app, options] = sdk.initializeAppCheck.mock.calls[0] as [unknown, { provider: { kind: string; siteKey: string }; isTokenAutoRefreshEnabled: boolean }];
    expect(app).toBe(fakeApp);
    expect(options.provider).toMatchObject({ kind: 'enterprise', siteKey: 'site-key' });
    expect(options.isTokenAutoRefreshEnabled).toBe(true);
  });

  it('uses reCAPTCHA v3 when EXPO_PUBLIC_APPCHECK_PROVIDER=v3', async () => {
    vi.stubEnv('EXPO_PUBLIC_RECAPTCHA_SITE_KEY', 'site-key');
    vi.stubEnv('EXPO_PUBLIC_APPCHECK_PROVIDER', 'v3');
    const mod = await loadWeb();
    mod.setupAppCheck(fakeApp);
    expect(sdk.v3).toHaveBeenCalledWith('site-key');
    expect(sdk.enterprise).not.toHaveBeenCalled();
    expect((sdk.initializeAppCheck.mock.calls[0]?.[1] as { provider: { kind: string } }).provider.kind).toBe('v3');
  });

  it.each(['enterprise', 'V3', 'unknown'])('keeps Enterprise for EXPO_PUBLIC_APPCHECK_PROVIDER=%j', async (value) => {
    vi.stubEnv('EXPO_PUBLIC_RECAPTCHA_SITE_KEY', 'site-key');
    vi.stubEnv('EXPO_PUBLIC_APPCHECK_PROVIDER', value);
    const mod = await loadWeb();
    mod.setupAppCheck(fakeApp);
    expect(sdk.enterprise).toHaveBeenCalledTimes(1);
    expect(sdk.v3).not.toHaveBeenCalled();
  });

  it('reports an initialisation failure as error with the reason, without throwing', async () => {
    vi.stubEnv('EXPO_PUBLIC_RECAPTCHA_SITE_KEY', 'site-key');
    sdk.initializeAppCheck.mockImplementation(() => { throw new Error('appCheck/already-initialized'); });
    const mod = await loadWeb();
    expect(() => mod.setupAppCheck(fakeApp)).not.toThrow();
    expect(mod.appCheckStatus()).toEqual({ status: 'error', detail: 'appCheck/already-initialized' });
    // With no instance there is no token to wait for.
    expect(await mod.appCheckReady(10)).toBe(true);
    expect(sdk.getToken).not.toHaveBeenCalled();
  });

  it('stringifies a non-Error failure', async () => {
    vi.stubEnv('EXPO_PUBLIC_RECAPTCHA_SITE_KEY', 'site-key');
    sdk.initializeAppCheck.mockImplementation(() => { throw 'nope'; });
    const mod = await loadWeb();
    mod.setupAppCheck(fakeApp);
    expect(mod.appCheckStatus()).toEqual({ status: 'error', detail: 'nope' });
  });
});

// ─── Debug token: development builds only ─────────────────────────────────────
describe('App Check (web): debug token', () => {
  it('in a development build enables the debug provider with the registered token and reports debug', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EXPO_PUBLIC_RECAPTCHA_SITE_KEY', 'site-key');
    vi.stubEnv('EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN', 'registered-debug-token');
    const mod = await loadWeb();
    mod.setupAppCheck(fakeApp);
    expect(debugGlobal()).toBe('registered-debug-token');
    expect(mod.appCheckStatus().status).toBe('debug');
  });

  it('in a development build without a registered token asks the SDK to print one (true)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EXPO_PUBLIC_RECAPTCHA_SITE_KEY', 'site-key');
    const mod = await loadWeb();
    mod.setupAppCheck(fakeApp);
    expect(debugGlobal()).toBe(true);
    expect(mod.appCheckStatus().status).toBe('debug');
  });

  it('in a production build never enables the debug provider, even if a debug token is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_RECAPTCHA_SITE_KEY', 'site-key');
    vi.stubEnv('EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN', 'registered-debug-token');
    const mod = await loadWeb();
    mod.setupAppCheck(fakeApp);
    expect(debugGlobal()).toBeUndefined();
    expect(mod.appCheckStatus().status).toBe('active');
    expect(sdk.initializeAppCheck).toHaveBeenCalledTimes(1);
  });

  it('in a production build without a site key sets no debug token and reports not_configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN', 'registered-debug-token');
    const mod = await loadWeb();
    mod.setupAppCheck(fakeApp);
    expect(debugGlobal()).toBeUndefined();
    expect(mod.appCheckStatus().status).toBe('not_configured');
  });

  it('never puts the debug token or the site key into the reported status', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EXPO_PUBLIC_RECAPTCHA_SITE_KEY', 'site-key-secret-ish');
    vi.stubEnv('EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN', 'registered-debug-token');
    sdk.initializeAppCheck.mockImplementation(() => { throw new Error('init failed'); });
    const mod = await loadWeb();
    mod.setupAppCheck(fakeApp);
    const shown = JSON.stringify(mod.appCheckStatus());
    expect(shown).not.toContain('registered-debug-token');
    expect(shown).not.toContain('site-key-secret-ish');
  });
});

// ─── appCheckReady ────────────────────────────────────────────────────────────
describe('App Check (web): appCheckReady bounds the token wait', () => {
  async function withInstance() {
    vi.stubEnv('EXPO_PUBLIC_RECAPTCHA_SITE_KEY', 'site-key');
    const instance = { fakeAppCheck: true };
    sdk.initializeAppCheck.mockReturnValue(instance);
    const mod = await loadWeb();
    mod.setupAppCheck(fakeApp);
    return { mod, instance };
  }

  it('is true straight away when App Check was never set up (nothing to wait for)', async () => {
    const mod = await loadWeb();
    expect(await mod.appCheckReady(10)).toBe(true);
    expect(sdk.getToken).not.toHaveBeenCalled();
  });

  it('is true once a token arrives, asking for it on the App Check instance', async () => {
    const { mod, instance } = await withInstance();
    sdk.getToken.mockResolvedValue({ token: 'abc' });
    expect(await mod.appCheckReady(5000)).toBe(true);
    expect(sdk.getToken).toHaveBeenCalledWith(instance);
  });

  it('is true on a definite token error (the request can proceed and the server decides)', async () => {
    const { mod } = await withInstance();
    sdk.getToken.mockRejectedValue(new Error('appCheck/recaptcha-error'));
    expect(await mod.appCheckReady(5000)).toBe(true);
  });

  it('is false when no token arrives within the budget, so a stuck reCAPTCHA cannot stall the AI call', async () => {
    const { mod } = await withInstance();
    sdk.getToken.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers();
    const pending = mod.appCheckReady(8000);
    await vi.advanceTimersByTimeAsync(7_999);
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer when the token wins the race', async () => {
    const { mod } = await withInstance();
    sdk.getToken.mockResolvedValue({ token: 'abc' });
    vi.useFakeTimers();
    expect(await mod.appCheckReady(8000)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ─── Android ──────────────────────────────────────────────────────────────────
describe('App Check (Android shim)', () => {
  it('reports unsupported_on_platform honestly and never asks for a token', async () => {
    const mod = await import('./app-check.native');
    mod.setupAppCheck(fakeApp);
    expect(mod.appCheckStatus().status).toBe('unsupported_on_platform');
    expect(mod.appCheckStatus().detail).toMatch(/Play Integrity/);
    expect(await mod.appCheckReady(10)).toBe(true);
    expect(sdk.initializeAppCheck).not.toHaveBeenCalled();
    expect(sdk.getToken).not.toHaveBeenCalled();
    expect(debugGlobal()).toBeUndefined();
  });
});

// ─── Firebase app initialisation (app.ts) ─────────────────────────────────────
describe('Firebase app initialisation (app.ts)', () => {
  const CONFIG_ENV = {
    EXPO_PUBLIC_FIREBASE_API_KEY: 'test-api-key',
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'test-project',
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'test.appspot.com',
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123',
    EXPO_PUBLIC_FIREBASE_APP_ID: '1:123:web:abc',
  };
  const stubConfig = (over: Partial<Record<keyof typeof CONFIG_ENV, string>> = {}) => {
    for (const [k, v] of Object.entries({ ...CONFIG_ENV, ...over })) vi.stubEnv(k, v);
  };
  async function loadApp() {
    vi.resetModules();
    return import('./app');
  }

  it('is not configured without the public Firebase identifiers, and touches nothing', async () => {
    stubConfig({
      EXPO_PUBLIC_FIREBASE_API_KEY: '', EXPO_PUBLIC_FIREBASE_PROJECT_ID: '', EXPO_PUBLIC_FIREBASE_APP_ID: '',
    });
    const mod = await loadApp();
    expect(mod.isFirebaseConfigured()).toBe(false);
    expect(mod.getFirebaseApp()).toBeUndefined();
    expect(sdk.getApps).not.toHaveBeenCalled();
    expect(sdk.initializeApp).not.toHaveBeenCalled();
    expect(sdk.setupAppCheck).not.toHaveBeenCalled();
  });

  it.each(['EXPO_PUBLIC_FIREBASE_API_KEY', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_FIREBASE_APP_ID'] as const)(
    'is not configured when %s is missing',
    async (missing) => {
      stubConfig({ [missing]: '' });
      const mod = await loadApp();
      expect(mod.isFirebaseConfigured()).toBe(false);
      expect(mod.getFirebaseApp()).toBeUndefined();
    },
  );

  it('initialises Firebase once with the public config, then sets up App Check on the new app', async () => {
    stubConfig();
    sdk.getApps.mockReturnValue([]);
    const app = { name: '[DEFAULT]', fresh: true };
    sdk.initializeApp.mockReturnValue(app);
    const mod = await loadApp();
    expect(mod.isFirebaseConfigured()).toBe(true);

    expect(mod.getFirebaseApp()).toBe(app);
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(sdk.initializeApp).toHaveBeenCalledWith({
      apiKey: 'test-api-key', authDomain: 'test.firebaseapp.com', projectId: 'test-project',
      storageBucket: 'test.appspot.com', messagingSenderId: '123', appId: '1:123:web:abc',
    });
    expect(sdk.setupAppCheck).toHaveBeenCalledTimes(1);
    expect(sdk.setupAppCheck).toHaveBeenCalledWith(app);
    // App Check must be set up before the first AI request can pick up its token.
    expect(sdk.initializeApp.mock.invocationCallOrder[0]).toBeLessThan(sdk.setupAppCheck.mock.invocationCallOrder[0] as number);
  });

  it('returns the same app on later calls without initialising again', async () => {
    stubConfig();
    sdk.getApps.mockReturnValue([]);
    sdk.initializeApp.mockReturnValue({ name: '[DEFAULT]' });
    const mod = await loadApp();
    const first = mod.getFirebaseApp();
    expect(mod.getFirebaseApp()).toBe(first);
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(sdk.setupAppCheck).toHaveBeenCalledTimes(1);
  });

  it('reuses an app that fast refresh left alive, without initialising App Check a second time', async () => {
    stubConfig();
    const existing = { name: '[DEFAULT]', existing: true };
    sdk.getApps.mockReturnValue([existing]);
    const mod = await loadApp();
    expect(mod.getFirebaseApp()).toBe(existing);
    expect(sdk.initializeApp).not.toHaveBeenCalled();
    expect(sdk.setupAppCheck).not.toHaveBeenCalled();
  });

  it('re-exports the App Check helpers used by the AI provider', async () => {
    stubConfig();
    const mod = await loadApp();
    expect(typeof mod.appCheckReady).toBe('function');
    expect(typeof mod.appCheckStatus).toBe('function');
  });
});
