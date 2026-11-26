import { createFlushRegistry } from './lifecycle.shared';

/** Web: the tab is hidden (switching tabs, locking the phone) or the page is being closed or frozen. */
export function onSuspend(callback: () => void): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  const hidden = () => {
    if (document.visibilityState === 'hidden') callback();
  };
  document.addEventListener('visibilitychange', hidden);
  // Safari and mobile browsers may skip visibilitychange when a tab is discarded; pagehide still fires.
  window.addEventListener('pagehide', callback);
  return () => {
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', callback);
  };
}

export const lifecycle = createFlushRegistry(onSuspend);
