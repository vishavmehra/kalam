import { DatabaseSync } from 'node:sqlite';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import type { AppVersion, KalamRecord } from '@/core/contracts';
import { fixtureApp, fixtureSpec, PNG_BASE64 } from '@/core/backup/test-fixtures';
import { createWebDatabase } from './database.web';
import { TABLE_NAMES, TABLES } from './driver';
import { createKalamDatabase, RecordLimitError } from './kalam-database';
import { DatabaseTooNewError, SCHEMA_VERSION, V1_TABLES, V2_TABLES } from './migrations';
import type { ShareLink } from '@/core/share/model';
import { createSqliteDriver, createTableSql, migrateSqlite, type MigrationReport, type SqlDatabase } from './sqlite-driver';

const spec = fixtureSpec();
const app = fixtureApp(spec);
const version1: AppVersion = { appId: spec.id, version: 1, createdAt: 1, kind: 'snapshot', snapshot: spec, summary: 'Created', source: 'create' };
const record: KalamRecord = { id: 'r1', appId: spec.id, collectionId: 'expenses', createdAt: 1, updatedAt: 1, values: { title: 'Tea', amount: 2 } };
const oldDrawing = { id: 'drw_old', title: 'Old sketch', createdAt: 1, updatedAt: 1, pages: [] };
const otherApp = fixtureApp(fixtureSpec('app_second', 'Second'));
const sharing: ShareLink = {
  id: 'lnk_migration01', contractId: 'expenses-expenses-v1', contractVersion: 1, sourceAppId: spec.id, sourceCollection: 'expenses',
  destinationAppId: otherApp.id, destinationCollection: 'expenses', fields: [{ source: 'title', target: 'title', type: 'text' }],
  access: 'read', status: 'active', createdAt: 7, audit: [{ at: 7, kind: 'created' }],
};

