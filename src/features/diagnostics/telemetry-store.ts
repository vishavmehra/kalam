/**
 * Where the opt-in usage counters are kept: one small JSON text under one key, in the device's
 * key-value storage (AsyncStorage on Android and iOS, localStorage on the web). The storage is passed
 * in, so the wrapper is tested with a memory object. Reading or writing may fail; the counters
 * themselves handle that (core/telemetry/counters.ts), so nothing here throws on purpose.
 *
 * On the web the same page can be open in two tabs. The browser tells the other tab with a `storage`
 * event whenever one tab writes, and `subscribe` passes that on, so a tab that was open before the
 * person turned counting off does not turn it back on with its old copy of the counters.
 */
import type { TelemetryStore } from '@/core/telemetry';

export const TELEMETRY_STORAGE_KEY = 'kalam.telemetry.v1';

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** The part of `window` used for `storage` events. React Native has no such events and no `addEventListener`. */
export interface StorageEventTarget {
  addEventListener?(type: 'storage', listener: (event: { key?: string | null }) => void): void;
  removeEventListener?(type: 'storage', listener: (event: { key?: string | null }) => void): void;
}

export function storageTelemetryStore(
  storage: KeyValueStorage,
  key: string = TELEMETRY_STORAGE_KEY,
  events: StorageEventTarget = globalThis as unknown as StorageEventTarget,
): TelemetryStore {
  return {
    read: () => storage.getItem(key),
    write: (json) => storage.setItem(key, json),
    subscribe(listener) {
      if (typeof events.addEventListener !== 'function') return () => undefined;
      // A null key means the whole storage was cleared, which also changes the counters.
      const onStorage = (event: { key?: string | null }) => {
        if (event.key === key || event.key === null) listener();
      };
      events.addEventListener('storage', onStorage);
      return () => events.removeEventListener?.('storage', onStorage);
    },
  };
}
