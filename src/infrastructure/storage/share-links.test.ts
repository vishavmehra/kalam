import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { StoredApp } from '@/core/contracts';
import type { KalamCollection, KalamSpec } from '@/core/spec/schema';
import { validateSpec } from '@/core/spec/validate';
import { createShareService, ShareStoreError, type ShareLink } from '@/core/share';
import { createWebDatabase } from './database.web';
import { createKalamDatabase, type KalamLocalDatabase } from './kalam-database';
import { createSqliteDriver, type SqlDatabase } from './sqlite-driver';

const SENTINEL = 'SENTINEL-OMEGA-552';

const customers: KalamCollection = {
  label: 'Customers',
  fields: {
    name: { type: 'text', label: 'Name' },
    phone: { type: 'text', label: 'Phone' },
    city: { type: 'enum', label: 'City', options: ['Delhi', 'Pune'] },
  },
};
const orders: KalamCollection = {
  label: 'Orders',
  fields: {
    customer_name: { type: 'text', label: 'Customer name', required: true },
    phone: { type: 'text', label: 'Phone' },
    city: { type: 'enum', label: 'City', options: ['Delhi'] },
  },
};

/** A design that passes the real validator: one screen with one list of the given collection. */
function design(id: string, name: string, collectionId: string, collection: KalamCollection): KalamSpec {
  const spec = {
    id, schemaVersion: '1.0.0', version: 1, name, lang: 'en',
    theme: { primary: '#315C4C', radius: 12, fontScale: 1 },
    collections: { [collectionId]: collection },
    screens: [{ id: 'home', title: name, children: [{ id: 'all', type: 'list', source: collectionId, primary: Object.keys(collection.fields)[0] }] }],
    initialScreen: 'home', actions: {}, aiBlocks: {}, intents: {}, meta: { createdAt: 1 },
  };
  const checked = validateSpec(spec);
  if (!checked.ok || !checked.spec) throw new Error(`test design invalid: ${JSON.stringify(checked.errors)}`);
  return checked.spec;
}
const app = (spec: KalamSpec): StoredApp => ({ id: spec.id, spec, createdAt: 1, updatedAt: 1, origin: { route: 'manual' } });

const C = 'app_customers';
const O = 'app_orders';
const X = 'app_stranger';

const link = (patch: Partial<ShareLink> = {}): ShareLink => ({
  id: 'lnk_integration01', contractId: 'customers-orders-v1', contractVersion: 1,
  sourceAppId: C, sourceCollection: 'customers', destinationAppId: O, destinationCollection: 'orders',
  fields: [{ source: 'name', target: 'customer_name', type: 'text' }, { source: 'phone', target: 'phone', type: 'text' }],
  access: 'read', status: 'active', createdAt: 5, audit: [{ at: 5, kind: 'created' }], ...patch,
});

/** expo-sqlite's async surface over Node's built-in SQLite. */
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

type Backend = [string, () => { db: KalamLocalDatabase; sql?: ReturnType<typeof nodeSql> }];
/** A clock that moves one tick per call, so entries keep the order they were made in. */
const ticking = () => {
  let t = 1_000;
  return { now: () => ++t };
};
const backends: Backend[] = [
  ['web (Dexie)', () => ({ db: createWebDatabase(`share-${Date.now()}-${Math.random()}`, ticking()) })],
  [
    'Android (SQLite)',
    () => {
      const sql = nodeSql();
      return { db: createKalamDatabase(createSqliteDriver(async () => sql), ticking()), sql };
    },
  ],
];

async function seed(db: KalamLocalDatabase) {
  for (const spec of [design(C, 'Customer Book', 'customers', customers), design(O, 'Order Book', 'orders', orders), design(X, 'Stranger', 'customers', customers)]) {
    await db.apps.save(app(spec), { summary: 'Created', source: 'create' });
  }
}

