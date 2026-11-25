/**
 * Database schema versions and data migrations, shared by Dexie (web) and expo-sqlite (Android)
 * (docs/09 §9.3, §17.5). Rules: deterministic, versioned, data-preserving, never model-generated.
 *
 * - Web: Dexie runs `up()` inside its own upgrade transaction (`database.web.ts`).
 * - Android: `sqlite-driver.ts` reads `PRAGMA user_version`, creates missing tables and runs every
 *   pending `up()` plus the version bump in ONE transaction, so a failed upgrade changes nothing.
 */
import type { StorageTables, TableName } from './driver';

/** Bump when a table, an index or the meaning of stored data changes. */
export const SCHEMA_VERSION = 3;

/** Tables of the first released layout (wave 1). Later versions add tables; none were removed. */
export const V1_TABLES: readonly TableName[] = ['apps', 'versions', 'records', 'state', 'events', 'settings', 'drawings'];

/** Tables of the second layout (wave 3): the first ones plus translations, files, AI cache and sessions. */
export const V2_TABLES: readonly TableName[] = [...V1_TABLES, 'translations', 'blobs', 'aiCache', 'sessions'];

/**
 * Version 3 (wave 6) adds only the `shareLinks` table (docs/14 §16). No existing row changes, so there is
 * no data migration for it: web adds the store, Android creates the missing table in `migrateSqlite`.
 */
export const V3_TABLES: readonly TableName[] = ['shareLinks'];

export interface DataMigration {
  /** Schema version this migration upgrades TO. Runs only on databases older than this. */
  version: number;
  description: string;
  up(tables: StorageTables): Promise<void>;
}

export const DATA_MIGRATIONS: readonly DataMigration[] = [
  {
    version: 2,
    description:
      'Adds translations, blobs, AI cache and creation sessions. Stamps drawings saved before schemaVersion existed as version 1.',
    async up(tables) {
      for (const doc of await tables.drawings.all()) {
        if (doc.schemaVersion === undefined) await tables.drawings.put({ ...doc, schemaVersion: 1 });
      }
    },
  },
];

/**
 * Runs the migrations a database at `fromVersion` still needs, oldest first, up to `toVersion` (default: the
 * current schema). Dexie passes the step it is on, because only that step's tables exist inside its upgrade.
 */
export async function runDataMigrations(tables: StorageTables, fromVersion: number, toVersion = SCHEMA_VERSION): Promise<number[]> {
  const ran: number[] = [];
  for (const migration of [...DATA_MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (migration.version <= fromVersion || migration.version > toVersion) continue;
    await migration.up(tables);
    ran.push(migration.version);
  }
  return ran;
}

/** Thrown when the stored data was written by a newer Kalam build than this one. */
export class DatabaseTooNewError extends Error {
  readonly code = 'database_too_new';
  constructor(readonly storedVersion: number) {
    super('This data was saved by a newer version of Kalam. Update Kalam to open it.');
    this.name = 'DatabaseTooNewError';
  }
}
