/**
 * The single Firebase initialisation (docs/04 §15.2, docs/07 §9.1). Lazy: nothing touches Firebase
 * until an AI feature asks, so local app use never waits on it. Only public EXPO_PUBLIC_* identifiers
 * live here; provider secrets (Claude/Nebius) stay server-side.
 */
import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { setupAppCheck } from './app-check';

export { appCheckReady, appCheckStatus, type AppCheckStatus } from './app-check';

// Expo inlines EXPO_PUBLIC_* only when each variable is referenced literally.
const config: FirebaseOptions = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | undefined;

export function isFirebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId && config.appId);
}

export function getFirebaseApp(): FirebaseApp | undefined {
  if (app) return app;
  if (!isFirebaseConfigured()) return undefined;
  const existing = getApps()[0]; // fast refresh keeps the default app alive
  app = existing ?? initializeApp(config);
  if (!existing) setupAppCheck(app); // App Check before the first AI request picks up its token
  return app;
}
