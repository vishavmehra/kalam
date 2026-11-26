/**
 * Two devices, one account: the real engine over the real device database (fake IndexedDB) and an
 * in-memory stand-in for Firestore. The Firestore adapter and the rules are tested on the emulator
 * in tests/rules/account-sync.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import { validateSpec } from '../spec/validate';
import type { KalamSpec } from '../spec/schema';
import { createAccountSync, type AccountSync } from './engine';
import { emptyLocal, remoteAppSchema, type AccountLocal, type AccountRemote, type RecordsPointer, type RemoteApp } from './model';

vi.mock('@react-native-async-storage/async-storage', () => {
  const m = new Map<string, string>();
  return { default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v), removeItem: async (k: string) => void m.delete(k) } };
});
const { createWebDatabase } = await import('@/infrastructure/storage/database.web');
type Db = ReturnType<typeof createWebDatabase>;

const checked = validateSpec(loadFixture('valid', 'expense-tracker'));
if (!checked.ok || !checked.spec) throw new Error('fixture');
const base: KalamSpec = checked.spec;
const specWith = (id: string, name = 'Expenses'): KalamSpec => ({ ...base, id, name });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cloud() {
  let clock = 1_000_000;
  let offline = false;
  const apps = new Map<string, RemoteApp>();
  const parts = new Map<string, string>();
  let pointer: RecordsPointer | null = null;
  const check = () => {
    if (offline) throw Object.assign(new Error('offline'), { code: 'unavailable' });
  };
  const remote: AccountRemote = {
    async pullApps(_uid, since) {
      check();
      return [...apps.values()].filter((d) => d.syncedAt >= since).sort((a, b) => a.syncedAt - b.syncedAt);
    },
    async putApp(_uid, id, doc) {
      check();
      apps.set(id, remoteAppSchema.parse({ ...doc, id, syncedAt: (clock += 1000) }));
    },
    async deleteApp(_uid, id) {
      check();
      apps.delete(id);
    },
    async getRecordsPointer() {
      check();
      return pointer;
    },
    async putRecordsPointer(_uid, p) {
      check();
      pointer = { ...p, updatedAt: clock };
    },
    async deleteRecordsPointer() {
      check();
      pointer = null;
    },
    async putRecordsPart(_uid, set, part, _parts, text) {
      check();
      parts.set(`${set}/${part}`, text);
    },
    async getRecordsPart(_uid, set, part) {
      check();
      return parts.get(`${set}/${part}`) ?? null;
    },
    async deleteRecordsPart(_uid, set, part) {
      parts.delete(`${set}/${part}`);
    },
  };
  return { remote, apps, parts, pointer: () => pointer, setOffline: (v: boolean) => { offline = v; } };
}

const devices: Db[] = [];
afterEach(() => {
  devices.length = 0;
});

function device(c: ReturnType<typeof cloud>, opts: { excluded?: Set<string> } = {}) {
  const db = createWebDatabase(`acct-${Math.random().toString(36).slice(2)}`);
  devices.push(db);
  const saved = new Map<string, AccountLocal>();
  let online = true;
  const changed = vi.fn();
  const sync: AccountSync = createAccountSync({
    remote: c.remote,
    store: { get: async (uid) => structuredClone(saved.get(uid) ?? emptyLocal()), put: async (uid, d) => void saved.set(uid, structuredClone(d)) },
    apps: db.apps, versions: db.versions, records: db.records, state: db.state, backup: db,
    online: () => online,
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    excluded: async () => opts.excluded ?? new Set(),
    onLocalAppsChanged: changed,
  });
  return { db, sync, saved, changed, setOnline: (v: boolean) => { online = v; } };
}

const GOOGLE = { uid: 'g-user-1', isAnonymous: false };
async function add(db: Db, id: string, name = 'Expenses') {
  return db.apps.save({ id, spec: specWith(id, name), createdAt: 1, updatedAt: 1, origin: { route: 'template' } }, { summary: 'Made', source: 'create' });
}
async function rename(db: Db, id: string, name: string) {
  const app = (await db.apps.get(id))!;
  return db.apps.save({ ...app, spec: { ...app.spec, name } }, { summary: 'Renamed', source: 'edit' });
}

describe('account sync engine', () => {
  it('uploads nothing before the person chooses, and nothing for guests', async () => {
    const c = cloud();
    const a = device(c);
    await add(a.db, 'app_one');
    await a.sync.setUser({ uid: 'guest', isAnonymous: true });
    await a.sync.sync();
    expect(a.sync.status()).toMatchObject({ phase: 'signed_out', problem: 'guest', needsPrompt: false });
    await a.sync.setUser(GOOGLE);
    expect(a.sync.status()).toMatchObject({ needsPrompt: true, phase: 'off' });
    await a.sync.sync();
    expect(c.apps.size).toBe(0);
    expect(await a.sync.setChoice('apps_records')).toEqual({ ok: false, problem: 'needs_passphrase' });
    await a.sync.notNow();
    expect(a.sync.status()).toMatchObject({ needsPrompt: false, choice: 'off' });
    await a.sync.sync();
    expect(c.apps.size).toBe(0);
  });

  it('a second device signs in and gets the apps; edits and deletes follow with history kept', async () => {
    const c = cloud();
    const a = device(c);
    const b = device(c);
    await add(a.db, 'app_one', 'Shop book');
    await add(a.db, 'app_two', 'Milk');
    await a.sync.setUser(GOOGLE);
    await a.sync.setChoice('apps');
    await a.sync.sync();
    expect([...c.apps.keys()].sort()).toEqual(['app_one', 'app_two']);
    expect(a.sync.status()).toMatchObject({ appsInAccount: 2, pending: 0, phase: 'idle' });
    expect(a.sync.appState((await a.db.apps.get('app_one'))!)).toBe('in_account');

    await b.sync.setUser(GOOGLE);
    await b.sync.setChoice('apps');
    await b.sync.sync();
    expect((await b.db.apps.list()).map((x) => x.spec.name).sort()).toEqual(['Milk', 'Shop book']);
    expect(b.changed).toHaveBeenCalled();
    expect((await b.db.versions.list('app_one'))[0].summary).toBe('Added from your account');

    // Edit on A, B follows; B keeps its earlier version in the Time Machine.
    await rename(a.db, 'app_one', 'Shop book 2026');
    await a.sync.noteLocalChange();
    expect(a.sync.status().pending).toBe(1);
    await a.sync.sync();
    await b.sync.sync();
    expect((await b.db.apps.get('app_one'))!.spec.name).toBe('Shop book 2026');
    const history = await b.db.versions.list('app_one');
    expect(history.map((v) => v.summary)).toEqual(['Updated from your account', 'Added from your account']);
    expect((await b.db.versions.materialize('app_one', history[1].version))!.name).toBe('Shop book');

    // Delete on B: tombstone in the account, gone on A (it had no records).
    await b.db.apps.remove('app_two');
    await b.sync.sync();
    expect(c.apps.get('app_two')).toMatchObject({ deleted: true, specGz: null });
    await a.sync.sync();
    expect(await a.db.apps.get('app_two')).toBeUndefined();
    expect(a.sync.status().appsInAccount).toBe(1);
  });

  it('both edited: last writer wins and the other design stays in the Time Machine', async () => {
    const c = cloud();
    const a = device(c);
    const b = device(c);
    await add(a.db, 'app_one', 'Original');
    for (const d of [a, b]) {
      await d.sync.setUser(GOOGLE);
      await d.sync.setChoice('apps');
      await d.sync.sync();
    }
    await rename(a.db, 'app_one', 'Edited on A');
    await sleep(5);
    await rename(b.db, 'app_one', 'Edited on B later');
    await a.sync.sync();
    await b.sync.sync(); // B is newer: it keeps its design and puts A's into its history
    expect((await b.db.apps.get('app_one'))!.spec.name).toBe('Edited on B later');
    const bHistory = await b.db.versions.list('app_one');
    expect(bHistory[0].summary).toBe('Kept the version from this device');
    expect((await b.db.versions.materialize('app_one', bHistory[1].version))!.name).toBe('Edited on A');
    await a.sync.sync(); // A takes B's design; A's own stays one version back
    expect((await a.db.apps.get('app_one'))!.spec.name).toBe('Edited on B later');
    const aHistory = await a.db.versions.list('app_one');
    expect((await a.db.versions.materialize('app_one', aHistory[1].version))!.name).toBe('Edited on A');
  });

  it('works offline: changes wait in the queue and go when the connection is back', async () => {
    const c = cloud();
    const a = device(c);
    await a.sync.setUser(GOOGLE);
    await a.sync.setChoice('apps');
    a.setOnline(false);
    await add(a.db, 'app_offline');
    await a.sync.noteLocalChange();
    await a.sync.sync();
    expect(a.sync.status()).toMatchObject({ phase: 'offline', pending: 1 });
    expect(c.apps.size).toBe(0);
    a.setOnline(true);
    c.setOffline(true); // the device thinks it is online, the request fails
    await a.sync.sync();
    expect(a.sync.status()).toMatchObject({ phase: 'offline', problem: 'offline', pending: 1 });
    c.setOffline(false);
    await a.sync.sync();
    expect(a.sync.status()).toMatchObject({ phase: 'idle', pending: 0 });
    expect(c.apps.has('app_offline')).toBe(true);
  });

  it('a delete made elsewhere archives an app that has records here instead of deleting them', async () => {
    const c = cloud();
    const a = device(c);
    const b = device(c);
    await add(a.db, 'app_one');
    for (const d of [a, b]) {
      await d.sync.setUser(GOOGLE);
      await d.sync.setChoice('apps');
      await d.sync.sync();
    }
    await b.db.records.insert('app_one', 'expenses', { amount: 5, note: 'tea' });
    await a.db.apps.remove('app_one');
    await a.sync.sync();
    await b.sync.sync();
    const kept = await b.db.apps.get('app_one');
    expect(kept?.archived).toBe(true);
    expect((await b.db.records.list('app_one', 'expenses')).length).toBe(1);
    await b.sync.sync();
    expect(c.apps.get('app_one')?.deleted).toBe(true); // not resurrected by the archived copy
  });

  it('keeps shared (Collaborative Apps) apps out of the account', async () => {
    const c = cloud();
    const a = device(c, { excluded: new Set(['app_shared']) });
    await add(a.db, 'app_mine');
    await add(a.db, 'app_shared');
    await a.sync.setUser(GOOGLE);
    await a.sync.setChoice('apps');
    await a.sync.sync();
    expect([...c.apps.keys()]).toEqual(['app_mine']);
  });

  it('Bazaar installs sync like any app and keep their attribution and update source', async () => {
    const c = cloud();
    const sources = new Map<string, unknown>();
    const a = device(c);
    const b = device(c);
    const src = { listingId: 'labcdefghij012345678', specVersion: 3, specHash: 'c'.repeat(64) };
    const spec = { ...specWith('app_bazaar', 'Daily expenses'), meta: { ...base.meta, author: 'Asha', basedOn: 'bazaar:labcdefghij012345678' } };
    await a.db.apps.save({ id: 'app_bazaar', spec, createdAt: 1, updatedAt: 1, origin: { route: 'import' } }, { summary: 'Installed', source: 'import' });
    const engineA = createAccountSync({
      remote: c.remote, store: { get: async () => emptyLocal(), put: async () => undefined },
      apps: a.db.apps, versions: a.db.versions, records: a.db.records, state: a.db.state, backup: a.db,
      online: () => true, randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
      bazaar: { get: async () => src, set: async () => undefined },
    });
    await engineA.setUser(GOOGLE);
    await engineA.setChoice('apps');
    await engineA.sync();
    expect(c.apps.get('app_bazaar')?.bazaar).toEqual(src);
    const engineB = createAccountSync({
      remote: c.remote, store: { get: async () => emptyLocal(), put: async () => undefined },
      apps: b.db.apps, versions: b.db.versions, records: b.db.records, state: b.db.state, backup: b.db,
      online: () => true, randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
      bazaar: { get: async () => undefined, set: async (id, from) => void sources.set(id, from) },
    });
    await engineB.setUser(GOOGLE);
    await engineB.setChoice('apps');
    await engineB.sync();
    const got = await b.db.apps.get('app_bazaar');
    expect(got?.spec.meta).toMatchObject({ author: 'Asha', basedOn: 'bazaar:labcdefghij012345678' });
    expect(got?.origin.route).toBe('import');
    expect(sources.get('app_bazaar')).toEqual(src);
  });

  it('records: encrypted with the passphrase, restored on the new device, never readable in the account', async () => {
    const c = cloud();
    const a = device(c);
    const b = device(c);
    await add(a.db, 'app_one');
    await a.db.records.insert('app_one', 'expenses', { amount: 12.5, note: 'Secret lunch with Ravi' });
    await a.db.state.set('app_one', 'budget', 900);
    await a.db.state.set('app_one', 'kalam_draft', '{"v":1}'); // an unsent draft never leaves this device
    await a.sync.setUser(GOOGLE);
    expect(await a.sync.setChoice('apps_records', 'short')).toEqual({ ok: false, problem: 'weak_passphrase' });
    expect(await a.sync.setChoice('apps_records', 'correct horse battery')).toEqual({ ok: true });
    await a.sync.sync();
    const p = c.pointer();
    expect(p).toMatchObject({ parts: 1, appCount: 1, recordCount: 1 });
    const stored = [...c.parts.values()].join('');
    expect(stored).toContain('"format":"kalam-encrypted-backup"');
    expect(stored).not.toContain('Secret lunch');
    expect(stored).not.toContain('Ravi');
    expect(JSON.stringify([...a.saved.values()])).not.toContain('correct horse battery'); // the passphrase is never kept
    expect(a.sync.status().recordsBackupAt).toBeTypeOf('number');

    // Unchanged records are not uploaded again.
    const set = p!.set;
    await a.sync.noteLocalChange();
    await a.sync.sync();
    expect(c.pointer()!.set).toBe(set);

    await b.sync.setUser(GOOGLE);
    expect(await b.sync.setChoice('apps_records', 'wrong passphrase!!')).toEqual({ ok: false, problem: 'wrong_passphrase' });
    expect(await b.db.apps.get('app_one')).toBeUndefined(); // nothing happened
    expect(await b.sync.setChoice('apps_records', 'correct horse battery')).toEqual({ ok: true });
    await b.sync.sync();
    const rows = await b.db.records.list('app_one', 'expenses');
    expect(rows.map((r) => r.values.note)).toEqual(['Secret lunch with Ravi']);
    expect(await b.db.state.all('app_one')).toEqual({ budget: 900 });
    expect(b.sync.status().restored).toEqual({ apps: 1, kept: 0 });
    // The old backup's parts are cleaned up after a new one is written.
    await b.db.records.insert('app_one', 'expenses', { amount: 3, note: 'bus' });
    await b.sync.noteLocalChange();
    await b.sync.sync();
    expect(c.pointer()!.set).not.toBe(set);
    expect([...c.parts.keys()].every((k) => k.startsWith(c.pointer()!.set))).toBe(true);
  });

  it('signing out keeps the apps and drops the key; signing in again asks for the passphrase', async () => {
    const c = cloud();
    const a = device(c);
    await add(a.db, 'app_one');
    await a.sync.setUser(GOOGLE);
    await a.sync.setChoice('apps_records', 'correct horse battery');
    await a.sync.sync();
    await a.sync.setUser(null);
    expect(a.sync.status()).toMatchObject({ phase: 'signed_out', appsInAccount: 0 });
    expect(await a.db.apps.get('app_one')).toBeDefined();
    expect(a.saved.get(GOOGLE.uid)?.records).toBeUndefined();
    await a.sync.setUser(GOOGLE);
    expect(a.sync.status()).toMatchObject({ choice: 'apps_records', problem: 'needs_passphrase', appsInAccount: 1 });
    expect(await a.sync.unlockRecords('correct horse battery')).toEqual({ ok: true });
  });

  it('a cleared device brings the apps back instead of deleting them from the account', async () => {
    const c = cloud();
    const a = device(c);
    await add(a.db, 'app_one');
    await add(a.db, 'app_two');
    await a.sync.setUser(GOOGLE);
    await a.sync.setChoice('apps');
    await a.sync.sync();
    await a.db.apps.remove('app_one');
    await a.db.apps.remove('app_two');
    await a.sync.sync();
    expect([...c.apps.values()].every((d) => !d.deleted)).toBe(true);
    expect((await a.db.apps.list()).length).toBe(2);
  });

  it('removes everything from the account on request; the device keeps its apps', async () => {
    const c = cloud();
    const a = device(c);
    await add(a.db, 'app_one');
    await a.sync.setUser(GOOGLE);
    await a.sync.setChoice('apps_records', 'correct horse battery');
    await a.sync.sync();
    expect(await a.sync.removeFromAccount()).toEqual({ ok: true });
    expect(c.apps.size).toBe(0);
    expect(c.pointer()).toBeNull();
    expect(c.parts.size).toBe(0);
    expect(a.sync.status()).toMatchObject({ choice: 'off', appsInAccount: 0 });
    expect(await a.db.apps.get('app_one')).toBeDefined();
  });
});
