/// <reference types="node" />
/**
 * The collaboration engine over the real Firestore adapter, against the emulator with firestore.rules
 * loaded: every write below passes the same rules production uses. kalamCollabJoin is simulated with
 * rules off (its decisions are tested in functions/src/collab/plan.test.ts).
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureSpec } from '@/core/backup/test-fixtures';
import { createCollabEngine, createMemoryCollabStore, parseToken, type CollabRemote, type Role } from '@/core/collab';
import { secretHash } from '@/core/collab/invite';
import { createFakeDevice, fakeRandom } from '@/core/collab/test-kit';
import { createFirestoreRemote } from '@/infrastructure/collab/firestore-remote';

let env: RulesTestEnvironment;
const dbs = new Map<string, Firestore>();
const dbAs = (uid: string): Firestore => dbs.get(uid) ?? dbs.set(uid, env.authenticatedContext(uid).firestore() as unknown as Firestore).get(uid)!;
let suffix = 0;

/** Stands in for kalamCollabJoin: checks the invite and adds the member with rules off. */
const fakeJoin = (uid: string): CollabRemote['join'] => async (token) => {
  const p = parseToken(token);
  if (!p) return { ok: false, error: 'denied' };
  let out: Awaited<ReturnType<CollabRemote['join']>> = { ok: false, error: 'denied' };
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    const root = doc(db, p.target.kind === 'app' ? 'collabApps' : 'collabTeams', p.target.id);
    const inv = (await getDoc(doc(root, 'invites', secretHash(p.secret)))).data();
    if (!inv || inv.uses >= inv.maxUses) return;
    await setDoc(doc(root, 'members', uid), { role: inv.role, name: uid, joinedAt: serverTimestamp(), addedBy: inv.createdBy, installedVersion: 0 });
    await updateDoc(doc(root, 'invites', secretHash(p.secret)), { uses: inv.uses + 1 });
    out = { ok: true, value: { target: p.target, role: inv.role as Role, already: false } };
  });
  return out;
};

function person(uid: string) {
  const device = createFakeDevice();
  let n = 0;
  const engine = createCollabEngine({
    remote: createFirestoreRemote({ firestore: () => dbAs(uid), uid: () => uid, join: fakeJoin(uid), randomSuffix: () => `z${String(++suffix).padStart(5, '0')}` }),
    store: createMemoryCollabStore(),
    apps: device.apps,
    records: device.records,
    online: () => true,
    user: () => ({ uid, name: uid, isAnonymous: false }),
    randomBytes: fakeRandom,
    newAppId: () => `${uid}_app${++n}`,
  });
  return { uid, engine, device, entries: (appId: string) => device.rows.filter((r) => r.appId === appId) };
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-kalam', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  dbs.clear();
});

