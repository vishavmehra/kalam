/// <reference types="node" />
/**
 * Emulator tests for the collaboration rules in firestore.rules (docs/14 §17.7, docs/11 §10.5):
 * membership, roles, versioned entries with an audit line, invites, stopping and teams. Permitted AND
 * denied paths. Run with the Firestore emulator (see tests/rules/vitest.config.ts).
 */
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch, type DocumentData, type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const SID = `s${'a'.repeat(19)}`;
const SID2 = `s${'c'.repeat(19)}`;
const TID = `t${'b'.repeat(19)}`;
const HASH = 'a'.repeat(64);
const GZ = 'H4sIAAAAAAAAA6tWykxRslJKSUxKVaoFAH5cVM0OAAAA';
const day = 86_400_000;

let env: RulesTestEnvironment;
const dbAs = (uid?: string): Firestore => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore() as unknown as Firestore;

const appBody = (o: DocumentData = {}): DocumentData => ({
  ownerUid: 'alice', title: 'Shop orders', status: 'active', specGz: GZ, specHash: HASH, specVersion: 1, teamId: null,
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...o,
});
const member = (role: string, o: DocumentData = {}): DocumentData => ({ role, name: role, joinedAt: Timestamp.now(), addedBy: 'alice', installedVersion: 1, ...o });

async function seed(work: (db: Firestore) => Promise<void>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => work(ctx.firestore() as unknown as Firestore));
}

/** alice owner, adam admin, bob editor, vic viewer. One entry r1 at version 1. */
async function seedApp(extra: DocumentData = {}): Promise<void> {
  await seed(async (db) => {
    const now = Timestamp.now();
    await setDoc(doc(db, 'collabApps', SID), appBody({ createdAt: now, updatedAt: now, ...extra }));
    await setDoc(doc(db, 'collabApps', SID, 'members', 'alice'), member('owner'));
    await setDoc(doc(db, 'collabApps', SID, 'members', 'adam'), member('admin'));
    await setDoc(doc(db, 'collabApps', SID, 'members', 'bob'), member('editor'));
    await setDoc(doc(db, 'collabApps', SID, 'members', 'vic'), member('viewer'));
    await setDoc(doc(db, 'collabApps', SID, 'records', 'r1'), {
      collectionId: 'orders', values: { title: 'Rice' }, version: 1, deleted: false, createdBy: 'alice', updatedBy: 'alice', updatedAt: now,
    });
  });
}

async function seedTeam(): Promise<void> {
  await seed(async (db) => {
    const now = Timestamp.now();
    await setDoc(doc(db, 'collabTeams', TID), { name: 'Shop staff', ownerUid: 'tara', status: 'active', apps: [], createdAt: now, updatedAt: now });
    await setDoc(doc(db, 'collabTeams', TID, 'members', 'tara'), member('owner', { addedBy: 'tara' }));
    await setDoc(doc(db, 'collabTeams', TID, 'members', 'alice'), member('admin', { addedBy: 'tara' }));
    await setDoc(doc(db, 'collabTeams', TID, 'members', 'cara'), member('editor', { addedBy: 'tara' }));
    await setDoc(doc(db, 'collabTeams', TID, 'members', 'walt'), member('viewer', { addedBy: 'tara' }));
  });
}

/** Writes one entry version with its audit line, the way the app's transaction does. */
function writeEntry(db: Firestore, uid: string, rid: string, version: number, o: DocumentData = {}, audit: DocumentData | null = {}) {
  const b = writeBatch(db);
  b.set(doc(db, 'collabApps', SID, 'records', rid), {
    collectionId: 'orders', values: { title: 'Dal' }, version, deleted: false, createdBy: version === 1 ? uid : 'alice', updatedBy: uid,
    updatedAt: serverTimestamp(), ...o,
  });
  if (audit) {
    b.set(doc(db, 'collabApps', SID, 'audit', `r_${rid}_${version}`), {
      actor: uid, kind: version === 1 ? 'record_created' : 'record_updated', at: serverTimestamp(), target: rid, collectionId: 'orders', version, ...audit,
    });
  }
  return b.commit();
}

