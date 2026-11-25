/**
 * iOS App Check (docs/04 §15.5, docs/17 §3.3). Sources, read 2026-11-25:
 * https://firebase.google.com/docs/app-check/ios/app-attest-provider (App Attest, DeviceCheck as fallback,
 * the factory set before the Firebase app is configured, App Check rejects App Attest sandbox tokens, so
 * the entitlement is "production") and https://firebase.google.com/docs/app-check/web/custom-provider.
 * Development builds use the registered debug token through the JS SDK; otherwise App Attest from the
 * native Firebase App Check SDK in the kalam-apple module, handed over by a CustomProvider. Status is
 * 'active' only after a real token (native-app-check.native.ts).
 */
import { loadKalamApple } from '../../../modules/kalam-apple';
import { createNativeAppCheck } from './native-app-check.native';

export type { AppCheckStatus } from './app-check.web';

export const { setupAppCheck, appCheckStatus, appCheckReady } = createNativeAppCheck({
  provider: 'App Attest',
  load: loadKalamApple,
  appId: () => process.env.EXPO_PUBLIC_FIREBASE_IOS_APP_ID,
  appIdHint: 'EXPO_PUBLIC_FIREBASE_IOS_APP_ID, the iOS app registered in Firebase',
  install(apple, appId) {
    // Expo inlines EXPO_PUBLIC_* only when each one is read literally.
    const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
    const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
    const gcmSenderId = process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
    if (!apiKey || !projectId || !gcmSenderId) {
      throw new Error('App Attest needs EXPO_PUBLIC_FIREBASE_API_KEY, _PROJECT_ID and _MESSAGING_SENDER_ID in this build.');
    }
    apple.installAppAttest({ apiKey, projectId, appId, gcmSenderId });
  },
});
