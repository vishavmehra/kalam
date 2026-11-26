/**
 * Shared Firebase Auth service (docs/04 §15.4, docs/11 §9). Platform files only decide how the
 * Auth instance is created and whether Google sign-in is possible. Signing in is required to use Kalam
 * (ADR-040); the saved session works offline. There is no guest sign-in: an anonymous session left by an
 * older build is upgraded in place when the person signs in.
 */
import {
  createUserWithEmailAndPassword, EmailAuthProvider, linkWithCredential, onAuthStateChanged,
  signInWithEmailAndPassword, signOut as fbSignOut, updateProfile, type Auth, type User,
} from 'firebase/auth';
import type { AuthErrorCode, AuthResult, AuthService, KalamUser } from '@/core/contracts';

export function toKalamUser(u: User | null): KalamUser | null {
  if (!u) return null;
  return {
    uid: u.uid,
    isAnonymous: u.isAnonymous,
    displayName: u.displayName,
    email: u.email,
    providers: u.providerData.map((p) => p.providerId),
  };
}

const CODES: Record<string, AuthErrorCode> = {
  'auth/invalid-credential': 'invalid_credentials',
  'auth/invalid-login-credentials': 'invalid_credentials',
  'auth/wrong-password': 'invalid_credentials',
  'auth/user-not-found': 'invalid_credentials',
  'auth/email-already-in-use': 'email_in_use',
  'auth/credential-already-in-use': 'email_in_use',
  'auth/account-exists-with-different-credential': 'email_in_use',
  'auth/weak-password': 'weak_password',
  'auth/password-does-not-meet-requirements': 'weak_password',
  'auth/invalid-email': 'invalid_email',
  'auth/missing-email': 'invalid_email',
  'auth/missing-password': 'invalid_credentials',
  'auth/popup-closed-by-user': 'cancelled',
  'auth/cancelled-popup-request': 'cancelled',
  'auth/user-cancelled': 'cancelled',
  'auth/popup-blocked': 'popup_blocked',
  'auth/network-request-failed': 'offline',
  'auth/too-many-requests': 'too_many_requests',
  'auth/operation-not-allowed': 'not_allowed',
  'auth/admin-restricted-operation': 'not_allowed',
  'auth/unauthorized-domain': 'unauthorized_domain',
  'auth/requires-recent-login': 'requires_recent_login',
  'auth/operation-not-supported-in-this-environment': 'unsupported',
};

export const AUTH_MESSAGES: Record<AuthErrorCode, string> = {
  not_configured: 'Accounts are not set up in this build of Kalam.',
  offline: 'You are offline. Connect to the internet to sign in.',
  cancelled: 'Sign-in was cancelled.',
  invalid_credentials: 'That email and password do not match.',
  email_in_use: 'An account with this email already exists. Sign in instead.',
  weak_password: 'Use a password with at least 6 characters.',
  invalid_email: 'Check the email address.',
  popup_blocked: 'Your browser blocked the sign-in window. Allow pop-ups for Kalam and try again.',
  unsupported: 'Google sign-in is not available in this version of Kalam. Use email instead.',
  too_many_requests: 'Too many attempts. Wait a few minutes and try again.',
  not_allowed: 'This way of signing in is turned off for Kalam.',
  unauthorized_domain: 'Sign-in does not work from this web address yet.',
  requires_recent_login: 'Please sign in again to do that.',
  unknown: 'Sign-in did not work. Please try again.',
};

export function authErrorCode(e: unknown): AuthErrorCode {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  return CODES[code] ?? 'unknown';
}

export const fail = (code: AuthErrorCode): AuthResult => ({ ok: false, errorCode: code, message: AUTH_MESSAGES[code] });

/**
 * The last signed-in account, kept on this device beside Firebase's own saved session. Firebase restores that
 * session only after a network check (reload of the user), which hangs for about 30 seconds offline. Reading this
 * copy needs no network, so a person who already signed in is let in at once. It is a hint for what to show,
 * never proof of identity: servers still see only the real Firebase token, and Firebase's answer replaces it.
 */
export interface AuthCache {
  /** Sync on the web (localStorage), async on devices (AsyncStorage). Never throws. */
  read: () => KalamUser | null | Promise<KalamUser | null>;
  /** Saves the signed-in account; null (signed out, guest or unknown) clears it. */
  write: (u: KalamUser | null) => void;
}

export interface KeyValueStore {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): unknown;
  removeItem(key: string): unknown;
}

const CACHE_KEY = 'kalam.auth.last-user.v1';
const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 320) : null);

/** The stored text is untrusted: anything that is not a plain signed-in account is dropped. */
export function parseCachedUser(raw: string | null): KalamUser | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<KalamUser> | null;
    if (!v || typeof v.uid !== 'string' || !v.uid || v.uid.length > 128 || v.isAnonymous !== false) return null;
    const providers = Array.isArray(v.providers) ? v.providers.filter((p): p is string => typeof p === 'string').slice(0, 8) : [];
    return { uid: v.uid, isAnonymous: false, displayName: text(v.displayName), email: text(v.email), providers };
  } catch {
    return null;
  }
}

