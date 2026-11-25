/**
 * SQLite storage driver (Android via expo-sqlite). Pure TypeScript over a tiny `SqlDatabase` port, so
 * the same code runs against `node:sqlite` in Vitest. Each table is (k primary key, i0..iN index
 * columns, v JSON). All access is serialised through one queue so a transaction never interleaves
 * with other statements (expo-sqlite transactions are not exclusive on a shared connection).
 */
import { TABLES, TABLE_NAMES, keyPathValue, type StorageDriver, type StorageTables, type StoreKey, type StoreTable, type TableName } from './driver';
import { DatabaseTooNewError, runDataMigrations, SCHEMA_VERSION } from './migrations';

export type SqlValue = string | number | null;

/** The subset of expo-sqlite's `SQLiteDatabase` this driver uses (array-parameter forms only). */
export interface SqlDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlValue[]): Promise<unknown>;
  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/** Runs one statement group: queued outside a transaction, directly inside one. */
type Run = <R>(task: (db: SqlDatabase) => Promise<R>) => Promise<R>;

const enc = (v: unknown) => JSON.stringify(v);

/** Index column value. Like IndexedDB, a row with a missing (compound) key part is not indexed. */
function indexValue(path: string, row: object): SqlValue {
  const v = keyPathValue(path, row);
  if (v === undefined || (Array.isArray(v) && v.some((p) => p === undefined))) return null;
  return enc(v);
}

function tableLayout(name: TableName): { key: string; indexes: readonly string[] } {
  return TABLES[name];
}

export function createTableSql(name: TableName): string[] {
  const { indexes } = tableLayout(name);
  const cols = indexes.map((_, i) => `, i${i} TEXT`).join('');
  return [
    `CREATE TABLE IF NOT EXISTS ${name} (k TEXT PRIMARY KEY NOT NULL${cols}, v TEXT NOT NULL);`,
    ...indexes.map((_, i) => `CREATE INDEX IF NOT EXISTS ${name}_i${i} ON ${name} (i${i});`),
  ];
}

function sqliteTable<T extends object>(name: TableName, run: Run): StoreTable<T> {
  const { key, indexes } = tableLayout(name);
  const column = (index: string) => {
    const i = indexes.indexOf(index);
    if (i < 0) throw new Error(`No index ${index} on ${name}`);
    return `i${i}`;
  };
  const parse = (rows: Array<{ v: string }>) => rows.map((r) => JSON.parse(r.v) as T);
  const cols = ['k', ...indexes.map((_, i) => `i${i}`), 'v'];
  const insert = `INSERT OR REPLACE INTO ${name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return {
    get: (k) =>
      run(async (db) => {
        const row = await db.getFirstAsync<{ v: string }>(`SELECT v FROM ${name} WHERE k = ?`, [enc(k)]);
        return row ? (JSON.parse(row.v) as T) : undefined;
      }),
    put: (row) =>
      run(async (db) => {
        const values = [enc(keyPathValue(key, row)), ...indexes.map((ix) => indexValue(ix, row)), JSON.stringify(row)];
        await db.runAsync(insert, values);
      }),
    delete: (k) => run(async (db) => void (await db.runAsync(`DELETE FROM ${name} WHERE k = ?`, [enc(k)]))),
    where: (index, value) =>
      run(async (db) => parse(await db.getAllAsync<{ v: string }>(`SELECT v FROM ${name} WHERE ${column(index)} = ?`, [enc(value)]))),
    deleteWhere: (index, value) =>
      run(async (db) => void (await db.runAsync(`DELETE FROM ${name} WHERE ${column(index)} = ?`, [enc(value)]))),
    countWhere: (index, value) =>
      run(async (db) =>
        (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${name} WHERE ${column(index)} = ?`, [enc(value)]))?.n ?? 0),
    indexKeys: (index) =>
      run(async (db) => {
        const col = column(index);
        const rows = await db.getAllAsync<{ x: string }>(`SELECT ${col} AS x FROM ${name} WHERE ${col} IS NOT NULL`, []);
        return rows.map((r) => JSON.parse(r.x) as StoreKey);
      }),
    oldestKeys: (index, limit) =>
      run(async (db) => {
        const col = column(index);
        const rows = await db.getAllAsync<{ k: string }>(
          `SELECT k FROM ${name} WHERE ${col} IS NOT NULL ORDER BY CAST(${col} AS REAL) ASC LIMIT ?`,
          [Math.max(0, Math.floor(limit))],
        );
        return rows.map((r) => JSON.parse(r.k) as StoreKey);
      }),
    all: () => run(async (db) => parse(await db.getAllAsync<{ v: string }>(`SELECT v FROM ${name}`, []))),
    count: () => run(async (db) => (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${name}`, []))?.n ?? 0),
    clear: () => run(async (db) => void (await db.runAsync(`DELETE FROM ${name}`, []))),
  };
}

export function makeSqliteTables(run: Run): StorageTables {
  return Object.fromEntries(TABLE_NAMES.map((n) => [n, sqliteTable(n, run)])) as unknown as StorageTables;
}

export interface MigrationReport {
  /** Schema version found on disk (0 = new database). */
  from: number;
  to: number;
  /** Data migrations that ran. */
  ran: number[];
}

/**
 * Database initialisation (docs/09 §9.3): verify the schema version, refuse data from a newer build,
 * then create missing tables, run pending data migrations and record the new version atomically.
 */
export async function migrateSqlite(db: SqlDatabase): Promise<MigrationReport> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  const stored = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))?.user_version ?? 0;
  if (stored > SCHEMA_VERSION) throw new DatabaseTooNewError(stored);
  let from = stored;
  if (from === 0) {
    // Wave-1 builds created their tables without ever setting user_version.
    const legacy = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'apps'",
      [],
    );
    if (legacy) from = 1;
  }
  if (from === SCHEMA_VERSION) return { from, to: SCHEMA_VERSION, ran: [] };
  let ran: number[] = [];
  await db.withTransactionAsync(async () => {
    await db.execAsync(TABLE_NAMES.flatMap(createTableSql).join('\n'));
    if (from > 0) ran = await runDataMigrations(makeSqliteTables((task) => task(db)), from);
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  });
  return { from, to: SCHEMA_VERSION, ran };
}

/**
 * Storage driver over a lazily opened SQLite database. `open` runs once; the schema is migrated
 * before the first statement, and every statement (including migrations) goes through one queue.
 */
export function createSqliteDriver(
  open: () => Promise<SqlDatabase>,
  onMigrated?: (report: MigrationReport) => void,
): StorageDriver {
  const ready = open().then(async (db) => {
    const report = await migrateSqlite(db);
    onMigrated?.(report);
    return db;
  });
  let queue: Promise<unknown> = Promise.resolve();
  const serial: Run = (task) => {
    const result = queue.then(async () => task(await ready));
    queue = result.catch(() => undefined);
    return result;
  };
  return {
    tables: makeSqliteTables(serial),
    transaction: (fn) =>
      serial(async (db) => {
        let result!: Awaited<ReturnType<typeof fn>>;
        await db.withTransactionAsync(async () => {
          result = await fn(makeSqliteTables((task) => task(db)));
        });
        return result;
      }),
  };
}