function share(db: Firestore, uid: string, o: DocumentData = {}, ownerRow: DocumentData | null = {}) {
  const b = writeBatch(db);
  b.set(doc(db, 'collabApps', SID), appBody({ ownerUid: uid, ...o }));
  if (ownerRow) b.set(doc(db, 'collabApps', SID, 'members', uid), { role: 'owner', name: 'A', joinedAt: serverTimestamp(), addedBy: uid, installedVersion: 1, ...ownerRow });
  b.set(doc(db, 'collabApps', SID, 'audit', 'shared'), { actor: uid, kind: 'shared', at: serverTimestamp() });
  return b.commit();
}

const invite = (o: DocumentData = {}): DocumentData => ({
  role: 'editor', createdBy: 'adam', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 7 * day), maxUses: 10, uses: 0, ...o,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-kalam', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

describe('sharing an app', () => {
  it('lets a signed-in owner share with their owner row and audit line in one batch', async () => {
    await assertSucceeds(share(dbAs('alice'), 'alice'));
  });
  it('denies signed-out users, a missing owner row, someone else as owner, a team at creation and bad shapes', async () => {
    await assertFails(share(dbAs(), 'alice'));
    await assertFails(share(dbAs('alice'), 'alice', {}, null));
    await assertFails(share(dbAs('mallory'), 'alice'));
    await assertFails(share(dbAs('alice'), 'alice', { teamId: TID }));
    await assertFails(share(dbAs('alice'), 'alice', { specVersion: 2 }));
    await assertFails(share(dbAs('alice'), 'alice', { title: '<b>x</b>' }));
    await assertFails(share(dbAs('alice'), 'alice', { extra: true }));
    await assertFails(share(dbAs('alice'), 'alice', { specGz: 'x'.repeat(140_001) }));
  });
  it('never lists shared apps', async () => {
    await seedApp();
    await assertFails(getDocs(collection(dbAs('alice'), 'collabApps')));
  });
});

describe('reading', () => {
  it('lets members read the app, its entries, people and history; signing in alone opens nothing', async () => {
    await seedApp();
    for (const uid of ['alice', 'adam', 'bob', 'vic']) {
      await assertSucceeds(getDoc(doc(dbAs(uid), 'collabApps', SID)));
      await assertSucceeds(getDocs(collection(dbAs(uid), 'collabApps', SID, 'records')));
      await assertSucceeds(getDocs(collection(dbAs(uid), 'collabApps', SID, 'members')));
      await assertSucceeds(getDocs(collection(dbAs(uid), 'collabApps', SID, 'audit')));
    }
    await assertFails(getDoc(doc(dbAs('mallory'), 'collabApps', SID)));
    await assertFails(getDocs(collection(dbAs('mallory'), 'collabApps', SID, 'records')));
    await assertFails(getDoc(doc(dbAs('mallory'), 'collabApps', SID, 'records', 'r1')));
    await assertFails(getDocs(collection(dbAs('mallory'), 'collabApps', SID, 'members')));
    await assertFails(getDocs(collection(dbAs(), 'collabApps', SID, 'records')));
    // Anyone may read their own (missing) member row: that is how a device learns it was removed.
    await assertSucceeds(getDoc(doc(dbAs('mallory'), 'collabApps', SID, 'members', 'mallory')));
  });
  it('does not let anyone add themselves as a member', async () => {
    await seedApp();
    await assertFails(setDoc(doc(dbAs('mallory'), 'collabApps', SID, 'members', 'mallory'), member('editor', { addedBy: 'mallory', joinedAt: serverTimestamp() })));
    await assertFails(setDoc(doc(dbAs('mallory'), 'collabApps', SID, 'members', 'mallory'), member('owner', { addedBy: 'mallory', joinedAt: serverTimestamp() })));
  });
});

describe('entries', () => {
  it('lets editors and above write a new version with its audit line', async () => {
    await seedApp();
    await assertSucceeds(writeEntry(dbAs('bob'), 'bob', 'r2', 1));
    await assertSucceeds(writeEntry(dbAs('bob'), 'bob', 'r1', 2));
    await assertSucceeds(writeEntry(dbAs('adam'), 'adam', 'r1', 3));
    await assertSucceeds(writeEntry(dbAs('alice'), 'alice', 'r1', 4, { deleted: true, values: {} }));
  });
  it('denies viewers, strangers and the signed out', async () => {
    await seedApp();
    await assertFails(writeEntry(dbAs('vic'), 'vic', 'r2', 1));
    await assertFails(writeEntry(dbAs('mallory'), 'mallory', 'r2', 1));
    await assertFails(writeEntry(dbAs(), 'nobody', 'r2', 1));
  });
  it('denies a write without its audit line, or with someone else as the actor', async () => {
    await seedApp();
    await assertFails(writeEntry(dbAs('bob'), 'bob', 'r2', 1, {}, null));
    await assertFails(writeEntry(dbAs('bob'), 'bob', 'r2', 1, {}, { actor: 'alice' }));
    await assertFails(writeEntry(dbAs('bob'), 'bob', 'r2', 1, { updatedBy: 'alice' }));
  });
  it('denies stale and skipped versions, so an old copy never overwrites a newer change', async () => {
    await seedApp();
    await assertFails(writeEntry(dbAs('bob'), 'bob', 'r1', 1));
    await assertFails(writeEntry(dbAs('bob'), 'bob', 'r1', 3));
    await assertFails(writeEntry(dbAs('bob'), 'bob', 'r2', 2));
  });
  it('denies moving an entry, rewriting who made it, oversized and tombstones with values', async () => {
    await seedApp();
    await assertFails(writeEntry(dbAs('bob'), 'bob', 'r1', 2, { collectionId: 'other' }));
    await assertFails(writeEntry(dbAs('bob'), 'bob', 'r1', 2, { createdBy: 'bob' }));
    await assertFails(writeEntry(dbAs('bob'), 'bob', 'r1', 2, { deleted: true, values: { title: 'x' } }));
    const many = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`f${i}`, i]));
    await assertFails(writeEntry(dbAs('bob'), 'bob', 'r2', 1, { values: many }));
    await assertFails(writeEntry(dbAs('bob'), 'bob', 'bad id!', 1));
  });
  it('never lets members delete entries or edit the history', async () => {
    await seedApp();
    await assertFails(deleteDoc(doc(dbAs('alice'), 'collabApps', SID, 'records', 'r1')));
    await assertSucceeds(writeEntry(dbAs('bob'), 'bob', 'r2', 1));
    await assertFails(updateDoc(doc(dbAs('bob'), 'collabApps', SID, 'audit', 'r_r2_1'), { actor: 'alice' }));
    await assertFails(deleteDoc(doc(dbAs('alice'), 'collabApps', SID, 'audit', 'r_r2_1')));
    // A record line with no matching entry write is refused.
    await assertFails(setDoc(doc(dbAs('bob'), 'collabApps', SID, 'audit', 'r_r9_1'), { actor: 'bob', kind: 'record_created', at: serverTimestamp(), target: 'r9', version: 1 }));
  });
});

