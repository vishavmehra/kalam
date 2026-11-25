/**
 * Android storage: expo-sqlite (async API) through the shared SQLite driver. The schema is migrated on
 * first use (`migrateSqlite`, PRAGMA user_version) before any other statement runs.
 */
import { getRandomBytes, randomUUID } from 'expo-crypto';
import { openDatabaseAsync } from 'expo-sqlite';
import { createKalamDatabase, type KalamLocalDatabase } from './kalam-database';
import { createSqliteDriver } from './sqlite-driver';

export function createNativeDatabase(fileName = 'kalam.db'): KalamLocalDatabase {
  return createKalamDatabase(createSqliteDriver(() => openDatabaseAsync(fileName)), { newId: randomUUID });
}

let instance: KalamLocalDatabase | undefined;

export function getDatabase(): KalamLocalDatabase {
  return (instance ??= createNativeDatabase());
}

/** Hermes has no crypto.getRandomValues; expo-crypto reads the OS secure random source. */
export const secureRandomBytes = (length: number): Uint8Array => getRandomBytes(length);

export {
  InvalidSpecError, RecordLimitError, RecordValidationError, BlobTooLargeError, isRecordLimitError,
} from './kalam-database';
export type { ImportSummary, KalamLocalDatabase, StorageUsage } from './kalam-database';
