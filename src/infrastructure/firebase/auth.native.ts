/**
 * Android: Firebase Auth (JS SDK) with the session saved in AsyncStorage. Email/password and guest
 * accounts work. Google sign-in needs the native Google Sign-In SDK and the app's SHA-1 in Firebase,
 * which are not wired yet, so `supportsGoogle()` is false here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as firebaseAuth from 'firebase/auth';
import { getAuth, initializeAuth, type Auth, type Persistence } from 'firebase/auth';
import type { AuthService } from '@/core/contracts';
import { getFirebaseApp } from './app';
import { createAuthService } from './auth-core';

// Exported only by the React Native build of firebase/auth, so it is not in the default typings.
const { getReactNativePersistence } = firebaseAuth as unknown as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
};

let service: AuthService | undefined;
let instance: Auth | undefined;

export function getAuthService(): AuthService {
  if (service) return service;
  service = createAuthService({
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
  });
  return service;
}
