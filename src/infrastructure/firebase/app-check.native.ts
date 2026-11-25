/**
 * Android App Check (docs/04 §15.5, docs/17 §3.3). Source, read 2026-11-18:
 * https://firebase.google.com/docs/app-check/android/play-integrity-provider.
 * Development builds use the registered debug token; otherwise Play Integrity from the native Firebase App
 * Check SDK in the kalam-nano module. Needs the Android app registered in Firebase
 * (EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID) with its SHA-256 fingerprint. The shared logic, including when the
 * status becomes 'active', is in native-app-check.native.ts. iOS uses app-check.ios.ts instead.
 */
import { loadKalamNano } from '../../../modules/kalam-nano';
import { createNativeAppCheck } from './native-app-check.native';

export type { AppCheckStatus } from './app-check.web';

export const { setupAppCheck, appCheckStatus, appCheckReady } = createNativeAppCheck({
  provider: 'Play Integrity',
  load: loadKalamNano,
  appId: () => process.env.EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID,
  appIdHint: 'EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID, the Android app registered in Firebase',
  install: (nano) => nano.installPlayIntegrity(),
});
