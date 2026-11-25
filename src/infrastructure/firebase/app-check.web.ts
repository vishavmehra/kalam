import type { FirebaseApp } from 'firebase/app';
import {
  getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider, type AppCheck,
} from 'firebase/app-check';

/** Shown in Settings/diagnostics so App Check state is never a silent assumption. */
export type AppCheckStatus = 'not_configured' | 'active' | 'debug' | 'unsupported_on_platform' | 'error';

let status: AppCheckStatus = 'not_configured';
let detail: string | undefined;
let instance: AppCheck | undefined;

/**
 * Web App Check (docs/04 §15.5, docs/07 §17.3). reCAPTCHA Enterprise by default,
 * `EXPO_PUBLIC_APPCHECK_PROVIDER=v3` for reCAPTCHA v3. Without a site key App Check is skipped and
 * reported as `not_configured` (requests still work unless enforcement is on in the console).
 * Dev builds only: the debug provider is enabled via `self.FIREBASE_APPCHECK_DEBUG_TOKEN` — either the
 * registered token from EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN or `true` (SDK prints a token to register).
 */
export function setupAppCheck(app: FirebaseApp): void {
  const siteKey = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY;
  if (!siteKey) {
    status = 'not_configured';
    detail = 'EXPO_PUBLIC_RECAPTCHA_SITE_KEY is not set';
    return;
  }
  const dev = process.env.NODE_ENV !== 'production';
  if (dev) {
    (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN || true;
  }
  try {
    const provider = process.env.EXPO_PUBLIC_APPCHECK_PROVIDER === 'v3'
      ? new ReCaptchaV3Provider(siteKey)
      : new ReCaptchaEnterpriseProvider(siteKey);
    instance = initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
    status = dev ? 'debug' : 'active';
    detail = undefined;
  } catch (e) {
    status = 'error';
    detail = e instanceof Error ? e.message : String(e);
  }
}

export function appCheckStatus(): { status: AppCheckStatus; detail?: string } {
  return { status, detail };
}

/**
 * Resolves `true` once App Check has produced a token (or a definite error), `false` if it is still
 * waiting after `timeoutMs`. Firebase AI Logic awaits the same token before every cloud request with
 * no timeout of its own, so a reCAPTCHA script that never loads would otherwise stall each request.
 */
export async function appCheckReady(timeoutMs: number): Promise<boolean> {
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
