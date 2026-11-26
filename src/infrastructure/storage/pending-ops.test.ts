import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { fixtureApp, fixtureSpec, PNG_BASE64 } from '@/core/backup/test-fixtures';
import type { NetworkMonitor } from '@/core/contracts';
import { createOperationQueue, type OpHandler } from '@/core/queue';
import type { PendingOperation } from '@/core/queue/model';
import { createWebDatabase } from './database.web';
import { TABLES } from './driver';
import { createKalamDatabase, type KalamLocalDatabase } from './kalam-database';
import { SCHEMA_VERSION, V1_TABLES, V2_TABLES, V3_TABLES } from './migrations';
import { createSqliteDriver, createTableSql, migrateSqlite, type SqlDatabase } from './sqlite-driver';

const spec = fixtureSpec();
const app = fixtureApp(spec);
const other = fixtureApp(fixtureSpec('app_second', 'Second'));

const row = (patch: Partial<PendingOperation> = {}): PendingOperation => ({
  id: 'op_1', kind: 'translate', status: 'waiting_for_network', payloadRef: spec.id, appId: spec.id, dedupeKey: `translate:${spec.id}:hi`,
  sends: ['labels'], params: { lang: 'hi' }, createdAt: 10, updatedAt: 10, retryCount: 0, ...patch,
});