describe('collaboration over Firestore with the real rules', () => {
  it('shares, invites, syncs both ways, detects a clash, revokes and stops sharing', async () => {
    const alice = person('alice');
    const bob = person('bob');
    const app = await alice.device.apps.save(
      { id: 'alice_own', spec: fixtureSpec('alice_own', 'Shop orders'), createdAt: 1, updatedAt: 1, origin: { route: 'template' } },
      { summary: 't', source: 'create' },
    );
    await alice.device.records.insert(app.id, 'expenses', { title: 'Rice', amount: 40 });
    const shared = await alice.engine.share(app.id, { consent: true });
    expect(shared).toMatchObject({ ok: true, report: { pushed: 1 } });
    if (!shared.ok) return;
    const sid = shared.sharedId;

    const invite = await alice.engine.createInvite({ kind: 'app', id: sid }, 'editor');
    if (!invite.ok) throw new Error(invite.message);
    const joined = await bob.engine.join(invite.code, { consent: true });
    if (!joined.ok || joined.kind !== 'app') throw new Error(JSON.stringify(joined));
    const bobApp = joined.localAppId;
    expect(bob.entries(bobApp).map((r) => r.values.title)).toEqual(['Rice']);

    // Both ways.
    await bob.device.records.insert(bobApp, 'expenses', { title: 'Dal', amount: 30 });
    expect(await bob.engine.sync(bobApp)).toMatchObject({ pushed: 1, error: undefined });
    expect(await alice.engine.sync(app.id)).toMatchObject({ pulled: 1 });
    expect(alice.entries(app.id).map((r) => r.values.title).sort()).toEqual(['Dal', 'Rice']);

    // A clash on one field: the second writer is refused by version and gets a conflict, nothing overwritten.
    const aRice = alice.entries(app.id).find((r) => r.values.title === 'Rice')!;
    const bRice = bob.entries(bobApp).find((r) => r.values.title === 'Rice')!;
    await alice.device.records.update(app.id, 'expenses', aRice.id, { amount: 50 });
    await bob.device.records.update(bobApp, 'expenses', bRice.id, { amount: 60 });
    await alice.engine.sync(app.id);
    expect(await bob.engine.sync(bobApp)).toMatchObject({ conflicts: 1 });
    expect(bob.entries(bobApp).find((r) => r.id === bRice.id)?.values.amount).toBe(60);

    // Every change in the history names its author; values never appear there.
    const audit = await alice.engine.history(app.id);
    expect(audit.ok && audit.entries.some((e) => e.kind === 'record_created' && e.actor === 'bob')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('Dal');

    // A new design reaches the member.
    const mine = (await alice.device.apps.get(app.id))!;
    await alice.device.apps.save({ ...mine, spec: { ...mine.spec, name: 'Shop orders 2' } }, { summary: 'r', source: 'edit' });
    await alice.engine.sync(app.id);
    await bob.engine.sync(bobApp);
    expect((await bob.device.apps.get(bobApp))?.spec.name).toBe('Shop orders 2');

    // Revoke: Bob's next sync removes his copy.
    const people = await alice.engine.members({ kind: 'app', id: sid });
    const bobRow = people.ok ? people.members.find((m) => m.uid === 'bob') : undefined;
    expect(await alice.engine.removeMember({ kind: 'app', id: sid }, bobRow!)).toEqual({ ok: true });
    expect(await bob.engine.sync(bobApp)).toMatchObject({ ended: true });
    expect(await bob.device.apps.get(bobApp)).toBeUndefined();

    // Stop sharing: the owner's clean-up passes the rules and leaves nothing behind.
    expect(await alice.engine.stopSharing(app.id)).toEqual({ ok: true });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      expect((await getDoc(doc(db, 'collabApps', sid))).exists()).toBe(false);
      expect((await getDocs(collection(db, 'collabApps', sid, 'records'))).size).toBe(0);
      expect((await getDocs(collection(db, 'collabApps', sid, 'audit'))).size).toBe(0);
    });
    expect(alice.entries(app.id)).toHaveLength(2);
  });

  it('teams: a team member gets the app with the team role', async () => {
    const alice = person('alice');
    const cara = person('cara');
    const app = await alice.device.apps.save(
      { id: 'alice_own', spec: fixtureSpec('alice_own', 'Stock'), createdAt: 1, updatedAt: 1, origin: { route: 'template' } },
      { summary: 't', source: 'create' },
    );
    await alice.device.records.insert(app.id, 'expenses', { title: 'Soap', amount: 2 });
    const team = await alice.engine.createTeam('Shop staff');
    if (!team.ok) throw new Error(team.message);
    const shared = await alice.engine.share(app.id, { consent: true, teamId: team.teamId });
    if (!shared.ok) throw new Error(shared.message);
    const invite = await alice.engine.createInvite({ kind: 'team', id: team.teamId }, 'editor');
    if (!invite.ok) throw new Error(invite.message);
    expect(await cara.engine.join(invite.code, { consent: true })).toMatchObject({ ok: true, kind: 'team' });
    const view = await cara.engine.team(team.teamId);
    expect(view).toMatchObject({ ok: true, apps: [{ sharedId: shared.sharedId }] });
    const got = await cara.engine.getTeamApp(shared.sharedId, { consent: true });
    if (!got.ok) throw new Error(got.message);
    expect(cara.entries(got.localAppId).map((r) => r.values.title)).toEqual(['Soap']);
    await cara.device.records.insert(got.localAppId, 'expenses', { title: 'Oil', amount: 9 });
    expect(await cara.engine.sync(got.localAppId)).toMatchObject({ pushed: 1, error: undefined });
  });
});
