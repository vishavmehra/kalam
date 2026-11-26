import { describe, expect, it } from 'vitest';
import { CollabReadOnlyError } from './engine';
import { createFakeCloud, person, type Person } from './test-kit';

async function sharedPair(role: 'editor' | 'viewer' | 'admin' = 'editor') {
  const cloud = createFakeCloud();
  const alice = person(cloud, 'alice');
  const bob = person(cloud, 'bob');
  const app = await alice.addApp();
  await alice.add(app.id, { title: 'Rice', amount: 40 });
  const shared = await alice.engine.share(app.id, { consent: true });
  if (!shared.ok) throw new Error(shared.message);
  const invite = await alice.engine.createInvite({ kind: 'app', id: shared.sharedId }, role);
  if (!invite.ok) throw new Error(invite.message);
  const joined = await bob.engine.join(invite.code, { consent: true });
  if (!joined.ok || joined.kind !== 'app') throw new Error('join failed');
  return { cloud, alice, bob, aliceApp: app.id, bobApp: joined.localAppId, sharedId: shared.sharedId };
}
const titles = (p: Person, appId: string) => p.entries(appId).map((r) => r.values.title).sort();

describe('opt-in and sign-in', () => {
  it('shares nothing without the explicit yes, an account, or a connection', async () => {
    const cloud = createFakeCloud();
    const alice = person(cloud, 'alice');
    const app = await alice.addApp();
    expect(await alice.engine.share(app.id, { consent: false })).toMatchObject({ ok: false, code: 'no_consent' });
    alice.user.value = null;
    expect(await alice.engine.share(app.id, { consent: true })).toMatchObject({ ok: false, code: 'sign_in' });
    alice.user.value = { uid: 'alice', name: 'A', isAnonymous: true };
    expect(await alice.engine.share(app.id, { consent: true })).toMatchObject({ ok: false, code: 'guest_account' });
    alice.user.value = { uid: 'alice', name: 'A', isAnonymous: false };
    alice.online.value = false;
    expect(await alice.engine.share(app.id, { consent: true })).toMatchObject({ ok: false, code: 'offline' });
    expect(await alice.store.list()).toEqual([]);
    // An app that was never shared never syncs.
    expect(await alice.engine.sync(app.id)).toMatchObject({ pushed: 0, pulled: 0 });
  });
});

describe('two people, one app', () => {
  it('copies design and entries to the invited person, and changes flow both ways with the actor recorded', async () => {
    const { cloud, alice, bob, aliceApp, bobApp, sharedId } = await sharedPair();
    expect(titles(bob, bobApp)).toEqual(['Rice']);
    expect((await bob.device.apps.get(bobApp))?.spec.id).toBe(bobApp);
    expect(await bob.engine.myRoleIn({ kind: 'app', id: sharedId })).toBe('editor');

    await bob.add(bobApp, { title: 'Dal', amount: 30 });
    expect(await bob.engine.sync(bobApp)).toMatchObject({ pushed: 1 });
    expect(await alice.engine.sync(aliceApp)).toMatchObject({ pulled: 1 });
    expect(titles(alice, aliceApp)).toEqual(['Dal', 'Rice']);

    const created = cloud.audit(sharedId).filter((e) => e.kind === 'record_created');
    expect(created.map((e) => e.actor).sort()).toEqual(['alice', 'bob']);
    expect(JSON.stringify(cloud.audit(sharedId))).not.toContain('Dal'); // the history never holds values
  });

  it('keeps offline edits and sends them when back online', async () => {
    const { cloud, alice, bob, aliceApp, bobApp, sharedId } = await sharedPair();
    bob.online.value = false;
    const rice = bob.entries(bobApp)[0]!;
    await bob.device.records.update(bobApp, 'expenses', rice.id, { amount: 45 });
    await bob.add(bobApp, { title: 'Tea', amount: 5 });
    expect(await bob.engine.sync(bobApp)).toMatchObject({ error: 'offline' });
    expect(bob.engine.status(bobApp)).toMatchObject({ shared: true, phase: 'offline', pending: 2 });
    expect(cloud.records(sharedId)).toHaveLength(1);

    bob.online.value = true;
    expect(await bob.engine.sync(bobApp)).toMatchObject({ pushed: 2 });
    expect(bob.engine.status(bobApp)).toMatchObject({ phase: 'idle', pending: 0 });
    await alice.engine.sync(aliceApp);
    expect(alice.entries(aliceApp).find((r) => r.values.title === 'Rice')?.values.amount).toBe(45);
    expect(titles(alice, aliceApp)).toEqual(['Rice', 'Tea']);
  });

  it('deletes reach the other person as deletions', async () => {
    const { alice, bob, aliceApp, bobApp } = await sharedPair();
    const rice = bob.entries(bobApp)[0]!;
    await bob.device.records.remove(bobApp, 'expenses', rice.id);
    expect(await bob.engine.sync(bobApp)).toMatchObject({ pushed: 1 });
    await alice.engine.sync(aliceApp);
    expect(alice.entries(aliceApp)).toEqual([]);
  });
});