export function createAuthCache(store: () => KeyValueStore | undefined): AuthCache {
  const kv = () => { try { return store(); } catch { return undefined; } };
  return {
    read() {
      try {
        const raw = kv()?.getItem(CACHE_KEY);
        return raw && typeof raw === 'object' ? raw.then(parseCachedUser, () => null) : parseCachedUser(raw ?? null);
      } catch {
        return null;
      }
    },
    write(u) {
      try {
        const s = kv();
        const done = u && !u.isAnonymous ? s?.setItem(CACHE_KEY, JSON.stringify(u)) : s?.removeItem(CACHE_KEY);
        if (done && typeof (done as Promise<unknown>).catch === 'function') (done as Promise<unknown>).catch(() => undefined);
      } catch {
        /* a full or blocked store only means the next offline start waits for Firebase */
      }
    },
  };
}

export interface AuthCoreOptions {
  /** Lazily creates the Auth instance (undefined when Firebase is not configured). */
  getAuth: () => Auth | undefined;
  /** Platform Google sign-in. Receives the saved anonymous user from an older build to link when present. */
  google?: (auth: Auth, guest: User | null) => Promise<User>;
  /** Last signed-in account, so the app opens offline without waiting for Firebase to restore its session. */
  cache?: AuthCache;
}

export function createAuthService(opts: AuthCoreOptions): AuthService {
  let current: KalamUser | null = null;
  let restored = false;
  let wired = false;
  let resolveReady: () => void = () => {};
  const readyPromise = new Promise<void>((r) => { resolveReady = r; });
  const listeners = new Set<(u: KalamUser | null) => void>();

  const emit = (u: User | null) => {
    current = toKalamUser(u);
    opts.cache?.write(current);
    for (const l of listeners) l(current);
  };

  /** Trusts the saved sign-in until Firebase answers (its answer, user or none, always wins). */
  const adopt = (u: KalamUser | null) => {
    if (!u || restored || current) return;
    current = u;
    for (const l of listeners) l(current);
  };
  const seedFromCache = () => {
    const saved = opts.cache?.read();
    if (saved && 'then' in saved) saved.then(adopt, () => undefined); // not instanceof: React Native may polyfill Promise
    else adopt(saved ?? null);
  };

  /** Starts listening the first time anyone asks; Firebase stays untouched until then. */
  function auth(): Auth | undefined {
    const a = opts.getAuth();
    if (a && !wired) {
      wired = true;
      seedFromCache();
      onAuthStateChanged(a, (u) => {
        emit(u);
        if (!restored) { restored = true; resolveReady(); }
      });
    }
    if (!a && !restored) { restored = true; resolveReady(); }
    return a;
  }

  async function run(work: (a: Auth) => Promise<User>): Promise<AuthResult> {
    const a = auth();
    if (!a) return fail('not_configured');
    try {
      const user = await work(a);
      emit(user); // profile changes (display name, linking) do not always fire onAuthStateChanged
      return { ok: true, user: toKalamUser(user) ?? undefined };
    } catch (e) {
      return fail(authErrorCode(e));
    }
  }

  return {
    isConfigured: () => !!opts.getAuth(),
    current: () => {
      auth();
      return current;
    },
    ready: () => {
      auth();
      return readyPromise;
    },
    subscribe(listener) {
      auth();
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    supportsGoogle: () => !!opts.google,
    signInWithGoogle: () => {
      const google = opts.google;
      if (!google) return Promise.resolve(fail('unsupported'));
      return run((a) => google(a, a.currentUser?.isAnonymous ? a.currentUser : null));
    },
    signInWithEmail: (email, password) =>
      run(async (a) => (await signInWithEmailAndPassword(a, email.trim(), password)).user),
    signUpWithEmail: (email, password, displayName) =>
      run(async (a) => {
        const guest = a.currentUser?.isAnonymous ? a.currentUser : null;
        const user = guest
          ? (await linkWithCredential(guest, EmailAuthProvider.credential(email.trim(), password))).user
          : (await createUserWithEmailAndPassword(a, email.trim(), password)).user;
        const name = displayName?.trim().slice(0, 40);
        if (name) await updateProfile(user, { displayName: name });
        await user.reload().catch(() => {});
        return a.currentUser ?? user;
      }),
    setDisplayName: (name) =>
      run(async (a) => {
        const user = a.currentUser;
        if (!user) throw Object.assign(new Error('Not signed in'), { code: 'auth/requires-recent-login' });
        await updateProfile(user, { displayName: name.trim().slice(0, 40) });
        return user;
      }),
    async signOut() {
      const a = auth();
      opts.cache?.write(null); // forgotten at once, so a reload right after signing out cannot open the app
      if (a) await fbSignOut(a);
    },
  };
}
