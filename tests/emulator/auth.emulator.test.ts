/**
 * Kalam's Auth service (src/infrastructure/firebase/auth-core.ts, the real code and the real Firebase SDK) against the
 * Auth emulator, plus the hand-off to Cloud Functions: what a signed-in session can and cannot do (docs/13 §10.1,
 * docs/11 §9). Signing in is required to use Kalam; a guest session left by an older build is upgraded in place.
 */
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import { afterAll, describe, expect, it } from 'vitest';
import { createAuthService } from '@/infrastructure/firebase/auth-core';
import { AUTH_HOST, PASSWORD, PROJECT, callFunction, tokenClaims } from './emulator';

const apps: FirebaseApp[] = [];
function freshAuth(host = AUTH_HOST): Auth {
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` }, `auth-${apps.length}-${Math.random()}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${host}`, { disableWarnings: true });
  return auth;
}
const email = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}@example.com`;

afterAll(async () => { await Promise.all(apps.map((a) => deleteApp(a))); });

describe('email accounts through the real auth service', () => {
  it('signs up, names the person, and the ID token says "password"', async () => {
    const auth = freshAuth();
    const svc = createAuthService({ getAuth: () => auth });
    await svc.ready();
    expect(svc.current()).toBeNull();

    const r = await svc.signUpWithEmail(email('ada'), PASSWORD, '  Ada Lovelace  ');
    expect(r.ok).toBe(true);
    expect(r.user).toMatchObject({ isAnonymous: false, displayName: 'Ada Lovelace', providers: ['password'] });
    expect(svc.current()?.uid).toBe(r.user?.uid);

    const claims = tokenClaims(await auth.currentUser!.getIdToken());
    expect(claims.firebase.sign_in_provider).toBe('password');
    expect(claims.user_id ?? claims.sub).toBe(r.user?.uid);
  });

  it('signs out, signs back in to the same account, and tells subscribers', async () => {
    const auth = freshAuth();
    const svc = createAuthService({ getAuth: () => auth });
    const address = email('grace');
    const created = await svc.signUpWithEmail(address, PASSWORD);
    const seen: Array<string | null> = [];
    const stop = svc.subscribe((u) => seen.push(u?.uid ?? null));

    await svc.signOut();
    expect(svc.current()).toBeNull();
    const back = await svc.signInWithEmail(`  ${address}  `, PASSWORD); // spaces around the address are trimmed
    expect(back.ok).toBe(true);
    expect(back.user?.uid).toBe(created.user?.uid);
    stop();
    expect(seen).toContain(null);
    expect(seen.at(-1)).toBe(created.user?.uid);
  });

  it('answers failures in plain codes, and never says which half was wrong', async () => {
    const auth = freshAuth();
    const svc = createAuthService({ getAuth: () => auth });
    const address = email('linus');
    await svc.signUpWithEmail(address, PASSWORD);
    await svc.signOut();

    const wrongPassword = await svc.signInWithEmail(address, 'not-the-password');
    const unknownPerson = await svc.signInWithEmail(email('nobody'), PASSWORD);
    expect(wrongPassword).toMatchObject({ ok: false, errorCode: 'invalid_credentials' });
    expect(unknownPerson).toMatchObject({ ok: false, errorCode: 'invalid_credentials' });
    expect(unknownPerson.message).toBe(wrongPassword.message);
    expect(svc.current()).toBeNull();

    expect(await svc.signUpWithEmail(address, PASSWORD)).toMatchObject({ ok: false, errorCode: 'email_in_use' });
    expect(await svc.signUpWithEmail(email('weak'), '123')).toMatchObject({ ok: false, errorCode: 'weak_password' });
    expect(await svc.signUpWithEmail('not-an-email', PASSWORD)).toMatchObject({ ok: false, errorCode: 'invalid_email' });
    for (const bad of [wrongPassword.message, unknownPerson.message]) expect(bad).not.toMatch(/auth\/|firebase/i);
  });

  it('upgrades a guest session left by an older build in place, keeping the uid', async () => {
    const auth = freshAuth();
    const guest = (await signInAnonymously(auth)).user;
    const svc = createAuthService({ getAuth: () => auth });
    await svc.ready();
    expect(svc.current()).toMatchObject({ uid: guest.uid, isAnonymous: true });

    const r = await svc.signUpWithEmail(email('upgraded'), PASSWORD, 'Upgraded');
    expect(r.ok).toBe(true);
    expect(r.user).toMatchObject({ uid: guest.uid, isAnonymous: false });
    expect(tokenClaims(await auth.currentUser!.getIdToken(true)).firebase.sign_in_provider).toBe('password');
  });

  it('reports "offline" when the Auth service cannot be reached', async () => {
    const svc = createAuthService({ getAuth: () => freshAuth('127.0.0.1:1') });
    expect(await svc.signInWithEmail(email('offline'), PASSWORD)).toMatchObject({ ok: false, errorCode: 'offline' });
  });

  it('without Google support, Google sign-in fails softly', async () => {
    const svc = createAuthService({ getAuth: () => freshAuth() });
    expect(svc.supportsGoogle()).toBe(false);
    expect((await svc.signInWithGoogle()).errorCode).toBe('unsupported');
  });
});

describe('what a session may do in Cloud Functions', () => {
  it('a signed-in account can open its wallet; the same call with no session is refused', async () => {
    const auth = freshAuth();
    const svc = createAuthService({ getAuth: () => auth });
    await svc.signUpWithEmail(email('wallet'), PASSWORD);
    const idToken = await auth.currentUser!.getIdToken();

    const signedIn = await callFunction('kalamBazaarWallet', {}, { uid: auth.currentUser!.uid, idToken, refreshToken: '' });
    expect(signedIn.ok, JSON.stringify(signedIn.error)).toBe(true);
    expect(signedIn.result).toMatchObject({ credits: 100, created: true });

    const signedOut = await callFunction('kalamBazaarWallet', {});
    expect(signedOut.ok).toBe(false);
    expect(signedOut.error).toMatchObject({ status: 'UNAUTHENTICATED', message: 'Sign in to use credits.' });
  });

  it('a guest session is refused for credits', async () => {
    const auth = freshAuth();
    const guest = (await signInAnonymously(auth)).user;
    const r = await callFunction('kalamBazaarWallet', {}, { uid: guest.uid, idToken: await guest.getIdToken(), refreshToken: '' });
    expect(r.error?.status).toBe('PERMISSION_DENIED');
    expect(r.error?.message).toMatch(/guest/i);
  });
});
