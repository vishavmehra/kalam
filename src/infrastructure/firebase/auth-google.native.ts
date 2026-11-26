/**
 * Android and iOS: "Continue with Google" through the native Google Sign-In SDK, then Firebase Auth with
 * `signInWithCredential(GoogleAuthProvider.credential(idToken))`. The ID token is minted for Kalam's web
 * OAuth client (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID), which is what Firebase verifies; iOS also needs its own
 * client (EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID) and the reversed URL scheme from google-signin.plugin.js.
 *
 * Accounts stay optional (lead decision 8). Nothing here runs until the person taps the button, and no token,
 * email or name is ever logged.
 */
import { GoogleAuthProvider, linkWithCredential, signInWithCredential, type Auth, type User } from 'firebase/auth';
import { Platform } from 'react-native';

import { authErrorCode } from './auth-core';

type GoogleModule = typeof import('@react-native-google-signin/google-signin');

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || undefined;
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || undefined;

/** An error carrying a Firebase-style code, so `authErrorCode()` in auth-core maps it to a plain message. */
const coded = (code: string) => Object.assign(new Error(code), { code });

let configured = false;

function googleModule(): GoogleModule {
  try {
    // Loaded on first tap: a build without the native module (Expo Go) still starts and offers email.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-google-signin/google-signin') as GoogleModule;
  } catch {
    throw coded('auth/operation-not-supported-in-this-environment');
  }
}

async function googleIdToken(): Promise<string> {
  const { GoogleSignin, isErrorWithCode, statusCodes } = googleModule();
  if (!configured) {
    GoogleSignin.configure({ webClientId, iosClientId, scopes: ['profile', 'email'] });
    configured = true;
  }
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Forget the last account so the chooser always opens (like `prompt: select_account` on the web).
    await GoogleSignin.signOut().catch(() => null);
    const response = await GoogleSignin.signIn();
    if (response.type !== 'success') throw coded('auth/user-cancelled');
    const token = response.data.idToken;
    if (!token) throw coded('auth/invalid-credential');
    return token;
  } catch (e) {
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS) throw coded('auth/user-cancelled');
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) throw coded('auth/operation-not-supported-in-this-environment');
    }
    throw e;
  }
}

/**
 * The platform Google step for `createAuthService({ google })`. A saved anonymous session from an older build is linked so its uid (likes,
 * reports) is kept; if that Google account already exists, Kalam signs in to it instead.
 */
async function signInWithGoogle(auth: Auth, guest: User | null): Promise<User> {
  const credential = GoogleAuthProvider.credential(await googleIdToken());
  if (!guest) return (await signInWithCredential(auth, credential)).user;
  try {
    return (await linkWithCredential(guest, credential)).user;
  } catch (e) {
    if (authErrorCode(e) === 'email_in_use') return (await signInWithCredential(auth, credential)).user;
    throw e;
  }
}

/**
 * Undefined when this build has no web client id (or, on iOS, no iOS client id and so no URL scheme from the
 * config plugin), so the sign-in sheet hides the Google button.
 */
export const nativeGoogle: ((auth: Auth, guest: User | null) => Promise<User>) | undefined =
  webClientId && (Platform.OS !== 'ios' || iosClientId) ? signInWithGoogle : undefined;

/** Also forgets the Google account on the device. Safe to call when Google was never used. */
export async function nativeGoogleSignOut(): Promise<void> {
  if (!configured) return;
  await googleModule().GoogleSignin.signOut().catch(() => null);
}
