import type { NetworkMonitor } from '@/core/contracts';

let instance: NetworkMonitor | undefined;

/** Web: `navigator.onLine` + online/offline events. Safe in non-browser environments (always online). */
export function getNetworkMonitor(): NetworkMonitor {
  if (instance) return instance;
  const hasWindow = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  instance = {
    online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    subscribe(listener) {
      if (!hasWindow) return () => {};
      const on = () => listener(true);
      const off = () => listener(false);
      window.addEventListener('online', on);
      window.addEventListener('offline', off);
      return () => {
        window.removeEventListener('online', on);
        window.removeEventListener('offline', off);
      };
    },
  };
  return instance;
}
