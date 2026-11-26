import type { Auth, User } from 'firebase/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { KalamUser } from '@/core/contracts';
import { gateState, type GateInput } from '@/features/auth/gate-logic';
import { createAuthCache, createAuthService, parseCachedUser, type KeyValueStore } from './auth-core';

// Firebase answers in these tests only when the test says so, which is what an offline reload looks like:
// the saved session is restored after a network check that does not come back for about 30 seconds.
const firebase = vi.hoisted(() => ({ listener: undefined as ((u: unknown) => void) | undefined, signOut: vi.fn(async () => {}) }));
vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/auth')>()),
  onAuthStateChanged: (_a: unknown, cb: (u: unknown) => void) => { firebase.listener = cb; return () => {}; },
  signOut: firebase.signOut,
}));

const fakeAuth = {} as Auth;
const person: KalamUser = { uid: 'u1', isAnonymous: false, displayName: 'Asha', email: 'asha@example.com', providers: ['google.com'] };
const fbUser = (over: Partial<User> = {}) => ({ uid: 'u1', isAnonymous: false, displayName: 'Asha', email: 'asha@example.com', providerData: [{ providerId: 'google.com' }], ...over }) as unknown as User;

function memoryStore(initial?: string, asyncReads = false): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set('kalam.auth.last-user.v1', initial);
  return {
    data,
    getItem: (k) => (asyncReads ? Promise.resolve(data.get(k) ?? null) : (data.get(k) ?? null)),
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}
const serviceWith = (store: KeyValueStore) => createAuthService({ getAuth: () => fakeAuth, cache: createAuthCache(() => store) });

/** What the root layout feeds the gate: the user, and "restoring" while Firebase has not answered. */
function gate(auth: ReturnType<typeof serviceWith>, restoring: boolean, over: Partial<GateInput> = {}) {
  return gateState({ configured: true, restoring, user: auth.current(), onboarded: true, pathname: '/', diagnosticsAllowed: false, ...over });
}

beforeEach(() => {
  firebase.listener = undefined;
  firebase.signOut.mockClear();
});

describe('reload while offline (Firebase has not restored the session yet)', () => {
  it('opens the shelf at once for a person who signed in before, without waiting for Firebase', () => {
    const store = memoryStore(JSON.stringify(person));
    const auth = serviceWith(store);
    expect(auth.current()).toEqual(person);
    expect(gate(auth, true)).toBe('open'); // still restoring: no gate, no splash
    expect(gate(auth, false)).toBe('open'); // even after the app gives up waiting
    expect(firebase.listener).toBeDefined(); // Firebase is still asked, and its answer still wins
  });

  it('shows the gate (after the quiet check) when nobody has signed in on this device', () => {
    const auth = serviceWith(memoryStore());
    expect(auth.current()).toBeNull();
    expect(gate(auth, true)).toBe('checking');
    expect(gate(auth, false)).toBe('signIn');
  });

  it('does not trust a saved guest, a damaged entry or the wrong shape', () => {
    for (const raw of [JSON.stringify({ ...person, isAnonymous: true }), '{not json', JSON.stringify({ uid: 5, isAnonymous: false }), JSON.stringify(null), '']) {
      expect(parseCachedUser(raw)).toBeNull();
      expect(serviceWith(memoryStore(raw)).current()).toBeNull();
    }
  });

  it('trusts the saved sign-in on a device too, where the saved copy is read asynchronously', async () => {
    const auth = serviceWith(memoryStore(JSON.stringify(person), true));
    const seen: Array<KalamUser | null> = [];
    auth.subscribe((u) => seen.push(u));
    expect(auth.current()).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    expect(auth.current()).toEqual(person);
    expect(seen).toEqual([person]);
    expect(gate(auth, true)).toBe('open');
  });

  it('lets Firebase win: a late saved copy never replaces its answer', async () => {
    const auth = serviceWith(memoryStore(JSON.stringify(person), true));
    auth.current();
    firebase.listener?.(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(auth.current()).toBeNull();
  });
});

describe('when Firebase does answer', () => {
  it('closes the gate again if the saved session turns out to be gone, and forgets the saved copy', () => {
    const store = memoryStore(JSON.stringify(person));
    const auth = serviceWith(store);
    auth.current();
    firebase.listener?.(null); // for example the account was disabled or signed out elsewhere
    expect(auth.current()).toBeNull();
    expect(gate(auth, false)).toBe('signIn');
    expect(store.data.size).toBe(0);
  });

  it('saves the signed-in person for the next offline start, but never a guest', () => {
    const store = memoryStore();
    const auth = serviceWith(store);
    auth.current();
    firebase.listener?.(fbUser());
    expect(parseCachedUser(store.data.get('kalam.auth.last-user.v1') ?? null)).toEqual(person);
    firebase.listener?.(fbUser({ isAnonymous: true }));
    expect(store.data.size).toBe(0);
  });

  it('forgets the saved sign-in as soon as the person signs out, even before Firebase answers', async () => {
    const store = memoryStore(JSON.stringify(person));
    const auth = serviceWith(store);
    auth.current();
    await auth.signOut();
    expect(store.data.size).toBe(0);
    expect(firebase.signOut).toHaveBeenCalledOnce();
  });

  it('keeps working when the store is blocked or full', () => {
    const broken: KeyValueStore = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('full'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    const auth = serviceWith(broken);
    expect(auth.current()).toBeNull();
    expect(() => firebase.listener?.(fbUser())).not.toThrow();
    expect(auth.current()?.uid).toBe('u1');
    const none = createAuthService({ getAuth: () => fakeAuth, cache: createAuthCache(() => { throw new Error('no storage'); }) });
    expect(none.current()).toBeNull();
  });
});