describe.each(backends)('share links store on %s', (_name, open) => {
  it('keeps links, finds them from either app and refuses what is not a link', async () => {
    const { db } = open();
    await seed(db);
    await db.shareLinks.put(link());
    await db.shareLinks.put(link({ id: 'lnk_integration02', sourceAppId: X, createdAt: 9 }));

    expect((await db.shareLinks.list()).map((l) => l.id)).toEqual(['lnk_integration02', 'lnk_integration01']);
    expect((await db.shareLinks.forApp(C)).map((l) => l.id)).toEqual(['lnk_integration01']);
    expect((await db.shareLinks.forApp(O)).map((l) => l.id)).toEqual(['lnk_integration02', 'lnk_integration01']);
    expect(await db.shareLinks.get('lnk_integration01')).toEqual(link());
    expect(await db.shareLinks.get('lnk_missing')).toBeUndefined();

    await expect(db.shareLinks.put({ ...link(), fields: [] })).rejects.toBeInstanceOf(ShareStoreError);
    await expect(db.shareLinks.put({ ...link(), extra: 'script' } as ShareLink)).rejects.toBeInstanceOf(ShareStoreError);
    await expect(db.shareLinks.put(link({ id: 'lnk_integration03', destinationAppId: 'app_gone' }))).rejects.toThrow('not on this device');
    expect(await db.shareLinks.list()).toHaveLength(2);

    await db.shareLinks.remove('lnk_integration02');
    expect(await db.shareLinks.list()).toHaveLength(1);
  });

  it('deleting either app deletes its links and tells subscribers', async () => {
    const { db } = open();
    await seed(db);
    await db.shareLinks.put(link());
    await db.shareLinks.put(link({ id: 'lnk_integration02', sourceAppId: X }));
    await db.shareLinks.put(link({ id: 'lnk_integration03', sourceAppId: O, destinationAppId: X, sourceCollection: 'orders', destinationCollection: 'customers', fields: [{ source: 'phone', target: 'phone', type: 'text' }] }));
    let told = 0;
    const off = db.shareLinks.subscribe(() => told++);

    await db.apps.remove(C); // source of link 1
    expect((await db.shareLinks.list()).map((l) => l.id).sort()).toEqual(['lnk_integration02', 'lnk_integration03']);
    await db.apps.remove(X); // source of 2, destination of 3
    expect(await db.shareLinks.list()).toEqual([]);
    expect(told).toBe(2);
    off();
    await db.apps.remove(O);
    expect(told).toBe(2);
  });

  it('a backup restore that replaces an app also drops its links, and nothing else', async () => {
    const { db } = open();
    await seed(db);
    await db.shareLinks.put(link());
    await db.shareLinks.put(link({ id: 'lnk_integration02', sourceAppId: X }));
    const all = await db.readBackupData();
    // A backup of the customer app alone, restored over it.
    const data = {
      ...all,
      apps: all.apps.filter((a) => a.id === C), versions: all.versions.filter((v) => v.appId === C),
      records: all.records.filter((r) => r.appId === C), state: all.state.filter((x) => x.appId === C),
    };
    await db.writeBackupData(data, { replaceAppIds: [C], replaceDrawingIds: [] });
    expect((await db.shareLinks.list()).map((l) => l.id)).toEqual(['lnk_integration02']);
  });

  it('a turned off link stays off, even when an older copy of it is saved later', async () => {
    const { db } = open();
    await seed(db);
    await db.shareLinks.put(link());
    await db.shareLinks.put(link({ status: 'revoked', revokedAt: 9 }));
    await expect(db.shareLinks.put(link())).rejects.toBeInstanceOf(ShareStoreError);
    expect(await db.shareLinks.get('lnk_integration01')).toMatchObject({ status: 'revoked', revokedAt: 9 });
    // Records about a turned off link can still be added to it.
    await db.shareLinks.put(link({ status: 'revoked', revokedAt: 9, audit: [{ at: 5, kind: 'created' }, { at: 10, kind: 'sent', count: 1, updated: 0 }] }));
    expect((await db.shareLinks.get('lnk_integration01'))?.audit).toHaveLength(2);
  });

  it('a duplicate of an app starts with no links', async () => {
    const { db } = open();
    await seed(db);
    await db.shareLinks.put(link());
    const copy = await db.duplicate(C);
    expect(await db.shareLinks.forApp(copy.id)).toEqual([]);
  });

  it('works end to end: view, keep read only, send with the destination checking every entry', async () => {
    const { db } = open();
    await seed(db);
    let n = 0;
    const events: unknown[] = [];
    const service = createShareService({
      store: db.shareLinks, apps: db.apps, records: db.records, newId: () => `real${String(++n).padStart(8, '0')}`, log: (e) => events.push(e),
    });
    await db.records.insert(C, 'customers', { name: 'Asha', phone: '111', city: 'Delhi' });
    await db.records.insert(C, 'customers', { name: SENTINEL });
    await db.records.insert(X, 'customers', { name: 'Not yours', phone: '999' });

    // Without a link nothing crosses and the ordinary records stay walled off.
    const walled = service.sharedRecords(db.records);
    expect(await walled.list(O, 'orders')).toEqual([]);
    expect(await service.readFrom(O, C, 'customers')).toMatchObject({ ok: false, reason: 'no_link' });

    const view = await service.create({
      sourceAppId: C, sourceCollection: 'customers', destinationAppId: O, destinationCollection: 'orders', access: 'read',
      fields: [{ source: 'name', target: 'customer_name' }, { source: 'phone', target: 'phone' }], confirmed: true,
    });
    expect(view.ok).toBe(true);
    const shown = await walled.list(O, 'orders');
    expect(shown.map((r) => r.values)).toEqual([{ customer_name: 'Asha', phone: '111' }, { customer_name: SENTINEL, phone: null }]);
    expect(await db.records.list(O, 'orders')).toEqual([]);
    expect((await walled.listAll(O)).orders).toHaveLength(2);
    await expect(walled.update(O, 'orders', shown[0].id, { phone: 'x' })).rejects.toThrow('Change it there');

    // The source app is edited and loses a field: the link pauses until the field is back.
    const original = (await db.apps.get(C))!;
    const noPhone = design(C, 'Customer Book', 'customers', { ...customers, fields: { name: customers.fields.name, city: customers.fields.city } });
    await db.apps.save({ ...original, spec: { ...noPhone, version: original.spec.version } }, { summary: 'Edit', source: 'edit' });
    const paused = await service.readShared(O, 'orders');
    expect(paused.rows).toEqual([]);
    expect(paused.paused[0].problems[0].code).toBe('source_field_missing');
    await db.restore(C, 1);
    expect((await service.readShared(O, 'orders')).rows).toHaveLength(2);

    // Turning the link off stops the view at once.
    expect((await service.revoke(view.ok ? view.link.id : '')).ok).toBe(true);
    expect(await walled.list(O, 'orders')).toEqual([]);

    // Sending: only a link made for it, only after the person confirms, and the destination validates.
    const send = await service.create({
      sourceAppId: C, sourceCollection: 'customers', destinationAppId: O, destinationCollection: 'orders', access: 'write',
      fields: [{ source: 'name', target: 'customer_name' }, { source: 'city', target: 'city' }], confirmed: true,
    });
    // The destination accepts one city only, and the source offers two: the link is refused up front.
    expect(send).toMatchObject({ ok: false, reason: 'bad_fields' });
    const send2 = await service.create({
      sourceAppId: C, sourceCollection: 'customers', destinationAppId: O, destinationCollection: 'orders', access: 'write',
      fields: [{ source: 'phone', target: 'customer_name' }, { source: 'name', target: 'phone' }], confirmed: true,
    });
    expect(send2.ok).toBe(true);
    const linkId = send2.ok ? send2.link.id : '';
    const rows = await db.records.list(C, 'customers');
    // First entry has a phone, second has none: the destination requires a customer name, so it takes only the first.
    const out = await service.send(linkId, { recordIds: rows.map((r) => r.id), confirmed: true });
    expect(out).toMatchObject({ ok: false, created: 1, failed: [{ recordId: rows[1].id, reason: 'invalid' }] });
    expect((await db.records.list(O, 'orders')).map((r) => r.values)).toEqual([{ customer_name: '111', phone: 'Asha' }]);
    expect(JSON.stringify(out)).not.toContain(SENTINEL);
    expect(JSON.stringify(events)).not.toContain(SENTINEL);
    expect(JSON.stringify(await db.shareLinks.list())).not.toContain(SENTINEL);

    // Deleting the destination app takes the links with it.
    await db.apps.remove(O);
    expect(await db.shareLinks.list()).toEqual([]);
  });
});

describe('rows that are not links', () => {
  it('are left out of every read, never fixed up', async () => {
    const { db, sql } = backends[1][1]();
    await seed(db);
    await db.shareLinks.put(link());
    // A row an older or broken build could have left behind: a bigger permission than the schema allows.
    const bad = { ...link({ id: 'lnk_integration99' }), access: 'admin' };
    sql!.raw.prepare('INSERT INTO shareLinks VALUES (?, ?, ?, ?)').run(JSON.stringify(bad.id), JSON.stringify(C), JSON.stringify(O), JSON.stringify(bad));
    expect((await db.shareLinks.list()).map((l) => l.id)).toEqual(['lnk_integration01']);
    expect((await db.shareLinks.forApp(C)).map((l) => l.id)).toEqual(['lnk_integration01']);
    expect(await db.shareLinks.get('lnk_integration99')).toBeUndefined();
    // Deleting the app still clears the bad row.
    await db.apps.remove(C);
    expect((sql!.raw.prepare('SELECT COUNT(*) AS n FROM shareLinks').get() as { n: number }).n).toBe(0);
  });
});
