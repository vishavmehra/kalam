/**
 * kalamCollabJoin: the trusted step of sharing (docs/14 §17.6). It checks an invite and adds the
 * caller as a member of a shared app or team, which firestore.rules never let a client do. App Check
 * and a full account (not a guest) are required. The invite secret is only ever compared by its
 * SHA-256; logs hold ids and outcomes, never names or codes.
 */
import { createHash, randomBytes } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/https';
import { createRateLimiter } from '../rate-limit.js';
import { inviterRank, JOIN_MESSAGES, joinRequestSchema, parseInviteToken, planJoin, publicName, type JoinError } from './plan.js';

const DATABASE_ID = 'kalam';
const db = () => getFirestore(getApps()[0] ?? initializeApp(), DATABASE_ID);
// ponytail: per-instance memory; guessing a 100-bit secret is hopeless anyway, this only slows abuse.
const limiter = createRateLimiter({ windowMs: 10 * 60_000, maxPerWindow: 20, maxKeys: 5_000 });

const HTTPS: Record<JoinError, 'invalid-argument' | 'permission-denied' | 'failed-precondition'> = {
  bad_request: 'invalid-argument', invalid_invite: 'permission-denied', expired: 'failed-precondition', used_up: 'failed-precondition',
  gone: 'failed-precondition',
};
const fail = (code: JoinError): never => {
  throw new HttpsError(HTTPS[code], JOIN_MESSAGES[code], { kalamCode: code });
};
const eventId = () => `e_${Date.now()}_${Array.from(randomBytes(6), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')}`;

export const kalamCollabJoin = onCall({ enforceAppCheck: true, maxInstances: 3, timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in to join a shared app.');
  if (auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'Guest accounts cannot join shared apps. Add an email to your account first.', { kalamCode: 'guest' });
  }
  if (limiter.limited(auth.uid)) throw new HttpsError('resource-exhausted', 'Too many tries. Wait a few minutes and try again.', { kalamCode: 'quota' });
  const parsed = joinRequestSchema.safeParse(request.data);
  const token = parsed.success ? parseInviteToken(parsed.data.token) : null;
  if (!token) return fail('bad_request');

  const uid = auth.uid;
  const root = db().collection(token.kind === 'app' ? 'collabApps' : 'collabTeams').doc(token.id);
  const hash = createHash('sha256').update(token.secret, 'utf8').digest('hex');
  const result = await db().runTransaction(async (tx) => {
    const [targetSnap, inviteSnap, memberSnap] = await Promise.all([
      tx.get(root), tx.get(root.collection('invites').doc(hash)), tx.get(root.collection('members').doc(uid)),
    ]);
    const t = targetSnap.data();
    const i = inviteSnap.data();
    // The creator's rights now, not when they made the invite: a removed or demoted admin's codes stop working.
    const creator = typeof i?.createdBy === 'string' ? i.createdBy : '';
    const creatorRow = creator ? await tx.get(root.collection('members').doc(creator)) : undefined;
    const teamId = token.kind === 'app' && typeof t?.teamId === 'string' ? t.teamId : '';
    const teamRef = teamId ? db().collection('collabTeams').doc(teamId) : undefined;
    const [teamSnap, teamRow] = teamRef && creator
      ? await Promise.all([tx.get(teamRef), tx.get(teamRef.collection('members').doc(creator))])
      : [undefined, undefined];
    const creatorRank = inviterRank({
      creatorUid: creator, ownerUid: String(t?.ownerUid ?? ''), directRole: creatorRow?.data()?.role,
      teamRole: teamRow?.data()?.role, teamActive: teamSnap?.data()?.status === 'active',
    });
    const plan = planJoin({
      uid,
      target: t ? { status: String(t.status), ownerUid: String(t.ownerUid) } : null,
      invite: i
        ? {
            role: String(i.role), maxUses: Number(i.maxUses) || 0, uses: Number(i.uses) || 0, createdBy: String(i.createdBy),
            expiresAtMs: i.expiresAt instanceof Timestamp ? i.expiresAt.toMillis() : 0,
          }
        : null,
      existingRole: memberSnap.exists ? String(memberSnap.data()?.role ?? '') : null,
      creatorRank,
      nowMs: Date.now(),
    });
    if (!plan.ok) return fail(plan.code);
    if (plan.already) return { role: plan.role, already: true };
    tx.set(root.collection('members').doc(uid), {
      role: plan.role, name: publicName(auth.token.name), joinedAt: FieldValue.serverTimestamp(), addedBy: String(i?.createdBy ?? ''),
      installedVersion: 0,
    });
    tx.update(root.collection('invites').doc(hash), { uses: plan.uses });
    if (token.kind === 'app') {
      tx.set(root.collection('audit').doc(eventId()), { actor: uid, kind: 'member_joined', at: FieldValue.serverTimestamp(), target: uid, role: plan.role });
    }
    return { role: plan.role, already: false };
  });
  logger.info('kalam_collab_join', { kind: token.kind, id: token.id, already: result.already, role: result.role });
  return { kind: token.kind, id: token.id, role: result.role, already: result.already };
});