describe('conflicts', () => {
  it('taking their value for a clash keeps my other changes to the entry', async () => {
    const { alice, bob, aliceApp, bobApp } = await sharedPair();
    await alice.device.records.update(aliceApp, 'expenses', alice.entries(aliceApp)[0]!.id, { amount: 50 });
    await bob.device.records.update(bobApp, 'expenses', bob.entries(bobApp)[0]!.id, { amount: 60, category: 'Food' });
    await alice.engine.sync(aliceApp);
    await bob.engine.sync(bobApp);
    const [c] = (await bob.store.get(bobApp))!.conflicts;
    expect(c!.fields.map((f) => f.field)).toEqual(['amount']);
    expect(c!.mine).toMatchObject({ title: 'Rice', amount: 60 }); // so the screen can say which entry it is
    expect(await bob.engine.resolve(bobApp, c!.id, 'theirs')).toEqual({ ok: true });
    await bob.engine.sync(bobApp);
    expect(bob.entries(bobApp)[0]!.values).toMatchObject({ amount: 50, category: 'Food' });
    await alice.engine.sync(aliceApp);
    expect(alice.entries(aliceApp)[0]!.values).toMatchObject({ amount: 50, category: 'Food' });
  });

  it('bringing back an entry someone changed after this device deleted it', async () => {
    const { alice, bob, aliceApp, bobApp } = await sharedPair();
    await alice.device.records.update(aliceApp, 'expenses', alice.entries(aliceApp)[0]!.id, { amount: 70 });
    await alice.engine.sync(aliceApp);
    await bob.device.records.remove(bobApp, 'expenses', bob.entries(bobApp)[0]!.id);
    await bob.engine.sync(bobApp);
    const [c] = (await bob.store.get(bobApp))!.conflicts;
    expect(c).toMatchObject({ kind: 'deleted_here', theirs: { amount: 70 } });
    await bob.engine.resolve(bobApp, c!.id, 'theirs');
    await bob.engine.sync(bobApp);
    expect(bob.entries(bobApp).map((r) => r.values.amount)).toEqual([70]);
    await alice.engine.sync(aliceApp);
    expect(alice.entries(aliceApp)).toHaveLength(1);
  });

  it('merges edits to different fields without asking', async () => {
    const { alice, bob, aliceApp, bobApp } = await sharedPair();
    const a = alice.entries(aliceApp)[0]!;
    const b = bob.entries(bobApp)[0]!;
    await alice.device.records.update(aliceApp, 'expenses', a.id, { amount: 50 });
    await bob.device.records.update(bobApp, 'expenses', b.id, { category: 'Food' });
    await alice.engine.sync(aliceApp);
    expect(await bob.engine.sync(bobApp)).toMatchObject({ conflicts: 0, pushed: 1 });
    expect(bob.entries(bobApp)[0]!.values).toMatchObject({ amount: 50, category: 'Food' });
    await alice.engine.sync(aliceApp);
    expect(alice.entries(aliceApp)[0]!.values).toMatchObject({ amount: 50, category: 'Food' });
  });

  it('never silently overwrites a clash: it keeps my value and asks, then honours the choice', async () => {
    const { alice, bob, aliceApp, bobApp } = await sharedPair();
    const a = alice.entries(aliceApp)[0]!;
    const b = bob.entries(bobApp)[0]!;
    await alice.device.records.update(aliceApp, 'expenses', a.id, { amount: 50 });
    await bob.device.records.update(bobApp, 'expenses', b.id, { amount: 60 });
    await alice.engine.sync(aliceApp);
    expect(await bob.engine.sync(bobApp)).toMatchObject({ conflicts: 1 });
    expect(bob.entries(bobApp)[0]!.values.amount).toBe(60);
    const [conflict] = (await bob.store.get(bobApp))!.conflicts;
    expect(conflict).toMatchObject({ kind: 'both_changed', theirActor: 'alice', fields: [{ field: 'amount', mine: 60, theirs: 50 }] });
    expect(bob.engine.status(bobApp).conflicts).toBe(1);

    // While the conflict is open the entry is not sent.
    expect(await bob.engine.sync(bobApp)).toMatchObject({ pushed: 0, conflicts: 1 });

    expect(await bob.engine.resolve(bobApp, conflict!.id, 'mine')).toEqual({ ok: true });
    await bob.engine.sync(bobApp);
    await alice.engine.sync(aliceApp);
    expect(alice.entries(aliceApp)[0]!.values.amount).toBe(60);
  });

  it('taking their version updates this device', async () => {
    const { alice, bob, aliceApp, bobApp } = await sharedPair();
    await alice.device.records.update(aliceApp, 'expenses', alice.entries(aliceApp)[0]!.id, { title: 'Basmati' });
    await bob.device.records.update(bobApp, 'expenses', bob.entries(bobApp)[0]!.id, { title: 'Brown rice' });
    await alice.engine.sync(aliceApp);
    await bob.engine.sync(bobApp);
    const [c] = (await bob.store.get(bobApp))!.conflicts;
    await bob.engine.resolve(bobApp, c!.id, 'theirs');
    await bob.engine.sync(bobApp);
    expect(bob.entries(bobApp)[0]!.values.title).toBe('Basmati');
    expect((await bob.store.get(bobApp))!.conflicts).toEqual([]);
  });

  it('a change against a deletion is a conflict both ways', async () => {
    const { alice, bob, aliceApp, bobApp } = await sharedPair();
    await alice.device.records.remove(aliceApp, 'expenses', alice.entries(aliceApp)[0]!.id);
    await bob.device.records.update(bobApp, 'expenses', bob.entries(bobApp)[0]!.id, { amount: 99 });
    await alice.engine.sync(aliceApp);
    await bob.engine.sync(bobApp);
    const [c] = (await bob.store.get(bobApp))!.conflicts;
    expect(c?.kind).toBe('deleted_there');
    expect(bob.entries(bobApp)).toHaveLength(1); // nothing removed until Bob decides
    await bob.engine.resolve(bobApp, c!.id, 'mine');
    await bob.engine.sync(bobApp);
    await alice.engine.sync(aliceApp);
    expect(alice.entries(aliceApp)[0]?.values.amount).toBe(99);
  });
});