describe('design versions', () => {
  it('lets only the owner publish the next design version, with its audit line', async () => {
    await seedApp();
    const next = (uid: string, version: number) => {
      const db = dbAs(uid);
      const b = writeBatch(db);
      b.update(doc(db, 'collabApps', SID), { specVersion: version, specHash: 'b'.repeat(64), updatedAt: serverTimestamp() });
      b.set(doc(db, 'collabApps', SID, 'audit', `s_${version}`), { actor: uid, kind: 'spec_updated', at: serverTimestamp(), version });
      return b.commit();
    };
    await assertFails(next('adam', 2));
    await assertFails(next('bob', 2));
    await assertFails(next('alice', 3));
    await assertSucceeds(next('alice', 2));
    await assertFails(updateDoc(doc(dbAs('alice'), 'collabApps', SID), { specVersion: 3, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(dbAs('alice'), 'collabApps', SID), { ownerUid: 'bob', updatedAt: serverTimestamp() }));
  });
});

describe('people', () => {
  it('lets an admin manage editors and viewers but not admins or the owner', async () => {
    await seedApp();
    await assertSucceeds(updateDoc(doc(dbAs('adam'), 'collabApps', SID, 'members', 'vic'), { role: 'editor' }));
    await assertFails(updateDoc(doc(dbAs('adam'), 'collabApps', SID, 'members', 'bob'), { role: 'admin' }));
    await assertFails(updateDoc(doc(dbAs('adam'), 'collabApps', SID, 'members', 'alice'), { role: 'viewer' }));
    await assertFails(deleteDoc(doc(dbAs('adam'), 'collabApps', SID, 'members', 'alice')));
    await assertFails(updateDoc(doc(dbAs('bob'), 'collabApps', SID, 'members', 'vic'), { role: 'editor' }));
    await assertFails(updateDoc(doc(dbAs('alice'), 'collabApps', SID, 'members', 'bob'), { role: 'owner' }));
    await assertSucceeds(updateDoc(doc(dbAs('alice'), 'collabApps', SID, 'members', 'bob'), { role: 'admin' }));
  });
  it('lets members update only their own name and version, and never their role', async () => {
    await seedApp();
    await assertSucceeds(updateDoc(doc(dbAs('vic'), 'collabApps', SID, 'members', 'vic'), { installedVersion: 2, name: 'Vic' }));
    await assertFails(updateDoc(doc(dbAs('vic'), 'collabApps', SID, 'members', 'vic'), { role: 'admin' }));
    await assertFails(updateDoc(doc(dbAs('vic'), 'collabApps', SID, 'members', 'vic'), { name: '<script>' }));
  });
  it('revocation: a removed member can no longer read or write', async () => {
    await seedApp();
    await assertSucceeds(deleteDoc(doc(dbAs('alice'), 'collabApps', SID, 'members', 'bob')));
    await assertFails(getDocs(collection(dbAs('bob'), 'collabApps', SID, 'records')));
    await assertFails(writeEntry(dbAs('bob'), 'bob', 'r2', 1));
    await assertFails(getDoc(doc(dbAs('bob'), 'collabApps', SID)));
  });
  it('lets members leave (not the owner), writing a leave line', async () => {
    await seedApp();
    const leave = (uid: string) => {
      const db = dbAs(uid);
      const b = writeBatch(db);
      b.delete(doc(db, 'collabApps', SID, 'members', uid));
      b.set(doc(db, 'collabApps', SID, 'audit', `e_${Date.now()}_abc123`), { actor: uid, kind: 'member_left', at: serverTimestamp(), target: uid });
      return b.commit();
    };
    await assertSucceeds(leave('vic'));
    await assertFails(leave('alice'));
  });
});

describe('invites', () => {
  it('lets admins invite below their own role, with a bounded expiry and no preset uses', async () => {
    await seedApp();
    const inv = (uid: string, o: DocumentData = {}) => setDoc(doc(dbAs(uid), 'collabApps', SID, 'invites', HASH), invite({ createdBy: uid, ...o }));
    await assertFails(inv('adam', { role: 'admin' }));
    await assertFails(inv('adam', { role: 'owner' }));
    await assertFails(inv('bob'));
    await assertFails(inv('adam', { uses: 1 }));
    await assertFails(inv('adam', { maxUses: 500 }));
    await assertFails(inv('adam', { expiresAt: Timestamp.fromMillis(Date.now() + 40 * day) }));
    await assertFails(inv('adam', { expiresAt: Timestamp.fromMillis(Date.now() - day) }));
    await assertFails(setDoc(doc(dbAs('adam'), 'collabApps', SID, 'invites', 'not-a-hash'), invite()));
    await assertSucceeds(inv('adam'));
    await assertSucceeds(getDocs(collection(dbAs('adam'), 'collabApps', SID, 'invites')));
    await assertFails(getDocs(collection(dbAs('bob'), 'collabApps', SID, 'invites')));
    await assertFails(getDoc(doc(dbAs('mallory'), 'collabApps', SID, 'invites', HASH)));
    await assertFails(updateDoc(doc(dbAs('adam'), 'collabApps', SID, 'invites', HASH), { uses: 0, maxUses: 50 }));
    await assertSucceeds(deleteDoc(doc(dbAs('adam'), 'collabApps', SID, 'invites', HASH)));
  });
});

describe('stopping', () => {
  it('cuts everyone off at once, still lets members see that it stopped, and lets only the owner clean up', async () => {
    await seedApp();
    await assertFails(deleteDoc(doc(dbAs('alice'), 'collabApps', SID)));
    await assertFails(updateDoc(doc(dbAs('bob'), 'collabApps', SID), { status: 'deleted', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(dbAs('alice'), 'collabApps', SID), { status: 'deleted', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(dbAs('alice'), 'collabApps', SID), { status: 'active', updatedAt: serverTimestamp() }));
    await assertFails(getDocs(collection(dbAs('bob'), 'collabApps', SID, 'records')));
    await assertFails(writeEntry(dbAs('bob'), 'bob', 'r2', 1));
    await assertSucceeds(getDoc(doc(dbAs('bob'), 'collabApps', SID)));
    await assertFails(deleteDoc(doc(dbAs('bob'), 'collabApps', SID, 'records', 'r1')));
    await assertSucceeds(getDocs(collection(dbAs('alice'), 'collabApps', SID, 'records')));
    await assertSucceeds(deleteDoc(doc(dbAs('alice'), 'collabApps', SID, 'records', 'r1')));
    await assertSucceeds(deleteDoc(doc(dbAs('alice'), 'collabApps', SID, 'members', 'bob')));
    await assertSucceeds(deleteDoc(doc(dbAs('alice'), 'collabApps', SID)));
  });
});

describe('teams', () => {
  it('lets someone create a team with their owner row; strangers cannot read it', async () => {
    const db = dbAs('tara');
    const b = writeBatch(db);
    b.set(doc(db, 'collabTeams', TID), { name: 'Shop staff', ownerUid: 'tara', status: 'active', apps: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    b.set(doc(db, 'collabTeams', TID, 'members', 'tara'), { role: 'owner', name: 'Tara', joinedAt: serverTimestamp(), addedBy: 'tara', installedVersion: 0 });
    await assertSucceeds(b.commit());
    await assertFails(getDoc(doc(dbAs('mallory'), 'collabTeams', TID)));
    await assertFails(getDocs(collection(dbAs('mallory'), 'collabTeams')));
  });

  it('lets everyone with access record their own design version, and only managers read them all', async () => {
    await seedTeam();
    await seedApp({ teamId: TID });
    const install = (uid: string, who = uid, o: DocumentData = {}) =>
      setDoc(doc(dbAs(uid), 'collabApps', SID, 'installs', who), { version: 1, at: serverTimestamp(), ...o });
    await assertSucceeds(install('vic'));
    await assertSucceeds(install('cara')); // through the team, no member row of her own
    await assertFails(install('bob', 'vic')); // never someone else's
    await assertFails(install('bob', 'bob', { version: 0 }));
    await assertFails(install('bob', 'bob', { role: 'owner' }));
    await assertFails(install('mallory'));
    await assertSucceeds(getDocs(collection(dbAs('alice'), 'collabApps', SID, 'installs')));
    await assertSucceeds(getDocs(collection(dbAs('adam'), 'collabApps', SID, 'installs')));
    await assertFails(getDocs(collection(dbAs('bob'), 'collabApps', SID, 'installs')));
    await assertSucceeds(getDoc(doc(dbAs('bob'), 'collabApps', SID, 'installs', 'bob')));
  });

  it('gives team members their team role on the team\'s apps, capped at admin', async () => {
    await seedTeam();
    await seedApp({ teamId: TID });
    await assertSucceeds(getDoc(doc(dbAs('cara'), 'collabApps', SID)));
    await assertSucceeds(writeEntry(dbAs('cara'), 'cara', 'r2', 1));
    await assertSucceeds(getDocs(collection(dbAs('walt'), 'collabApps', SID, 'records')));
    await assertFails(writeEntry(dbAs('walt'), 'walt', 'r3', 1));
    // The team owner is an admin on someone else's app: can manage editors, cannot touch the design.
    await assertSucceeds(updateDoc(doc(dbAs('tara'), 'collabApps', SID, 'members', 'vic'), { role: 'editor' }));
    await assertFails(updateDoc(doc(dbAs('tara'), 'collabApps', SID), { title: 'Mine now', updatedAt: serverTimestamp() }));
    await assertFails(getDocs(collection(dbAs('mallory'), 'collabApps', SID, 'records')));
  });

  it('opens nothing for an app that is not in the team, whatever the directory says', async () => {
    await seedTeam();
    await seedApp();
    await seed(async (db) => updateDoc(doc(db, 'collabTeams', TID), { apps: [{ sharedId: SID, title: 'Shop orders' }] }));
    await assertFails(getDoc(doc(dbAs('cara'), 'collabApps', SID)));
    await assertFails(getDocs(collection(dbAs('cara'), 'collabApps', SID, 'records')));
  });

  it('lets an app owner who is a team admin put the app in the team and update its directory', async () => {
    await seedTeam();
    await seedApp();
    const move = (uid: string, teamId: string) => {
      const db = dbAs(uid);
      const b = writeBatch(db);
      b.update(doc(db, 'collabApps', SID), { teamId, updatedAt: serverTimestamp() });
      b.update(doc(db, 'collabTeams', teamId), { apps: [{ sharedId: SID, title: 'Shop orders' }], updatedAt: serverTimestamp() });
      return b.commit();
    };
    await assertFails(move('bob', TID));
    await assertSucceeds(move('alice', TID));
    await assertFails(updateDoc(doc(dbAs('cara'), 'collabTeams', TID), { apps: [], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(dbAs('alice'), 'collabTeams', TID), { name: 'Renamed', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(dbAs('tara'), 'collabTeams', TID), { name: 'Renamed', updatedAt: serverTimestamp() }));
  });

  it('refuses a team the owner does not manage, and team access ends when the team is stopped', async () => {
    await seedTeam();
    await seed(async (db) => {
      const now = Timestamp.now();
      await setDoc(doc(db, 'collabApps', SID2), appBody({ ownerUid: 'cara', createdAt: now, updatedAt: now }));
      await setDoc(doc(db, 'collabApps', SID2, 'members', 'cara'), member('owner', { addedBy: 'cara' }));
    });
    await assertFails(updateDoc(doc(dbAs('cara'), 'collabApps', SID2), { teamId: TID, updatedAt: serverTimestamp() }));
    await seedApp({ teamId: TID });
    await assertSucceeds(updateDoc(doc(dbAs('tara'), 'collabTeams', TID), { status: 'deleted', updatedAt: serverTimestamp() }));
    await assertFails(getDocs(collection(dbAs('walt'), 'collabApps', SID, 'records')));
  });
});
