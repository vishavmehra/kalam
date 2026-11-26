/**
 * "My apps in my account" against the Firestore emulator and the real rules (docs/11 §10.5):
 * who may read and write users/{uid}/apps and users/{uid}/account, field and size checks, and the
 * real engine + Firestore adapter moving apps and an encrypted records backup between two devices.
 * Run with the emulator (see tests/rules/vitest.config.ts).
 */
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, type DocumentData, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../fixtures/specs/load';

vi.mock('@react-native-async-storage/async-storage', () => {
  const m = new Map<string, string>();
  return { default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v), removeItem: async (k: string) => void m.delete(k) } };
});

const { createAccountSync, emptyLocal } = await import('@/core/account-sync');
const { createAccountRemote } = await import('@/infrastructure/account-sync/firestore-remote');
const { createWebDatabase } = await import('@/infrastructure/storage/database.web');
const { validateSpec } = await import('@/core/spec/validate');

const HASH = 'a'.repeat(64);
let env: RulesTestEnvironment;

/** A Google account (the provider claim is what real Firebase Auth tokens carry). */
const google = (uid: string): Firestore =>
  env.authenticatedContext(uid, { firebase: { sign_in_provider: 'google.com', identities: {} } }).firestore() as unknown as Firestore;
const guest = (uid: string): Firestore =>
  env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous', identities: {} } }).firestore() as unknown as Firestore;
const nobody = (): Firestore => env.unauthenticatedContext().firestore() as unknown as Firestore;

function appBody(over: DocumentData = {}): DocumentData {
  return {
    name: 'Shop book', icon: { glyph: 'wallet', background: '#315C4C' }, version: 3, specGz: 'H4sI'.padEnd(200, 'A'), specHash: HASH,
    updatedAt: 1_700_000_000_000, syncedAt: serverTimestamp(), deleted: false, route: 'template', bazaar: null, ...over,
  };
}
const pointerBody = (over: DocumentData = {}): DocumentData => ({
  set: 'abcdef123456', parts: 2, chars: 1_500_000, sha256: HASH, salt: 'c2FsdHNhbHRzYWx0c2FsdA==', appCount: 2, recordCount: 40,
  updatedAt: serverTimestamp(), ...over,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-kalam', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => {
  await env.clearFirestore();
});
afterAll(async () => {
  await env?.cleanup();
});

describe('users/{uid}/apps rules', () => {
  it('the owner with a Google account writes, reads, lists and deletes their own apps', async () => {
    const db = google('alice');
    await assertSucceeds(setDoc(doc(db, 'users/alice/apps/app_one'), appBody()));
    await assertSucceeds(setDoc(doc(db, 'users/alice/apps/app_one'), appBody({ name: 'Shop book 2', version: 4 })));
    await assertSucceeds(getDoc(doc(db, 'users/alice/apps/app_one')));
    await assertSucceeds(getDocs(collection(db, 'users/alice/apps')));
    // A tombstone: no design, kept so other devices learn about the delete.
    await assertSucceeds(setDoc(doc(db, 'users/alice/apps/app_one'), appBody({ deleted: true, specGz: null, specHash: null, name: '', icon: null, version: 0 })));
    await assertSucceeds(deleteDoc(doc(db, 'users/alice/apps/app_one')));
  });

  it('nobody else reads, lists or writes them, and there is no listing of users', async () => {
    await assertSucceeds(setDoc(doc(google('alice'), 'users/alice/apps/app_one'), appBody()));
    for (const db of [google('bob'), nobody()]) {
      await assertFails(getDoc(doc(db, 'users/alice/apps/app_one')));
      await assertFails(getDocs(collection(db, 'users/alice/apps')));
      await assertFails(setDoc(doc(db, 'users/alice/apps/app_two'), appBody()));
      await assertFails(deleteDoc(doc(db, 'users/alice/apps/app_one')));
    }
    await assertFails(getDocs(collection(google('alice'), 'users')));
    await assertFails(getDoc(doc(google('alice'), 'users/alice')));
  });

  it('guest accounts cannot keep apps in an account', async () => {
    await assertFails(setDoc(doc(guest('gus'), 'users/gus/apps/app_one'), appBody()));
    await assertFails(getDocs(collection(guest('gus'), 'users/gus/apps')));
  });

  it('checks fields, sizes and server time', async () => {
    const db = google('alice');
    const bad: Array<[string, DocumentData]> = [
      ['extra field', appBody({ records: [] })],
      ['missing field', (({ bazaar: _b, ...rest }) => rest)(appBody())],
      ['design over 100 KB', appBody({ specGz: 'A'.repeat(140_001) })],
      ['bad hash', appBody({ specHash: 'xyz' })],
      ['tombstone with a design', appBody({ deleted: true })],
      ['live app without a design', appBody({ specGz: null, specHash: null })],
      ['client clock as server time', appBody({ syncedAt: new Date() })],
      ['long name', appBody({ name: 'x'.repeat(61) })],
      ['bad icon colour', appBody({ icon: { glyph: 'wallet', background: 'red' } })],
      ['icon with markup field', appBody({ icon: { glyph: 'wallet', svg: '<svg/>' } })],
      ['negative time', appBody({ updatedAt: -1 })],
      ['bad Bazaar source', appBody({ bazaar: { listingId: 'nope', specVersion: 1, specHash: HASH } })],
    ];
    for (const [why, body] of bad) await assertFails(setDoc(doc(db, 'users/alice/apps/app_one'), body)).catch((e) => { throw new Error(`${why}: ${e}`); });
    await assertFails(setDoc(doc(db, 'users/alice/apps/bad id!'), appBody()));
    await assertSucceeds(setDoc(doc(db, 'users/alice/apps/app_one'), appBody({ bazaar: { listingId: 'labcdefghij012345678', specVersion: 2, specHash: HASH } })));
  });
});

