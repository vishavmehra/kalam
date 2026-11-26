/**
 * Android and iOS: Firebase Auth (JS SDK) with the session saved in AsyncStorage. Google (first in the sign-in
 * sheet) and email/password work. Google goes through the native Google Sign-In SDK
 * (auth-google.native.ts) and needs EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in the build; without it, or in a build
 * without the native module, `supportsGoogle()` is false or the tap reports 'unsupported', and email still works.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as firebaseAuth from 'firebase/auth';
import { getAuth, initializeAuth, type Auth, type Persistence } from 'firebase/auth';
import type { AuthService } from '@/core/contracts';
import { getFirebaseApp } from './app';
import { createAuthCache, createAuthService } from './auth-core';
import { nativeGoogle, nativeGoogleSignOut } from './auth-google';

// Exported only by the React Native build of firebase/auth, so it is not in the default typings.
const { getReactNativePersistence } = firebaseAuth as unknown as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
};

let service: AuthService | undefined;
let instance: Auth | undefined;

export function getAuthService(): AuthService {
  if (service) return service;
  const core = createAuthService({
    cache: createAuthCache(() => AsyncStorage),
    getAuth: () => {
      if (instance) return instance;
      const app = getFirebaseApp();
      if (!app) return undefined;
      try {
        instance = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
      } catch {
        instance = getAuth(app); // already initialised (fast refresh)
      }
      return instance;
    },
    google: nativeGoogle,
  });
  // Signing out of Kalam also forgets the Google account on the device, so the chooser opens next time.
  service = { ...core, signOut: async () => { await core.signOut(); await nativeGoogleSignOut(); } };
  return service;
}
