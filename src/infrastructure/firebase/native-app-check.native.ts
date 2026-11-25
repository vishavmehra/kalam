/**
 * App Check for the native apps (docs/04 §15.5, docs/17 §3.3), feeding the JS SDK that Firebase AI Logic uses
 * for cloud requests. app-check.native.ts (Android, Play Integrity) and app-check.ios.ts (App Attest with
 * DeviceCheck as fallback) are thin configs over this. Source, read 2026-11-18:
 * https://firebase.google.com/docs/app-check/web/custom-provider.
 * - Development build with EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN: the JS SDK's debug provider exchanges the
 *   registered debug token (the same one web uses). Plain JS, so it works in Expo Go too.
 * - Otherwise: the attestation provider of the native Firebase App Check SDK in Kalam's native module,
 *   handed over by a CustomProvider. A release build never uses the debug token.
 * 'active' is reported only after the provider returned a real token. Until then the status is
 * 'not_configured' with no detail, which Settings shows as "starts with the first cloud request".
 */
import type { FirebaseApp } from 'firebase/app';
import { CustomProvider, getToken, initializeAppCheck, type AppCheck, type AppCheckToken } from 'firebase/app-check';
import type { AppCheckStatus } from './app-check.web';

export interface AttestingModule {
  getAppCheckToken(forceRefresh: boolean): Promise<{ token: string; expireTimeMillis: number }>;
}

export interface NativeAppCheckConfig<M extends AttestingModule> {
  /** "Play Integrity" or "App Attest", used in status details. */
  provider: string;
  load(): { module: M; reason?: undefined } | { module: null; reason: string };
  /** The id of this platform's app registered in Firebase. Read with a literal process.env access. */
  appId(): string | undefined;
  /** For example "EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID, the Android app registered in Firebase". */
  appIdHint: string;
  /** Installs the provider in the native Firebase App Check SDK. May throw. */
  install(module: M, appId: string): void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Never called: with a debug token set, the SDK exchanges that token instead of asking the provider. */
const debugOnly = (): Promise<AppCheckToken> => Promise.reject(new Error('App Check is in debug mode.'));

export function createNativeAppCheck<M extends AttestingModule>(cfg: NativeAppCheckConfig<M>) {
  let status: AppCheckStatus = 'not_configured';
  let detail: string | undefined;
  let instance: AppCheck | undefined;

  async function nativeToken(native: M): Promise<AppCheckToken> {
    try {
      const token = await native.getAppCheckToken(false);
      status = 'active';
      detail = undefined;
      return token;
    } catch (e) {
      status = 'error';
      detail = `${cfg.provider} gave no token: ${message(e)}`;
      throw e;
    }
  }

  function setupAppCheck(app: FirebaseApp): void {
    const dev = process.env.NODE_ENV !== 'production';
    const debugToken = process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN;
    try {
      if (dev && debugToken) {
        (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
        instance = initializeAppCheck(app, { provider: new CustomProvider({ getToken: debugOnly }), isTokenAutoRefreshEnabled: true });
        status = 'debug';
        detail = undefined;
        return;
      }
      const found = cfg.load();
      if (!found.module) {
        status = 'unsupported_on_platform';
        detail = `${cfg.provider} is not available. ${found.reason}`;
        return;
      }
      const appId = cfg.appId();
      if (!appId) {
        status = 'not_configured';
        detail = `${cfg.provider} needs ${cfg.appIdHint}.`;
        return;
      }
      const native = found.module;
      cfg.install(native, appId);
      instance = initializeAppCheck(app, {
        provider: new CustomProvider({ getToken: () => nativeToken(native) }),
        isTokenAutoRefreshEnabled: true,
      });
      status = 'not_configured';
      detail = undefined;
    } catch (e) {
      status = 'error';
      detail = message(e);
    }
  }

  function appCheckStatus(): { status: AppCheckStatus; detail?: string } {
    return { status, detail };
  }

  /**
   * Same contract as the web version: true once App Check produced a token or a definite error, false if
   * it is still waiting after `timeoutMs`, so a stuck attestation cannot stall an AI request.
   */
  async function appCheckReady(timeoutMs: number): Promise<boolean> {
    if (!instance) return true; // App Check not set up: the SDK has no token to wait for
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = getToken(instance).then(() => true, () => true);
    const late = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
    try {
      return await Promise.race([settled, late]);
    } finally {
      clearTimeout(timer);
    }
  }

  return { setupAppCheck, appCheckStatus, appCheckReady };
}
