/** Web: Firebase Auth with browser persistence; Google sign-in through a popup. */
import {
  getAuth, GoogleAuthProvider, linkWithPopup, signInWithCredential, signInWithPopup, type Auth,
} from 'firebase/auth';
import type { AuthService } from '@/core/contracts';
import { getFirebaseApp } from './app';
import { authErrorCode, createAuthCache, createAuthService } from './auth-core';

let service: AuthService | undefined;
let instance: Auth | undefined;

export function getAuthService(): AuthService {
  if (service) return service;
  service = createAuthService({
    cache: createAuthCache(() => globalThis.localStorage),
    getAuth: () => {
      if (instance) return instance;
      const app = getFirebaseApp();
      if (app) instance = getAuth(app);
      return instance;
    },
    async google(auth, guest) {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      if (!guest) return (await signInWithPopup(auth, provider)).user;
      try {
        return (await linkWithPopup(guest, provider)).user; // keeps the guest uid (likes, listings)
      } catch (e) {
        // That Google account already exists: sign in to it instead. Guest likes stay with the guest.
        const credential = authErrorCode(e) === 'email_in_use' ? GoogleAuthProvider.credentialFromError(e as never) : null;
        if (credential) return (await signInWithCredential(auth, credential)).user;
        throw e;
      }
    },
  });
  return service;
}
