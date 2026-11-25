import { useEffect, useState, useSyncExternalStore } from 'react';

import type { KalamUser } from '@/core/contracts';
import { getServices } from '@/services';

/** Current Firebase user (null = signed out). `restoring` is true until a saved session is read. */
export function useAuthUser(): { user: KalamUser | null; restoring: boolean; configured: boolean } {
  const auth = getServices().auth;
  const user = useSyncExternalStore(auth.subscribe, auth.current, auth.current);
  const [restoring, setRestoring] = useState(true);
  useEffect(() => {
    let alive = true;
    auth.ready().then(() => { if (alive) setRestoring(false); }, () => { if (alive) setRestoring(false); });
    return () => { alive = false; };
  }, [auth]);
  const configured = auth.isConfigured();
  return { user, restoring: configured && restoring, configured };
}

/** Name shown on shared apps: never the email address (docs/12 §13.4). */
export function publicName(user: KalamUser | null): string {
  return user?.displayName?.trim() || '';
}
