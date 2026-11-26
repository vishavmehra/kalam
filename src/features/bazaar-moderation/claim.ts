/**
 * Whether the signed-in account carries the `kalamModerator` claim. The owner sets it with the Admin SDK; a
 * client cannot. This only decides what to show: the trusted functions check the claim again on every call.
 */
import { getAuth } from 'firebase/auth';
import { useEffect, useState } from 'react';

import { getFirebaseApp } from '@/infrastructure/firebase/app';
import { getServices } from '@/services';

import { isModeratorClaims } from './model';

/** `forceRefresh` asks Firebase for a fresh token, for a claim set after sign-in. It needs a connection. */
export async function readModeratorClaim(forceRefresh = false): Promise<boolean> {
  try {
    if (!getServices().auth.isConfigured()) return false; // also makes sure Auth is started on phones
    const app = getFirebaseApp();
    const user = app ? getAuth(app).currentUser : null;
    if (!user || user.isAnonymous) return false;
    const token = await user.getIdTokenResult(forceRefresh).catch(() => user.getIdTokenResult(false)); // offline: use the saved token
    return isModeratorClaims(token.claims);
  } catch {
    return false;
  }
}

/** `checking` is true until the claim has been read, so a moderator does not flash a "not allowed" page. */
export function useIsModerator(uid: string | undefined, forceRefresh = false): { moderator: boolean; checking: boolean } {
  const [state, setState] = useState<{ uid?: string; moderator: boolean; done: boolean }>({ moderator: false, done: false });
  useEffect(() => {
    let alive = true;
    if (!uid) { setState({ moderator: false, done: true }); return; }
    void readModeratorClaim(forceRefresh).then((moderator) => { if (alive) setState({ uid, moderator, done: true }); });
    return () => { alive = false; };
  }, [uid, forceRefresh]);
  return { moderator: state.moderator && state.uid === uid, checking: !state.done || (state.uid !== uid && !!uid) };
}
