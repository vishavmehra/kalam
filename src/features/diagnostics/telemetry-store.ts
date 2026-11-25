/**
 * Where the opt-in usage counters are kept: one small JSON text under one key, in the device's
 * key-value storage (AsyncStorage on Android and iOS, localStorage on the web). The storage is passed
 * in, so the wrapper is tested with a memory object. Reading or writing may fail; the counters
 * themselves handle that (core/telemetry/counters.ts), so nothing here throws on purpose.
 */
import type { TelemetryStore } from '@/core/telemetry';

export const TELEMETRY_STORAGE_KEY = 'kalam.telemetry.v1';

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function storageTelemetryStore(storage: KeyValueStorage, key: string = TELEMETRY_STORAGE_KEY): TelemetryStore {
  return {
    read: () => storage.getItem(key),
    write: (json) => storage.setItem(key, json),
  };
}