describe('roles and revocation', () => {
  it('a viewer reads but cannot write, locally or in the cloud', async () => {
    const { alice, bob, aliceApp, bobApp, cloud, sharedId } = await sharedPair('viewer');
    expect(titles(bob, bobApp)).toEqual(['Rice']);
    const guarded = bob.engine.guard(bob.device.records);
    await expect(guarded.insert(bobApp, 'expenses', { title: 'X', amount: 1 })).rejects.toBeInstanceOf(CollabReadOnlyError);
    // A batch is several writes at once (cascade delete): a viewer's copy refuses it too, when the repository has one.
    const withBatch = bob.engine.guard({ ...bob.device.records, batch: async () => undefined });
    await expect(withBatch.batch!(bobApp, [{ op: 'insert', collection: 'expenses', values: { title: 'Y', amount: 2 } }])).rejects.toBeInstanceOf(CollabReadOnlyError);
    expect(bob.engine.guard(bob.device.records).batch).toBeUndefined();
    await bob.add(bobApp, { title: 'Sneaky', amount: 1 }); // straight to the database, bypassing the guard
    await bob.engine.sync(bobApp);
    expect(cloud.records(sharedId)).toHaveLength(1);
    await alice.add(aliceApp, { title: 'Oil', amount: 90 });
    await alice.engine.sync(aliceApp);
    await bob.engine.sync(bobApp);
    expect(titles(bob, bobApp)).toContain('Oil');
    expect(await bob.engine.createInvite({ kind: 'app', id: sharedId }, 'viewer')).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('an admin manages editors but not other admins, and nobody can be invited as owner', async () => {
    const { alice, bob, sharedId } = await sharedPair('admin');
    const t = { kind: 'app' as const, id: sharedId };
    expect(await bob.engine.createInvite(t, 'admin')).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(await bob.engine.createInvite(t, 'editor')).toMatchObject({ ok: true });
    const list = await alice.engine.members(t);
    const aliceRow = list.ok ? list.members.find((m) => m.uid === 'alice')! : undefined;
    expect(await bob.engine.removeMember(t, aliceRow!)).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('revocation stops cloud access and removes the copy on the next sync, with a notice', async () => {
    const { alice, bob, bobApp, sharedId } = await sharedPair();
    const t = { kind: 'app' as const, id: sharedId };
    const list = await alice.engine.members(t);
    const bobRow = list.ok ? list.members.find((m) => m.uid === 'bob')! : undefined;
    expect(await alice.engine.removeMember(t, bobRow!)).toEqual({ ok: true });
    await bob.add(bobApp, { title: 'After removal', amount: 1 });
    expect(await bob.engine.sync(bobApp)).toMatchObject({ ended: true });
    expect(await bob.device.apps.get(bobApp)).toBeUndefined();
    expect(bob.entries(bobApp)).toEqual([]);
    expect((await bob.engine.notices())[0]).toMatchObject({ sharedId });
    expect(bob.engine.status(bobApp).shared).toBe(false);
  });

  it('no connection to the cloud never deletes the local copy', async () => {
    const { bob, bobApp, cloud } = await sharedPair();
    cloud.setOffline('bob', true); // every call fails, including the membership check
    expect(await bob.engine.sync(bobApp)).toMatchObject({ ended: false, error: 'offline' });
    expect(await bob.device.apps.get(bobApp)).toBeDefined();
  });

  it('a refused read alone never deletes the local copy', async () => {
    const { bob, bobApp, cloud } = await sharedPair();
    cloud.fail('bob', 'getSpace', 'denied');
    cloud.fail('bob', 'myMembership', 'unavailable'); // cannot confirm the membership is gone
    expect(await bob.engine.sync(bobApp)).toMatchObject({ ended: false, error: 'denied' });
    expect(await bob.device.apps.get(bobApp)).toBeDefined();
    cloud.fail('bob', 'myMembership'); // the membership reads back: still a member, so the refusal is passing
    expect(await bob.engine.sync(bobApp)).toMatchObject({ ended: false, error: 'denied' });
    expect(await bob.device.apps.get(bobApp)).toBeDefined();
    cloud.fail('bob', 'getSpace');
    expect(await bob.engine.sync(bobApp)).toMatchObject({ ended: false, error: undefined });
  });

  it('a stop-sharing clean-up cut short is finished by the owner\'s next sync', async () => {
    const { cloud, alice, bob, aliceApp, bobApp, sharedId } = await sharedPair();
    cloud.breakCleanup();
    expect(await alice.engine.stopSharing(aliceApp)).toMatchObject({ ok: false, code: 'offline' });
    expect(cloud.space(sharedId)?.status).toBe('deleted'); // everyone else is already cut off
    expect(await bob.engine.sync(bobApp)).toMatchObject({ ended: true });
    expect(await alice.engine.sync(aliceApp)).toMatchObject({ ended: true });
    expect(cloud.space(sharedId)).toBeUndefined();
    expect(await alice.store.list()).toEqual([]);
    expect(titles(alice, aliceApp)).toEqual(['Rice']);
  });

  it('the owner cannot leave; a member who leaves loses the local copy and the membership', async () => {
    const { cloud, alice, bob, aliceApp, bobApp, sharedId } = await sharedPair();
    expect(await alice.engine.leave(aliceApp)).toMatchObject({ ok: false, code: 'owner_cannot_leave' });
    expect(await bob.engine.leave(bobApp)).toEqual({ ok: true });
    expect(await bob.device.apps.get(bobApp)).toBeUndefined();
    expect(cloud.members({ kind: 'app', id: sharedId }).map((m) => m.uid)).toEqual(['alice']);
  });

  it('stopping sharing deletes the cloud copy, keeps the owner\'s app, and ends access for others', async () => {
    const { cloud, alice, bob, aliceApp, bobApp, sharedId } = await sharedPair();
    expect(await alice.engine.stopSharing(aliceApp)).toEqual({ ok: true });
    expect(cloud.space(sharedId)).toBeUndefined();
    expect(await alice.device.apps.get(aliceApp)).toBeDefined();
    expect(titles(alice, aliceApp)).toEqual(['Rice']);
    expect(await bob.engine.sync(bobApp)).toMatchObject({ ended: true });
    expect(await bob.device.apps.get(bobApp)).toBeUndefined();
  });

  it('deleting the app on the owner\'s device deletes the cloud copy on the next sync', async () => {
    const { cloud, alice, aliceApp, sharedId } = await sharedPair();
    await alice.device.apps.remove(aliceApp);
    await alice.engine.syncAll();
    expect(cloud.space(sharedId)).toBeUndefined();
    expect(await alice.store.list()).toEqual([]);
  });
});

describe('sync that is cut short or cannot apply everything', () => {
  it('a pull cut short never sends the entries it saved back as new ones', async () => {
    const { cloud, alice, bob, aliceApp, bobApp, sharedId } = await sharedPair();
    await alice.add(aliceApp, { title: 'Oil', amount: 90 });
    await alice.add(aliceApp, { title: 'Tea', amount: 5 });
    await alice.engine.sync(aliceApp);
    // Bob's phone saves both entries, then dies before the sync state is written.
    const put = bob.store.put;
    let puts = 0;
    bob.store.put = async (s) => {
      if (++puts === 2) throw new Error('killed');
      return put(s);
    };
    expect(await bob.engine.sync(bobApp)).toMatchObject({ error: 'unavailable' });
    bob.store.put = put;
    expect(titles(bob, bobApp)).toEqual(['Oil', 'Rice', 'Tea']);
    expect(await bob.engine.sync(bobApp)).toMatchObject({ pushed: 0, error: undefined });
    expect(cloud.records(sharedId)).toHaveLength(3);
    expect(titles(bob, bobApp)).toEqual(['Oil', 'Rice', 'Tea']);
    await bob.add(bobApp, { title: 'Salt', amount: 2 }); // a real new entry still goes out
    expect(await bob.engine.sync(bobApp)).toMatchObject({ pushed: 1 });
    expect(cloud.records(sharedId)).toHaveLength(4);
  });

  it('an entry this device cannot add yet is fetched again until it fits', async () => {
    const { cloud, alice, bob, aliceApp, bobApp } = await sharedPair();
    bob.device.limits.cap = 1; // Bob's list is full
    await alice.add(aliceApp, { title: 'Oil', amount: 90 });
    await alice.engine.sync(aliceApp);
    expect(await bob.engine.sync(bobApp)).toMatchObject({ pulled: 0, skipped: 1 });
    expect(bob.engine.status(bobApp)).toMatchObject({ skipped: 1 });
    cloud.advance(120_000); // well past the pull overlap
    await alice.add(aliceApp, { title: 'Tea', amount: 5 });
    await alice.engine.sync(aliceApp);
    expect(await bob.engine.sync(bobApp)).toMatchObject({ skipped: 2 });
    cloud.advance(120_000);
    bob.device.limits.cap = 10;
    expect(await bob.engine.sync(bobApp)).toMatchObject({ pulled: 2, skipped: 0 });
    expect(titles(bob, bobApp)).toEqual(['Oil', 'Rice', 'Tea']);
  });

  it('values for a field the design no longer has are dropped instead of refusing the entry', async () => {
    const { cloud, alice, aliceApp, sharedId } = await sharedPair();
    await alice.device.records.update(aliceApp, 'expenses', alice.entries(aliceApp)[0]!.id, { paid: true });
    await alice.engine.sync(aliceApp);
    // The owner removes the field; the cloud entry still carries it.
    const mine = (await alice.device.apps.get(aliceApp))!;
    const { paid: _gone, ...fields } = mine.spec.collections.expenses!.fields;
    const spec = { ...mine.spec, collections: { expenses: { ...mine.spec.collections.expenses!, fields } } };
    await alice.device.apps.save({ ...mine, spec }, { summary: 'drop paid', source: 'edit' });
    cloud.fail('alice', 'pushRecord', 'unavailable');
    await alice.engine.sync(aliceApp);
    cloud.fail('alice', 'pushRecord');
    expect(cloud.records(sharedId)[0]?.values.paid).toBe(true);
    const dave = person(cloud, 'dave');
    const invite = await alice.engine.createInvite({ kind: 'app', id: sharedId }, 'viewer');
    if (!invite.ok) throw new Error(invite.message);
    const joined = await dave.engine.join(invite.code, { consent: true });
    if (!joined.ok || joined.kind !== 'app') throw new Error('join failed');
    expect(titles(dave, joined.localAppId)).toEqual(['Rice']);
    expect(dave.entries(joined.localAppId)[0]?.values.paid).toBeUndefined();
  });

  it('a new design that fails the checks keeps the old one and says why', async () => {
    const { cloud, bob, bobApp, sharedId } = await sharedPair();
    Object.assign(cloud.space(sharedId)!, { specVersion: 2, specHash: 'f'.repeat(64) });
    expect(await bob.engine.sync(bobApp)).toMatchObject({ error: 'spec_invalid' });
    expect(bob.engine.status(bobApp)).toMatchObject({ phase: 'error', error: 'spec_invalid' });
    expect((await bob.device.apps.get(bobApp))?.spec.name).toBe('Shop orders');
  });
});

describe('design versions', () => {
  it('only the owner changes the design; members receive each version', async () => {
    const { cloud, alice, bob, aliceApp, bobApp, sharedId } = await sharedPair();
    const mine = (await alice.device.apps.get(aliceApp))!;
    await alice.device.apps.save({ ...mine, spec: { ...mine.spec, name: 'Shop orders 2' } }, { summary: 'rename', source: 'edit' });
    await alice.engine.sync(aliceApp);
    expect(cloud.space(sharedId)?.specVersion).toBe(2);

    const theirs = (await bob.device.apps.get(bobApp))!;
    await bob.device.apps.save({ ...theirs, spec: { ...theirs.spec, name: 'Bob was here' } }, { summary: 'local', source: 'edit' });
    await bob.engine.sync(bobApp);
    expect(cloud.space(sharedId)?.specVersion).toBe(2); // a member's local edit is never sent
    expect((await bob.device.apps.get(bobApp))?.spec.name).toBe('Shop orders 2');
    expect((await bob.store.get(bobApp))?.specVersion).toBe(2);
    expect(cloud.installs(sharedId)).toMatchObject({ alice: 2, bob: 2 });
  });

  it('a member\'s own design edit is replaced by the shared design on the next sync', async () => {
    const { cloud, bob, bobApp, sharedId } = await sharedPair();
    const theirs = (await bob.device.apps.get(bobApp))!;
    await bob.device.apps.save({ ...theirs, spec: { ...theirs.spec, name: 'Bob was here' } }, { summary: 'local', source: 'edit' });
    expect(await bob.engine.sync(bobApp)).toMatchObject({ error: undefined });
    expect((await bob.device.apps.get(bobApp))?.spec.name).toBe('Shop orders');
    expect(cloud.space(sharedId)?.specVersion).toBe(1);
  });
});

describe('teams', () => {
  async function teamSetup() {
    const cloud = createFakeCloud();
    const alice = person(cloud, 'alice');
    const carol = person(cloud, 'carol');
    const app = await alice.addApp();
    await alice.add(app.id, { title: 'Rice', amount: 40 });
    const team = await alice.engine.createTeam('Shop staff');
    if (!team.ok) throw new Error(team.message);
    const shared = await alice.engine.share(app.id, { consent: true, teamId: team.teamId });
    if (!shared.ok) throw new Error(shared.message);
    const invite = await alice.engine.createInvite({ kind: 'team', id: team.teamId }, 'editor');
    if (!invite.ok) throw new Error(invite.message);
    await carol.engine.join(invite.code, { consent: true });
    expect(await carol.engine.getTeamApp(shared.sharedId, { consent: false })).toMatchObject({ ok: false, code: 'no_consent' });
    const got = await carol.engine.getTeamApp(shared.sharedId, { consent: true });
    if (!got.ok) throw new Error(got.message);
    return { cloud, alice, carol, aliceApp: app.id, carolApp: got.localAppId, teamId: team.teamId, sharedId: shared.sharedId };
  }

  it('access through a team ends only when the team no longer gives it', async () => {
    const { cloud, alice, carol, aliceApp, carolApp } = await teamSetup();
    cloud.fail('carol', 'getSpace', 'denied'); // a passing refusal while the team still lists the app
    expect(await carol.engine.sync(carolApp)).toMatchObject({ ended: false, error: 'denied' });
    expect(await carol.device.apps.get(carolApp)).toBeDefined();
    cloud.fail('carol', 'getSpace');
    expect(await alice.engine.setTeam(aliceApp, null)).toEqual({ ok: true });
    expect(await carol.engine.sync(carolApp)).toMatchObject({ ended: true });
    expect(await carol.device.apps.get(carolApp)).toBeUndefined();
  });

  it('managers see which design version each person has, including people in the team', async () => {
    const { alice, carol, aliceApp, carolApp } = await teamSetup();
    const d = await alice.engine.deployment(aliceApp);
    if (!d.ok) throw new Error(d.message);
    expect(d.latest).toBe(1);
    expect(d.people.map((p) => [p.uid, p.role, p.version])).toEqual([['alice', 'owner', 1], ['carol', 'editor', 1]]);
    expect(await carol.engine.deployment(carolApp)).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('an app whose team was deleted can leave it or move to another team, and a failed team step is reported', async () => {
    const { cloud, alice, aliceApp, teamId, sharedId } = await teamSetup();
    expect(await alice.engine.deleteTeam(teamId)).toEqual({ ok: true });
    expect(await alice.engine.setTeam(aliceApp, null)).toEqual({ ok: true });
    expect(cloud.space(sharedId)?.teamId).toBeNull();
    const next = await alice.engine.createTeam('Night shift');
    if (!next.ok) throw new Error(next.message);
    expect(await alice.engine.setTeam(aliceApp, next.teamId)).toEqual({ ok: true });
    expect(cloud.space(sharedId)?.teamId).toBe(next.teamId);
    const other = await alice.addApp('alice_two');
    const shared = await alice.engine.share(other.id, { consent: true, teamId });
    expect(shared).toMatchObject({ ok: true, teamError: expect.any(String) });
  });

  it('a team member gets the team\'s apps with the team role, and loses them on leaving', async () => {
    const cloud = createFakeCloud();
    const alice = person(cloud, 'alice');
    const carol = person(cloud, 'carol');
    const app = await alice.addApp();
    await alice.add(app.id, { title: 'Rice', amount: 40 });
    const team = await alice.engine.createTeam('Shop staff');
    if (!team.ok) throw new Error(team.message);
    const shared = await alice.engine.share(app.id, { consent: true, teamId: team.teamId });
    if (!shared.ok) throw new Error(shared.message);
    expect(cloud.space(shared.sharedId)?.teamId).toBe(team.teamId);

    const invite = await alice.engine.createInvite({ kind: 'team', id: team.teamId }, 'editor');
    if (!invite.ok) throw new Error(invite.message);
    expect(await carol.engine.join(invite.code, { consent: true })).toMatchObject({ ok: true, kind: 'team', teamId: team.teamId });
    const view = await carol.engine.team(team.teamId);
    expect(view).toMatchObject({ ok: true, name: 'Shop staff', role: 'editor' });
    const got = await carol.engine.getTeamApp(shared.sharedId, { consent: true });
    if (!got.ok) throw new Error(got.message);
    expect(titles(carol, got.localAppId)).toEqual(['Rice']);
    expect((await carol.store.get(got.localAppId))?.role).toBe('editor');

    await carol.add(got.localAppId, { title: 'Salt', amount: 2 });
    expect(await carol.engine.sync(got.localAppId)).toMatchObject({ pushed: 1 });

    expect(await carol.engine.leaveTeam(team.teamId)).toEqual({ ok: true });
    expect(await carol.engine.sync(got.localAppId)).toMatchObject({ ended: true });
    expect(await carol.device.apps.get(got.localAppId)).toBeUndefined();
  });

  it('a used-up or wrong invite is refused', async () => {
    const cloud = createFakeCloud();
    const alice = person(cloud, 'alice');
    const bob = person(cloud, 'bob');
    const dave = person(cloud, 'dave');
    const app = await alice.addApp();
    const shared = await alice.engine.share(app.id, { consent: true });
    if (!shared.ok) throw new Error('share');
    const invite = await alice.engine.createInvite({ kind: 'app', id: shared.sharedId }, 'editor', { maxUses: 1 });
    if (!invite.ok) throw new Error('invite');
    expect(await bob.engine.join(invite.code, { consent: false })).toMatchObject({ ok: false, code: 'no_consent' });
    expect(await bob.engine.join(invite.code, { consent: true })).toMatchObject({ ok: true });
    expect(await dave.engine.join(invite.code, { consent: true })).toMatchObject({ ok: false, code: 'invite_refused' });
    expect(await dave.engine.join('not a code', { consent: true })).toMatchObject({ ok: false, code: 'invalid_code' });
  });
});
