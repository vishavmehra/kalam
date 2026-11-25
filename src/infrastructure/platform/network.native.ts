import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network';
import type { NetworkMonitor } from '@/core/contracts';

let instance: NetworkMonitor | undefined;

/** "Unknown" counts as online so a slow first probe never blocks cloud features. */
const isOnline = (s: NetworkState) => s.isConnected !== false && s.isInternetReachable !== false;

/** Android: expo-network state cached synchronously, updated by the native listener. */
export function getNetworkMonitor(): NetworkMonitor {
  if (instance) return instance;
  let online = true;
  const listeners = new Set<(online: boolean) => void>();
  const set = (next: boolean) => {
    if (next === online) return;
    online = next;
    for (const l of listeners) l(next);
  };
  getNetworkStateAsync().then((s) => set(isOnline(s)), () => {});
  addNetworkStateListener((s) => set(isOnline(s)));
  instance = {
    online: () => online,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return instance;
}
