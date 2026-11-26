/**
 * The required sign-in (owner, 2026-11-25): after the welcome page nothing opens until a real account (Google or
 * email, never a guest) is signed in. The Firebase session is saved on the device, so once signed in everything
 * works offline and the gate never asks again until the person signs out.
 *
 * Pure, so every branch is tested without React or Firebase.
 */

export type GateState =
  /** Show the app. */
  | 'open'
  /** A saved session is still being read: show a quiet splash, never the form. */
  | 'checking'
  /** Show the full-screen sign-in. */
  | 'signIn';

export interface GateInput {
  /** Firebase is set up in this build. Without it there is nothing to sign in to. */
  configured: boolean;
  /** The saved session has not been read yet. */
  restoring: boolean;
  user: { isAnonymous: boolean } | null;
  /** The welcome page has been finished once on this device. */
  onboarded: boolean;
  /** Current route, for example `/onboarding`. */
  pathname: string;
  /** Development builds and test builds made with EXPO_PUBLIC_DIAGNOSTICS=true keep /lab and /nano-check open. */
  diagnosticsAllowed: boolean;
}

/** `/` counts as the welcome page until it is finished: the index route redirects there. */
const isWelcome = (path: string) => path === '/' || path === '/onboarding';
const isDiagnostic = (path: string) => path === '/nano-check' || path === '/lab';

export function gateState(i: GateInput): GateState {
  // ponytail: a build with no Firebase cannot sign anyone in, so it is not gated (dev machines, unit tests).
  // A shipped build always has the Firebase config; upgrade to a "this build cannot sign in" screen if that changes.
  if (!i.configured) return 'open';
  if (i.user && !i.user.isAnonymous) return 'open';
  if (!i.onboarded && isWelcome(i.pathname)) return 'open';
  if (i.diagnosticsAllowed && isDiagnostic(i.pathname)) return 'open';
  return i.restoring ? 'checking' : 'signIn';
}

/** Same rule as `nanoCheckAllowed` in src/app/nano-check.tsx: a development build, or a test build with the opt-in. */
export function diagnosticsAllowed(dev: boolean, diagnostics: string | undefined): boolean {
  return dev || diagnostics === 'true';
}