/** expo-sqlite's async surface over Node's built-in SQLite, so the real SQL runs in tests. */
function nodeSql(db: DatabaseSync): SqlDatabase & { raw: DatabaseSync } {
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

const sqliteDb = (sql: SqlDatabase) => createKalamDatabase(createSqliteDriver(async () => sql));
const webDb = () => createWebDatabase(`pending-${Date.now()}-${Math.random()}`);

describe.each([
  ['web (Dexie)', async () => webDb()],
  ['Android (SQLite)', async () => sqliteDb(nodeSql(new DatabaseSync(':memory:')))],
])('pendingOps repository on %s', (_name, open) => {
  const seed = async (db: KalamLocalDatabase) => {
    await db.apps.save(app, { summary: 'Created', source: 'create' });
    await db.apps.save(other, { summary: 'Created', source: 'create' });
  };

  it('stores, reads, lists and removes a row, and tells subscribers', async () => {
    const db = await open();
    let heard = 0;
    db.pendingOps.subscribe(() => (heard += 1));
    await db.pendingOps.put(row());
    await db.pendingOps.put(row({ id: 'op_2', dedupeKey: 'x' }));
    expect((await db.pendingOps.get('op_1'))?.params).toEqual({ lang: 'hi' });
    expect((await db.pendingOps.list()).map((o) => o.id).sort()).toEqual(['op_1', 'op_2']);
    await db.pendingOps.remove('op_1');
    expect(await db.pendingOps.get('op_1')).toBeUndefined();
    expect(heard).toBe(3);
  });

  it('refuses a malformed row', async () => {
    const db = await open();
    await expect(db.pendingOps.put({ ...row(), kind: 'edit' } as unknown as PendingOperation)).rejects.toThrow();
    await expect(db.pendingOps.put({ ...row(), params: { a: { b: 1 } } } as unknown as PendingOperation)).rejects.toThrow();
    expect(await db.pendingOps.list()).toEqual([]);
  });

  it('deleting an app removes its queued work and the files that work kept, and no one else\'s', async () => {
    const db = await open();
    await seed(db);
    await db.pendingOps.put(row({ id: 'op_a', appId: spec.id, snapshot: '{"in":1}' }));
    await db.pendingOps.put(row({ id: 'op_b', appId: other.id, dedupeKey: 'b' }));
    await db.pendingOps.put(row({ id: 'op_build', kind: 'compile', appId: undefined, dedupeKey: 'c' }));
    await db.blobs.put({ id: 'op_a.photo', kind: 'image', mimeType: 'image/png', base64: PNG_BASE64, ownerId: 'op_a' });
    await db.blobs.put({ id: 'op_b.photo', kind: 'image', mimeType: 'image/png', base64: PNG_BASE64, ownerId: 'op_b' });
    let heard = 0;
    db.pendingOps.subscribe(() => (heard += 1));
    await db.apps.remove(spec.id);
    expect((await db.pendingOps.list()).map((o) => o.id).sort()).toEqual(['op_b', 'op_build']);
    expect(await db.blobs.get('op_a.photo')).toBeUndefined();
    expect(await db.blobs.get('op_b.photo')).toBeDefined();
    expect(heard).toBeGreaterThan(0);
  });

  it('"remove unused files" keeps files a queued operation owns, and sweeps them once it is gone', async () => {
    const db = await open();
    await db.pendingOps.put(row({ id: 'op_build', kind: 'compile', appId: undefined, dedupeKey: 'c' }));
    await db.blobs.put({ id: 'op_build.photo', kind: 'image', mimeType: 'image/png', base64: PNG_BASE64, ownerId: 'op_build' });
    await db.blobs.put({ id: 'stray', kind: 'image', mimeType: 'image/png', base64: PNG_BASE64, ownerId: 'nobody' });
    expect((await db.usage()).unusedFiles.owners).toEqual(['nobody']);
    expect(await db.removeUnusedFiles()).toBe(1);
    expect(await db.blobs.get('op_build.photo')).toBeDefined();
    await db.pendingOps.remove('op_build');
    expect(await db.removeUnusedFiles()).toBe(1);
    expect(await db.blobs.get('op_build.photo')).toBeUndefined();
  });
});

describe('upgrade to schema v4 keeps everything and adds the table', () => {
  it('web: a v3 database opens at v4 with its rows intact', async () => {
    const name = `pending-up-${Date.now()}`;
    const old = new Dexie(name);
    const stores = (names: readonly (keyof typeof TABLES)[]) => Object.fromEntries(names.map((n) => [n, [TABLES[n].key, ...TABLES[n].indexes].join(', ')]));
    old.version(1).stores(stores(V1_TABLES));
    old.version(2).stores(stores(V2_TABLES.filter((n) => !V1_TABLES.includes(n))));
    old.version(3).stores(stores(V3_TABLES));
    await old.open();
    await old.table('apps').put(app);
    expect(old.tables.map((t) => t.name)).not.toContain('pendingOps');
    old.close();

    const db = createWebDatabase(name);
    expect((await db.apps.get(spec.id))?.spec.name).toBe('Expenses');
    expect(await db.pendingOps.list()).toEqual([]);
    await db.pendingOps.put(row());
    const raw = new Dexie(name);
    await raw.open();
    expect(raw.verno).toBe(SCHEMA_VERSION);
    expect(raw.tables.map((t) => t.name)).toContain('pendingOps');
    raw.close();
    expect(await createWebDatabase(name).pendingOps.list()).toHaveLength(1);
  });

  it('Android: a v3 database gains the table, keeps its rows and records the new version', async () => {
    const raw = new DatabaseSync(':memory:');
    const sql = nodeSql(raw);
    const v3 = [...V1_TABLES, ...V2_TABLES.filter((n) => !V1_TABLES.includes(n)), ...V3_TABLES];
    raw.exec(v3.flatMap(createTableSql).join('\n') + '\nPRAGMA user_version = 3;');
    raw.prepare('INSERT INTO apps VALUES (?, ?)').run(JSON.stringify(app.id), JSON.stringify(app));
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'pendingOps'").all()).toEqual([]);

    expect(await migrateSqlite(sql)).toEqual({ from: 3, to: SCHEMA_VERSION, ran: [] });
    const db = sqliteDb(sql);
    expect((await db.apps.get(spec.id))?.spec.name).toBe('Expenses');
    await db.pendingOps.put(row());
    // A row written by a bug or a newer build is skipped on read, never trusted.
    raw.prepare('INSERT INTO pendingOps (k, i0, v) VALUES (?, ?, ?)').run('"junk"', null, JSON.stringify({ id: 'junk', kind: 'edit' }));
    expect((await db.pendingOps.list()).map((o) => o.id)).toEqual(['op_1']);
    expect(await db.pendingOps.get('junk')).toBeUndefined();
  });
});

describe('Android process kill (docs/15 §10.7 durable snapshots, pending operation states)', () => {
  it('a queued operation survives the app being killed and runs when it is back online', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kalam-queue-'));
    const file = join(dir, 'kalam.db');
    let second: DatabaseSync | undefined;
    try {
      // First run: offline, the person queues a translation, then the process dies (no stop, no close handler).
      const first = new DatabaseSync(file);
      const db1 = sqliteDb(nodeSql(first));
      await db1.apps.save(app, { summary: 'Created', source: 'create' });
      let online = false;
      const listeners = new Set<(o: boolean) => void>();
      const network: NetworkMonitor = { online: () => online, subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)) };
      const never: OpHandler = async () => {
        throw new Error('must not run offline');
      };
      const q1 = createOperationQueue({ store: db1.pendingOps, network, handlers: { translate: never } });
      await q1.start();
      const queued = await q1.enqueue({ kind: 'translate', payloadRef: spec.id, appId: spec.id, dedupeKey: 'k', sends: ['labels'], params: { lang: 'hi' } });
      expect(queued.status).toBe('waiting_for_network');
      // The attempt that was running when the process died: a row stuck in `processing`.
      await db1.pendingOps.put({ ...queued, id: 'op_midflight', dedupeKey: 'mid', status: 'processing' });
      first.close();

      // Second run: a new process opens the same file.
      second = new DatabaseSync(file);
      const db2 = sqliteDb(nodeSql(second));
      const ran: string[] = [];
      const q2 = createOperationQueue({
        store: db2.pendingOps, network,
        handlers: { translate: async (o) => (ran.push(o.id), { ok: true }) },
      });
      await q2.start();
      const afterStart = await q2.list();
      expect(Object.fromEntries(afterStart.map((o) => [o.id, o.status]))).toEqual({ [queued.id]: 'waiting_for_network', op_midflight: 'waiting_for_network' });
      expect(ran).toEqual([]); // still offline: nothing is sent

      online = true;
      for (const l of listeners) l(true);
      await q2.pump();
      expect(ran.sort()).toEqual([queued.id, 'op_midflight'].sort());
      expect((await q2.list()).every((o) => o.status === 'completed')).toBe(true);
    } finally {
      second?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
