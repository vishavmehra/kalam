/**
 * PWA install offer (docs/09 §14.5, docs/03 §27.2). The browser fires `beforeinstallprompt` once,
 * early, so the listener is attached when this module first loads (the root layout imports it).
 * Native builds never see the event, so `available` stays false there.
 */
import { useSyncExternalStore } from 'react';

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // show our own button instead of the browser's mini bar
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => deferred !== null;

/** Whether Kalam can be installed right now, and a function that opens the browser's install dialog. */
export function useInstallPrompt(): { available: boolean; prompt: () => Promise<boolean> } {
  const available = useSyncExternalStore(subscribe, snapshot, () => false);
  return {
    available,
    prompt: async () => {
      const e = deferred;
      if (!e) return false;
      deferred = null;
      notify();
      await e.prompt();
      return (await e.userChoice).outcome === 'accepted';
    },
  };
}