/** expo-sqlite's async surface over Node's built-in SQLite, so the real SQL runs in tests. */
function nodeSql(db = new DatabaseSync(':memory:')): SqlDatabase & { raw: DatabaseSync } {
  return {
    raw: db,
    execAsync: async (sql) => void db.exec(sql),
    runAsync: async (sql, params) => db.prepare(sql).run(...params),
    getFirstAsync: async <T>(sql: string, params: Array<string | number | null>) => (db.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T>(sql: string, params: Array<string | number | null>) => db.prepare(sql).all(...params) as T[],
    withTransactionAsync: async (task) => {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

/** A database exactly as a wave-1 build left it: v1 tables, rows, no user_version. */
function legacySqlite(drawingJson = JSON.stringify(oldDrawing)) {
  const sql = nodeSql();
  sql.raw.exec(V1_TABLES.flatMap(createTableSql).join('\n'));
  const insert = (table: string, cols: Array<string | null>) =>
    sql.raw.prepare(`INSERT INTO ${table} VALUES (${cols.map(() => '?').join(', ')})`).run(...cols);
  const j = JSON.stringify;
  insert('apps', [j(app.id), j(app)]);
  insert('versions', [j([spec.id, 1]), j(spec.id), j(version1)]);
  insert('records', [j(record.id), j(record.appId), j([record.appId, record.collectionId]), j(record)]);
  insert('drawings', [j(oldDrawing.id), drawingJson]);
  return sql;
}

const tablesIn = (sql: ReturnType<typeof nodeSql>) =>
  (sql.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name).sort();
const userVersion = (sql: ReturnType<typeof nodeSql>) => (sql.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

describe('web (Dexie) upgrade v1 → v2', () => {
  it('keeps every wave-1 row, stamps old drawings and adds the new stores', async () => {
    const name = `migrate-web-${Date.now()}`;
    const old = new Dexie(name);
    old.version(1).stores(Object.fromEntries(V1_TABLES.map((t) => [t, [TABLES[t].key, ...TABLES[t].indexes].join(', ')])));
    await old.open();
    await old.table('apps').put(app);
    await old.table('versions').put(version1);
    await old.table('records').put(record);
    await old.table('drawings').put(oldDrawing);
    await old.table('settings').put({ id: 'me', settings: { onboarded: true } });
    old.close();

    const db = createWebDatabase(name);
    expect((await db.apps.get(spec.id))?.spec.name).toBe('Expenses');
    expect(await db.records.list(spec.id, 'expenses')).toEqual([record]);
    expect((await db.versions.materialize(spec.id, 1))?.id).toBe(spec.id);
    expect((await db.settings.get()).onboarded).toBe(true);
    expect((await db.drawings.get('drw_old'))?.schemaVersion).toBe(1);
    await db.blobs.put({ id: 'p1', kind: 'image', mimeType: 'image/png', base64: PNG_BASE64, ownerId: spec.id });
    expect((await db.blobs.usage()).count).toBe(1);

    const raw = new Dexie(name);
    await raw.open();
    expect(raw.verno).toBe(SCHEMA_VERSION);
    expect(raw.tables.map((t) => t.name).sort()).toEqual([...TABLE_NAMES].sort());
    raw.close();
    // Opening again runs nothing and loses nothing.
    expect((await createWebDatabase(name).records.list(spec.id, 'expenses'))).toHaveLength(1);
  });
});

describe('Android (SQLite) migration runner', () => {
  it('creates a new database at the current version', async () => {
    const sql = nodeSql();
    expect(await migrateSqlite(sql)).toEqual({ from: 0, to: SCHEMA_VERSION, ran: [] });
    expect(userVersion(sql)).toBe(SCHEMA_VERSION);
    expect(tablesIn(sql)).toEqual([...TABLE_NAMES].sort());
    expect(await migrateSqlite(sql)).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION, ran: [] });
  });

  it('upgrades a wave-1 database in place, then every repository works on real SQLite', async () => {
    const sql = legacySqlite();
    let report: MigrationReport | undefined;
    let clock = 5;
    const db = createKalamDatabase(createSqliteDriver(async () => sql, (r) => (report = r)), { now: () => ++clock, aiCacheCap: 2, recordCap: 2 });

    expect((await db.apps.get(spec.id))?.spec.name).toBe('Expenses');
    expect(report).toEqual({ from: 1, to: SCHEMA_VERSION, ran: [2] });
    expect(userVersion(sql)).toBe(SCHEMA_VERSION);
    expect(await db.records.list(spec.id, 'expenses')).toEqual([record]);
    expect((await db.drawings.get('drw_old'))?.schemaVersion).toBe(1);

    // Record cap uses COUNT on the compound index column.
    await db.records.insert(spec.id, 'expenses', { title: 'Bus', amount: 1 });
    await expect(db.records.insert(spec.id, 'expenses', { title: 'Rice', amount: 1 })).rejects.toBeInstanceOf(RecordLimitError);

    // Files: compound index, usage without loading files, owner cascade.
    await db.blobs.put({ id: 'p1', kind: 'image', mimeType: 'image/png', base64: PNG_BASE64, ownerId: spec.id });
    await db.blobs.put({ id: 'p2', kind: 'image', mimeType: 'image/png', base64: PNG_BASE64 });
    expect(await db.blobs.usage()).toEqual({ count: 2, bytes: 136 });
    expect((await db.usage()).apps[0].fileBytes).toBe(68);

    // LRU at times 9, 10, 11: the oldest is "9", although "10" sorts first as text.
    const meta = { taskType: 'classify' as const, source: 'on_device' as const };
    expect(clock).toBe(8);
    await db.aiCache.set('a', 1, meta);
    await db.aiCache.set('b', 2, meta);
    await db.aiCache.set('c', 3, meta);
    expect(await db.aiCache.get('a')).toBeUndefined();
    expect(await db.aiCache.get('b')).toBe(2);

    await db.translations.put({ appId: spec.id, version: 1, lang: 'hi', sourceHash: 'h', strings: { name: 'x' }, createdAt: 1, source: 'cloud' });
    await db.sessions.save({ id: 's_1', state: 'draft', createdAt: clock, updatedAt: clock, text: 'x', attachmentIds: [] });
    expect((await db.sessions.latest())?.id).toBe('s_1');

    await db.apps.remove(spec.id);
    expect(await db.blobs.get('p1')).toBeUndefined();
    expect(await db.translations.listForApp(spec.id)).toEqual([]);
  });

  it('rolls the whole upgrade back when a migration fails', async () => {
    const sql = legacySqlite('this is not json');
    const db = createKalamDatabase(createSqliteDriver(async () => sql));
    await expect(db.apps.list()).rejects.toThrow();
    expect(userVersion(sql)).toBe(0);
    expect(tablesIn(sql)).toEqual([...V1_TABLES].sort());
  });

  it('refuses data written by a newer Kalam', async () => {
    const sql = nodeSql();
    sql.raw.exec('PRAGMA user_version = 99');
    await expect(migrateSqlite(sql)).rejects.toBeInstanceOf(DatabaseTooNewError);
  });
});

describe('upgrade v2 → v3 (app-to-app sharing links)', () => {
  it('web: adds the links store, keeps every row, and links work afterwards', async () => {
    const name = `migrate-web-v2-${Date.now()}`;
    const storesFor = (names: readonly (typeof TABLE_NAMES)[number][]) =>
      Object.fromEntries(names.map((n) => [n, [TABLES[n].key, ...TABLES[n].indexes].join(', ')]));
    const old = new Dexie(name);
    old.version(1).stores(storesFor(V1_TABLES));
    old.version(2).stores(storesFor(V2_TABLES.filter((n) => !V1_TABLES.includes(n))));
    await old.open();
    expect(old.tables.map((t) => t.name)).not.toContain('shareLinks');
    await old.table('apps').put(app);
    await old.table('apps').put(otherApp);
    await old.table('records').put(record);
    await old.table('drawings').put({ ...oldDrawing, schemaVersion: 1 });
    await old.table('blobs').put({ id: 'p9', kind: 'image', mimeType: 'image/png', base64: PNG_BASE64, bytes: 68, createdAt: 1, ownerId: spec.id });
    old.close();

    const db = createWebDatabase(name);
    expect(await db.shareLinks.list()).toEqual([]);
    expect(await db.records.list(spec.id, 'expenses')).toEqual([record]);
    expect((await db.blobs.get('p9'))?.bytes).toBe(68);
    expect((await db.drawings.get('drw_old'))?.schemaVersion).toBe(1);

    await db.shareLinks.put(sharing);
    expect((await db.shareLinks.forApp(otherApp.id)).map((l) => l.id)).toEqual(['lnk_migration01']);

    const raw = new Dexie(name);
    await raw.open();
    expect(raw.verno).toBe(SCHEMA_VERSION);
    expect(raw.tables.map((t) => t.name).sort()).toEqual([...TABLE_NAMES].sort());
    raw.close();
    // Opening again runs nothing and loses nothing.
    expect(await createWebDatabase(name).shareLinks.list()).toHaveLength(1);
  });

  it('web: a wave-1 database goes through both steps in one open', async () => {
    const name = `migrate-web-v1-v3-${Date.now()}`;
    const old = new Dexie(name);
    old.version(1).stores(Object.fromEntries(V1_TABLES.map((t) => [t, [TABLES[t].key, ...TABLES[t].indexes].join(', ')])));
    await old.open();
    await old.table('apps').put(app);
    await old.table('apps').put(otherApp);
    await old.table('drawings').put(oldDrawing);
    old.close();
    const db = createWebDatabase(name);
    expect((await db.drawings.get('drw_old'))?.schemaVersion).toBe(1);
    await db.shareLinks.put(sharing);
    expect(await db.shareLinks.list()).toHaveLength(1);
    // Deleting an app takes its links (and nothing else) with it.
    await db.apps.remove(otherApp.id);
    expect(await db.shareLinks.list()).toEqual([]);
    expect(await db.apps.get(spec.id)).toBeDefined();
  });

  it('Android: creates the missing table in one step, no data migration, and keeps every row', async () => {
    const sql = nodeSql();
    sql.raw.exec(V2_TABLES.flatMap(createTableSql).join(' '));
    sql.raw.exec('PRAGMA user_version = 2');
    const j = JSON.stringify;
    const put = (table: string, cols: Array<string | null>) =>
      sql.raw.prepare(`INSERT INTO ${table} VALUES (${cols.map(() => '?').join(', ')})`).run(...cols);
    put('apps', [j(app.id), j(app)]);
    put('apps', [j(otherApp.id), j(otherApp)]);
    put('records', [j(record.id), j(record.appId), j([record.appId, record.collectionId]), j(record)]);
    put('drawings', [j(oldDrawing.id), j({ ...oldDrawing, schemaVersion: 1 })]);
    expect(tablesIn(sql)).not.toContain('shareLinks');

    let report: MigrationReport | undefined;
    const db = createKalamDatabase(createSqliteDriver(async () => sql, (r) => (report = r)));
    expect(await db.records.list(spec.id, 'expenses')).toEqual([record]);
    expect(report).toEqual({ from: 2, to: SCHEMA_VERSION, ran: [] });
    expect(userVersion(sql)).toBe(SCHEMA_VERSION);
    expect(tablesIn(sql)).toEqual([...TABLE_NAMES].sort());

    await db.shareLinks.put(sharing);
    expect((await db.shareLinks.get('lnk_migration01'))?.contractId).toBe('expenses-expenses-v1');
    await db.apps.remove(spec.id);
    expect(await db.shareLinks.list()).toEqual([]);
    expect(await db.apps.get(otherApp.id)).toBeDefined();

    // A second open changes nothing.
    expect(await migrateSqlite(sql)).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION, ran: [] });
  });
});
