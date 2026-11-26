/**
 * Type and resolution shim: Metro picks auth-google.native.ts on Android and iOS. The web signs in with
 * Google through the popup in auth.web.ts, so there is no native step here.
 */
import type { Auth, User } from 'firebase/auth';

export const nativeGoogle: ((auth: Auth, guest: User | null) => Promise<User>) | undefined = undefined;

export async function nativeGoogleSignOut(): Promise<void> {}