describe('users/{uid}/account and the encrypted backups area', () => {
  it('only the owner writes the records pointer, with checked fields', async () => {
    const db = google('alice');
    await assertSucceeds(setDoc(doc(db, 'users/alice/account/records'), pointerBody()));
    await assertSucceeds(getDoc(doc(db, 'users/alice/account/records')));
    await assertFails(setDoc(doc(db, 'users/alice/account/other'), pointerBody()));
    await assertFails(setDoc(doc(db, 'users/alice/account/records'), pointerBody({ parts: 41 })));
    await assertFails(setDoc(doc(db, 'users/alice/account/records'), pointerBody({ set: 'UPPER' })));
    await assertFails(setDoc(doc(db, 'users/alice/account/records'), pointerBody({ passphrase: 'never' })));
    await assertFails(getDoc(doc(google('bob'), 'users/alice/account/records')));
    await assertFails(setDoc(doc(google('bob'), 'users/alice/account/records'), pointerBody()));
    await assertFails(setDoc(doc(guest('gus'), 'users/gus/account/records'), pointerBody()));
  });

  it('records chunks fit B1 backups rules: owner only, under 900 KB, envelope format', async () => {
    const part = (text: string) => ({
      format: 'kalam-encrypted-backup', formatVersion: 1, ciphertext: text,
      manifest: { kind: 'account-records', set: 'abcdef123456', part: 0, parts: 1 }, updatedAt: serverTimestamp(),
    });
    await assertSucceeds(setDoc(doc(google('alice'), 'users/alice/backups/records_abcdef123456_0'), part('x'.repeat(880_000))));
    await assertFails(setDoc(doc(google('alice'), 'users/alice/backups/records_abcdef123456_1'), part('x'.repeat(900_001))));
    await assertFails(getDoc(doc(google('bob'), 'users/alice/backups/records_abcdef123456_0')));
    await assertFails(getDocs(collection(nobody(), 'users/alice/backups')));
  });
});

describe('engine + Firestore adapter on the emulator', () => {
  it('moves apps and an encrypted records backup from one device to another', async () => {
    const checked = validateSpec(loadFixture('valid', 'expense-tracker'));
    if (!checked.ok || !checked.spec) throw new Error('fixture');
    const device = (name: string) => {
      const db = createWebDatabase(`acct-it-${name}-${Date.now()}`);
      const firestore = google('alice');
      const sync = createAccountSync({
        remote: createAccountRemote(() => firestore),
        store: (() => { const m = new Map(); return { get: async (u: string) => m.get(u) ?? emptyLocal(), put: async (u: string, d: unknown) => void m.set(u, d) }; })(),
        apps: db.apps, versions: db.versions, records: db.records, state: db.state, backup: db,
        online: () => true, randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
      });
      return { db, sync, firestore };
    };
    const a = device('a');
    const b = device('b');
    const spec = { ...checked.spec, id: 'app_shop', name: 'Shop book' };
    await a.db.apps.save({ id: spec.id, spec, createdAt: 1, updatedAt: 1, origin: { route: 'template' } }, { summary: 'Made', source: 'create' });
    await a.db.records.insert('app_shop', 'expenses', { amount: 40, note: 'Private supplier note' });

    await a.sync.setUser({ uid: 'alice', isAnonymous: false });
    expect(await a.sync.setChoice('apps_records', 'a long enough passphrase')).toEqual({ ok: true });
    await a.sync.sync();
    expect(a.sync.status()).toMatchObject({ phase: 'idle', appsInAccount: 1, pending: 0 });
    expect(a.sync.status().problem).toBeUndefined();

    // What the account holds: the design, and ciphertext only.
    const stored = (await getDoc(doc(a.firestore, 'users/alice/apps/app_shop'))).data();
    expect(stored).toMatchObject({ name: 'Shop book', deleted: false, route: 'template' });
    const chunks = (await getDocs(collection(a.firestore, 'users/alice/backups'))).docs.map((d) => String(d.data().ciphertext)).join('');
    expect(chunks).toContain('AES-256-GCM');
    expect(chunks).not.toContain('Private supplier note');

    await b.sync.setUser({ uid: 'alice', isAnonymous: false });
    expect(await b.sync.setChoice('apps_records', 'a long enough passphrase')).toEqual({ ok: true });
    await b.sync.sync();
    expect((await b.db.apps.get('app_shop'))?.spec.name).toBe('Shop book');
    expect((await b.db.records.list('app_shop', 'expenses')).map((r) => r.values.note)).toEqual(['Private supplier note']);

    // A delete on B reaches A as a tombstone; A archives because the app has records there.
    await b.db.apps.remove('app_shop');
    await b.sync.sync();
    expect((await getDoc(doc(a.firestore, 'users/alice/apps/app_shop'))).data()).toMatchObject({ deleted: true, specGz: null });
    await a.sync.sync();
    expect((await a.db.apps.get('app_shop'))?.archived).toBe(true);
  });
});
