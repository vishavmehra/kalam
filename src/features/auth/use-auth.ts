import { useEffect, useState, useSyncExternalStore } from 'react';

import type { KalamUser } from '@/core/contracts';
import { getServices } from '@/services';

/** Set once the saved session has been read, so screens mounted later (each has its own header) skip the wait. */
let restoredOnce = false;
const RESTORE_GIVE_UP_MS = 8000;

/** Current Firebase user (null = signed out). `restoring` is true until a saved session is read. */
export function useAuthUser(): { user: KalamUser | null; restoring: boolean; configured: boolean } {
  const auth = getServices().auth;
  const user = useSyncExternalStore(auth.subscribe, auth.current, auth.current);
  const [restoring, setRestoring] = useState(!restoredOnce);
  useEffect(() => {
    let alive = true;
    const done = () => { restoredOnce = true; if (alive) setRestoring(false); };
    auth.ready().then(done, done);
    // The sign-in gate waits on this: if reading the saved session ever hangs, show the form rather than a spinner forever.
    const giveUp = setTimeout(done, RESTORE_GIVE_UP_MS);
    return () => { alive = false; clearTimeout(giveUp); };
  }, [auth]);
  const configured = auth.isConfigured();
  // A saved sign-in is trusted at once (see AuthCache), so a known account never waits on Firebase's session check.
  const known = !!user && !user.isAnonymous;
  return { user, restoring: configured && restoring && !known, configured };
}

/** Name shown on shared apps: never the email address (docs/12 §13.4). */
export function publicName(user: KalamUser | null): string {
  return user?.displayName?.trim() || '';
}
