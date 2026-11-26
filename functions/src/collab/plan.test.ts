import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inviterRank, joinRequestSchema, parseInviteToken, planJoin, publicName, type InviteState } from './plan.js';

const invite = (o: Partial<InviteState> = {}): InviteState => ({ role: 'editor', expiresAtMs: 2_000, maxUses: 2, uses: 0, createdBy: 'alice', ...o });
const join = (o: Partial<Parameters<typeof planJoin>[0]> = {}) => planJoin({
  uid: 'bob', invite: invite(), target: { status: 'active', ownerUid: 'alice' }, existingRole: null, creatorRank: 4, nowMs: 1_000, ...o,
});

test('tokens: app and team ids, strict secret shape', () => {
  const app = 's' + 'a'.repeat(19);
  assert.deepEqual(parseInviteToken(`${app}.ABCDEFGHIJKLMNOPQRST`), { kind: 'app', id: app, secret: 'ABCDEFGHIJKLMNOPQRST' });
  assert.equal(parseInviteToken(`t${'b'.repeat(19)}.ABCDEFGHIJKLMNOPQRS2`)?.kind, 'team');
  assert.equal(parseInviteToken(`${app}.abcdefghijklmnopqrst`), null);
  assert.equal(parseInviteToken(`x${'a'.repeat(19)}.ABCDEFGHIJKLMNOPQRST`), null);
  assert.equal(parseInviteToken('../../etc'), null);
  assert.equal(joinRequestSchema.safeParse({ token: 'x'.repeat(30), extra: 1 }).success, false);
});

test('join: a valid invite adds the role and counts one use', () => {
  assert.deepEqual(join(), { ok: true, already: false, role: 'editor', uses: 1 });
});

test('join: refuses expired, used up, cancelled, owner-role and stopped', () => {
  assert.deepEqual(join({ invite: invite({ expiresAtMs: 1_000 }) }), { ok: false, code: 'expired' });
  assert.deepEqual(join({ invite: invite({ uses: 2 }) }), { ok: false, code: 'used_up' });
  assert.deepEqual(join({ invite: null }), { ok: false, code: 'invalid_invite' });
  assert.deepEqual(join({ invite: invite({ role: 'owner' }) }), { ok: false, code: 'invalid_invite' });
  assert.deepEqual(join({ target: { status: 'deleted', ownerUid: 'alice' } }), { ok: false, code: 'gone' });
  assert.deepEqual(join({ target: null }), { ok: false, code: 'gone' });
});

test('join: people already in keep their role and use nothing', () => {
  assert.deepEqual(join({ existingRole: 'viewer', invite: invite({ role: 'admin' }) }), { ok: true, already: true, role: 'viewer' });
  assert.deepEqual(join({ uid: 'alice' }), { ok: true, already: true, role: 'owner' });
});

test('join: an invite only works while its creator may still invite to that role', () => {
  // Removed or demoted to editor: their codes stop working.
  assert.deepEqual(join({ creatorRank: 0 }), { ok: false, code: 'invalid_invite' });
  assert.deepEqual(join({ creatorRank: 2 }), { ok: false, code: 'invalid_invite' });
  // An admin may invite editors and viewers, never other admins.
  assert.deepEqual(join({ creatorRank: 3 }), { ok: true, already: false, role: 'editor', uses: 1 });
  assert.deepEqual(join({ creatorRank: 3, invite: invite({ role: 'admin' }) }), { ok: false, code: 'invalid_invite' });
});

test('inviter rank: owner, own row, or team row capped at admin while the team is active', () => {
  assert.equal(inviterRank({ creatorUid: 'alice', ownerUid: 'alice', directRole: undefined }), 4);
  assert.equal(inviterRank({ creatorUid: 'ann', ownerUid: 'alice', directRole: 'admin' }), 3);
  assert.equal(inviterRank({ creatorUid: 'ann', ownerUid: 'alice', directRole: undefined }), 0);
  assert.equal(inviterRank({ creatorUid: 'tara', ownerUid: 'alice', directRole: undefined, teamRole: 'owner', teamActive: true }), 3);
  assert.equal(inviterRank({ creatorUid: 'tara', ownerUid: 'alice', directRole: undefined, teamRole: 'owner', teamActive: false }), 0);
  assert.equal(inviterRank({ creatorUid: '', ownerUid: '', directRole: undefined }), 0);
});

test('public names never carry markup', () => {
  assert.equal(publicName(' <b>Ravi</b> '), 'bRavi/b');
  assert.equal(publicName(undefined), '');
  assert.equal(publicName('x'.repeat(60)).length, 40);
});
