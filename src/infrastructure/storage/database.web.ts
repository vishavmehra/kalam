/** Web storage: Dexie over IndexedDB (docs/04 §13.2). Schema versions live in `migrations.ts`. */
import Dexie, { type IndexableType, type Table } from 'dexie';
import { TABLES, TABLE_NAMES, type StorageTables, type StoreKey, type StoreTable, type TableName } from './driver';
import { createKalamDatabase, type DatabaseOptions, type KalamLocalDatabase } from './kalam-database';
import { runDataMigrations, V1_TABLES, V2_TABLES, V3_TABLES } from './migrations';

function dexieTable<T>(table: Table<T, IndexableType>): StoreTable<T> {
  return {
    get: (key) => table.get(key),
    put: async (row) => void (await table.put(row)),
    delete: (key) => table.delete(key),
    where: (index, value) => table.where(index).equals(value).toArray(),
    deleteWhere: async (index, value) => void (await table.where(index).equals(value).delete()),
    countWhere: (index, value) => table.where(index).equals(value).count(),
    indexKeys: async (index) => (await table.orderBy(index).keys()) as StoreKey[],
    oldestKeys: async (index, limit) => (await table.orderBy(index).limit(Math.max(0, limit)).primaryKeys()) as StoreKey[],
    all: () => table.toArray(),
    count: () => table.count(),
    clear: () => table.clear(),
  };
}

const storesFor = (names: readonly TableName[]) =>
  Object.fromEntries(names.map((n) => [n, [TABLES[n].key, ...TABLES[n].indexes].join(', ')]));

/**
 * Binds the tables of `source`. Inside an upgrade step only the tables that exist at that step can be
 * bound, so the step passes its own list (the migration code uses only tables that old).
 */
function bind(source: { table(name: string): Table }, names: readonly TableName[] = TABLE_NAMES): StorageTables {
  return Object.fromEntries(names.map((n) => [n, dexieTable(source.table(n))])) as unknown as StorageTables;
}

/** Opens (or creates and upgrades) a Kalam database. Tests pass a unique name (and a clock or small caps). */
export function createWebDatabase(name = 'kalam', options: DatabaseOptions = {}): KalamLocalDatabase {
  const dexie = new Dexie(name);
  // Version 1 is the wave-1 layout. Dexie keeps every existing table and its rows and only adds the
  // new stores; the upgrade callback runs once, for databases created by an older build.
  dexie.version(1).stores(storesFor(V1_TABLES));
  dexie
    .version(2)
    .stores(storesFor(V2_TABLES.filter((n) => !V1_TABLES.includes(n))))
    .upgrade(async (tx) => {
      await runDataMigrations(bind(tx, V2_TABLES), 1, 2);
    });
  // Version 3 only adds the sharing links store. Existing rows are untouched.
  dexie
    .version(3)
    .stores(storesFor(V3_TABLES))
    .upgrade(async (tx) => {
      await runDataMigrations(bind(tx), 2, 3);
    });
  return createKalamDatabase({
    tables: bind(dexie),
    // Tables are bound to the Transaction object itself: Dexie's implicit zone tracking is lost after
    // a few nested native `await`s, which silently ran later writes outside the transaction.
    transaction: (fn) => dexie.transaction('rw', dexie.tables, (tx) => fn(bind(tx))),
  }, options);
}

let instance: KalamLocalDatabase | undefined;

export function getDatabase(): KalamLocalDatabase {
  return (instance ??= createWebDatabase());
}

/** Secure random bytes for backup salts and nonces (Android: expo-crypto, see database.native.ts). */
export const secureRandomBytes = (length: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(length));

export {
  InvalidSpecError, RecordLimitError, RecordValidationError, BlobTooLargeError, isRecordLimitError,
} from './kalam-database';
export type { ImportSummary, KalamLocalDatabase, StorageUsage } from './kalam-database';
