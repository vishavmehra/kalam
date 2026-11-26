import { describe, expect, it } from 'vitest';

import { diagnosticsAllowed, gateState, type GateInput } from './gate-logic';

const base: GateInput = {
  configured: true,
  restoring: false,
  user: null,
  onboarded: true,
  pathname: '/',
  diagnosticsAllowed: false,
};
const state = (patch: Partial<GateInput>) => gateState({ ...base, ...patch });

describe('sign-in gate', () => {
  it('asks a signed-out person to sign in before any route', () => {
    for (const pathname of ['/', '/create', '/settings', '/bazaar', '/app/abc', '/account', '/onboarding']) {
      expect(state({ pathname })).toBe('signIn');
    }
  });

  it('opens for a signed-in Google or email account', () => {
    expect(state({ user: { isAnonymous: false } })).toBe('open');
    expect(state({ user: { isAnonymous: false }, pathname: '/settings' })).toBe('open');
  });

  it('does not accept a guest account', () => {
    expect(state({ user: { isAnonymous: true } })).toBe('signIn');
    expect(state({ user: { isAnonymous: true }, restoring: true })).toBe('checking');
  });

  it('shows a quiet splash while the saved session is read, so a signed-in person never sees the form', () => {
    expect(state({ restoring: true })).toBe('checking');
    // The session arrived: no splash, no form.
    expect(state({ restoring: false, user: { isAnonymous: false } })).toBe('open');
    expect(state({ restoring: true, user: { isAnonymous: false } })).toBe('open');
  });

  it('keeps the welcome page in front of the first sign-in', () => {
    expect(state({ onboarded: false, pathname: '/onboarding' })).toBe('open');
    expect(state({ onboarded: false, pathname: '/' })).toBe('open');
    // Any other route is behind the gate even before the welcome page is done.
    expect(state({ onboarded: false, pathname: '/create' })).toBe('signIn');
    expect(state({ onboarded: false, pathname: '/app/abc' })).toBe('signIn');
  });

  it('shows the gate right after the welcome page is finished', () => {
    expect(state({ onboarded: true, pathname: '/create' })).toBe('signIn');
  });

  it('is not gated when Firebase is not set up, because nobody could sign in', () => {
    expect(state({ configured: false })).toBe('open');
    expect(state({ configured: false, restoring: true, pathname: '/create' })).toBe('open');
  });

  it('keeps the diagnostic pages open only in builds that allow them', () => {
    expect(state({ pathname: '/nano-check' })).toBe('signIn');
    expect(state({ pathname: '/lab' })).toBe('signIn');
    expect(state({ pathname: '/nano-check', diagnosticsAllowed: true })).toBe('open');
    expect(state({ pathname: '/lab', diagnosticsAllowed: true })).toBe('open');
    // Everything else stays gated, even in a diagnostics build.
    expect(state({ pathname: '/settings', diagnosticsAllowed: true })).toBe('signIn');
  });

  it('returns to the gate after sign-out, and the apps are not part of that decision', () => {
    const signedIn = state({ user: { isAnonymous: false }, pathname: '/app/abc' });
    const signedOut = state({ user: null, pathname: '/app/abc' });
    expect([signedIn, signedOut]).toEqual(['open', 'signIn']);
  });

  it('allows diagnostics in development builds and in test builds with the opt-in only', () => {
    expect(diagnosticsAllowed(true, undefined)).toBe(true);
    expect(diagnosticsAllowed(false, 'true')).toBe(true);
    expect(diagnosticsAllowed(false, 'false')).toBe(false);
    expect(diagnosticsAllowed(false, undefined)).toBe(false);
  });
});
