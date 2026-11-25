import { describe, expect, it } from 'vitest';
import { AUTH_MESSAGES, authErrorCode, createAuthService } from './auth-core';

describe('auth-core', () => {
  it('maps Firebase error codes to plain messages, never raw errors', () => {
    expect(authErrorCode({ code: 'auth/invalid-credential' })).toBe('invalid_credentials');
    expect(authErrorCode({ code: 'auth/popup-closed-by-user' })).toBe('cancelled');
    expect(authErrorCode({ code: 'auth/network-request-failed' })).toBe('offline');
    expect(authErrorCode(new Error('boom'))).toBe('unknown');
    for (const m of Object.values(AUTH_MESSAGES)) {
      expect(m).not.toMatch(/[—–]|auth\//); // copy rule: no dashes as punctuation, no Firebase codes
    }
  });

  it('is optional: without Firebase config every call fails softly and ready() resolves', async () => {
    const auth = createAuthService({ getAuth: () => undefined });
    expect(auth.isConfigured()).toBe(false);
    expect(auth.current()).toBeNull();
    await expect(auth.ready()).resolves.toBeUndefined();
    const r = await auth.signInWithEmail('a@example.com', 'secret1');
    expect(r).toMatchObject({ ok: false, errorCode: 'not_configured' });
    expect(auth.supportsGoogle()).toBe(false);
    expect((await auth.signInWithGoogle()).errorCode).toBe('unsupported');
    await expect(auth.signOut()).resolves.toBeUndefined();
  });
});
