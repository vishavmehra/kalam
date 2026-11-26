import { useSyncExternalStore } from 'react';

/**
 * "Signed out. Your apps are still on this device." has to be read on the sign-in screen itself: a toast at the top
 * of a phone would sit on the logo. Account sets the flag when the person signs out; the gate shows it and clears
 * it once someone signs in. In memory only.
 */
let signedOut = false;
const listeners = new Set<() => void>();
const set = (next: boolean) => {
  if (signedOut === next) return;
  signedOut = next;
  for (const l of listeners) l();
};

export const noteSignedOut = () => set(true);
export const clearSignedOutNote = () => set(false);

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useSignedOutNote = (): boolean => useSyncExternalStore(subscribe, () => signedOut, () => false);
