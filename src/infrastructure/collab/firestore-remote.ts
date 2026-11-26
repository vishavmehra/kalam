/**
 * `CollabRemote` over Cloud Firestore, named database `kalam` (docs/14 §17.4). Decisions live in
 * `@/core/collab`; this file only moves documents. Every document read back is parsed with Zod and
 * dropped if it does not fit. firestore.rules enforce membership, roles, versions and the audit line
 * for every write; nothing here is trusted to do that.
 */
import {
  collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, setDoc, startAfter, Timestamp,
  updateDoc, where, writeBatch, type CollectionReference, type DocumentData, type DocumentReference, type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  auditEntrySchema, COLLAB_LIMITS, inviteSchema, memberSchema, remoteRecordSchema, remoteSpaceSchema, teamSchema, uidSchema,
  type AuditEntry, type CollabRemote, type Invite, type Member, type RemoteError, type RemoteRecord, type RemoteResult, type Target,
} from '@/core/collab';
import type { z } from 'zod';

export interface FirestoreRemoteDeps {
  firestore: () => Firestore | undefined;
  uid: () => string | undefined;
  /** kalamCollabJoin (the only trusted step). */
  join: CollabRemote['join'];
  /** Six random [a-z0-9] characters for audit entry ids. */
  randomSuffix: () => string;
}

const millis = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0);
const ok = <T>(value: T): RemoteResult<T> => ({ ok: true, value });
const err = <T>(error: RemoteError): RemoteResult<T> => ({ ok: false, error });

export function remoteErrorOf(e: unknown): RemoteError {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (code === 'permission-denied' || code === 'unauthenticated') return 'denied';
  if (code === 'not-found') return 'not_found';
  if (code === 'unavailable' || code === 'deadline-exceeded') return 'offline';
  return 'unavailable';
}

function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> | undefined {
  const p = schema.safeParse(value);
  return p.success ? p.data : undefined;
}

export const toMember = (d: QueryDocumentSnapshot | { id: string; data: () => DocumentData | undefined }): Member | undefined => {
  const x = d.data() ?? {};
  return parse(memberSchema, { uid: d.id, role: x.role, name: x.name ?? '', joinedAt: millis(x.joinedAt), installedVersion: x.installedVersion ?? 0 });
};
export const toRecord = (id: string, x: DocumentData): RemoteRecord | undefined =>
  parse(remoteRecordSchema, {
    id, collectionId: x.collectionId, values: x.values ?? {}, version: x.version, deleted: x.deleted === true,
    createdBy: x.createdBy, updatedBy: x.updatedBy, updatedAt: millis(x.updatedAt),
  });
const toInvite = (id: string, x: DocumentData): Invite | undefined =>
  parse(inviteSchema, {
    hash: id, role: x.role, createdBy: x.createdBy, createdAt: millis(x.createdAt), expiresAt: millis(x.expiresAt), maxUses: x.maxUses, uses: x.uses,
  });
const toAudit = (id: string, x: DocumentData): AuditEntry | undefined =>
  parse(auditEntrySchema, {
    id, actor: x.actor, kind: x.kind, at: millis(x.at), target: x.target ?? undefined, collectionId: x.collectionId ?? undefined,
    version: x.version ?? undefined, role: x.role ?? undefined,
  });

export function createFirestoreRemote(deps: FirestoreRemoteDeps): CollabRemote {
  async function attempt<T>(work: (db: Firestore, uid: string) => Promise<RemoteResult<T>>): Promise<RemoteResult<T>> {
    const db = deps.firestore();
    if (!db) return err('not_set_up');
    const uid = deps.uid();
    if (!uid) return err('denied');
    try {
      return await work(db, uid);
    } catch (e) {
      return err(remoteErrorOf(e));
    }
  }
  const root = (db: Firestore, t: Target): DocumentReference => doc(db, t.kind === 'app' ? 'collabApps' : 'collabTeams', t.id);
  const sub = (db: Firestore, t: Target, name: 'members' | 'invites' | 'records' | 'audit' | 'installs'): CollectionReference => collection(root(db, t), name);
  const app = (sharedId: string): Target => ({ kind: 'app', id: sharedId });
  const auditRef = (db: Firestore, sharedId: string, id = `e_${Date.now()}_${deps.randomSuffix()}`) => doc(sub(db, app(sharedId), 'audit'), id);

  /** Deletes a whole sub-collection in batches (the owner's clean-up after stopping). */
  async function deleteAll(ref: CollectionReference): Promise<void> {
    for (;;) {
      const snap = await getDocs(query(ref, limit(COLLAB_LIMITS.pullPage)));
      if (snap.empty) return;
      const batch = writeBatch(ref.firestore);
      for (const d of snap.docs) batch.delete(d.ref);
      await batch.commit();
    }
  }

  return {
    createSpace: (i) => attempt(async (db, uid) => {
      const t = app(i.sharedId);
      const batch = writeBatch(db);
      batch.set(root(db, t), {
        ownerUid: uid, title: i.title, status: 'active', specGz: i.specGz, specHash: i.specHash, specVersion: 1, teamId: null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      batch.set(doc(sub(db, t, 'members'), uid), { role: 'owner', name: i.ownerName, joinedAt: serverTimestamp(), addedBy: uid, installedVersion: 1 });
      batch.set(auditRef(db, i.sharedId, 'shared'), { actor: uid, kind: 'shared', at: serverTimestamp() });
      await batch.commit();
      return ok(undefined);
    }),

    getSpace: (sharedId) => attempt(async (db) => {
      const snap = await getDoc(root(db, app(sharedId)));
      if (!snap.exists()) return err('not_found');
      const x = snap.data();
      const space = parse(remoteSpaceSchema, {
        sharedId, ownerUid: x.ownerUid, title: x.title, status: x.status, specGz: x.specGz, specHash: x.specHash, specVersion: x.specVersion,
        teamId: x.teamId ?? null, updatedAt: millis(x.updatedAt),
      });
      return space ? ok(space) : err('invalid');
    }),

    myMembership: (t) => attempt(async (db, uid) => {
      const snap = await getDoc(doc(sub(db, t, 'members'), uid));
      return ok(snap.exists() ? toMember(snap) ?? null : null);
    }),

    updateSpec: (sharedId, i) => attempt(async (db, uid) => {
      const batch = writeBatch(db);
      batch.update(root(db, app(sharedId)), { specGz: i.specGz, specHash: i.specHash, specVersion: i.specVersion, updatedAt: serverTimestamp() });
      batch.set(auditRef(db, sharedId, `s_${i.specVersion}`), { actor: uid, kind: 'spec_updated', at: serverTimestamp(), version: i.specVersion });
      await batch.commit();
      return ok(undefined);
    }),

    pullRecords: (sharedId, since) => attempt(async (db) => {
      const out: RemoteRecord[] = [];
      let after: QueryDocumentSnapshot | undefined;
      for (;;) {
        const q = query(
          sub(db, app(sharedId), 'records'), where('updatedAt', '>=', Timestamp.fromMillis(since)), orderBy('updatedAt'),
          ...(after ? [startAfter(after)] : []), limit(COLLAB_LIMITS.pullPage),
        );
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          const r = toRecord(d.id, d.data());
          if (r) out.push(r);
        }
        if (snap.size < COLLAB_LIMITS.pullPage) return ok(out);
        after = snap.docs[snap.docs.length - 1];
      }
    }),

    pushRecord: (sharedId, w) => attempt(async (db, uid) => {
      const ref = doc(sub(db, app(sharedId), 'records'), w.id);
      const outcome = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists() ? toRecord(snap.id, snap.data()) ?? null : null;
        if (snap.exists() && !current) return { status: 'invalid' as const };
        if ((current?.version ?? 0) !== w.baseVersion) return { status: 'conflict' as const, current };
        const version = w.baseVersion + 1;
        tx.set(ref, {
          collectionId: w.collectionId, values: w.deleted ? {} : w.values, version, deleted: w.deleted,
          createdBy: current?.createdBy ?? uid, updatedBy: uid, updatedAt: serverTimestamp(),
        });
        // Rules require this line in the same write: every change names who made it.
        tx.set(auditRef(db, sharedId, `r_${w.id}_${version}`), {
          actor: uid, kind: w.deleted ? 'record_deleted' : !current || current.deleted ? 'record_created' : 'record_updated',
          at: serverTimestamp(), target: w.id, collectionId: w.collectionId, version,
        });
        return { status: 'written' as const, version };
      });
      return outcome.status === 'invalid' ? err('invalid') : ok(outcome);
    }),

    // Its own document, so people who get the app through a team (and have no member row here) report it too.
    setInstalledVersion: (sharedId, version) => attempt(async (db, uid) => {
      await setDoc(doc(sub(db, app(sharedId), 'installs'), uid), { version, at: serverTimestamp() });
      return ok(undefined);
    }),

    listInstalls: (sharedId) => attempt(async (db) => {
      const snap = await getDocs(sub(db, app(sharedId), 'installs'));
      const out: Record<string, number> = {};
      for (const d of snap.docs) {
        const v = d.data().version;
        if (Number.isInteger(v) && v >= 1 && uidSchema.safeParse(d.id).success) out[d.id] = v;
      }
      return ok(out);
    }),

    deleteSpace: (sharedId) => attempt(async (db) => {
      const t = app(sharedId);
      const snap = await getDoc(root(db, t));
      if (!snap.exists()) return ok(undefined);
      // First cut everyone off in one write, then clean up. A clean-up cut short resumes next time.
      if (snap.data().status === 'active') await updateDoc(root(db, t), { status: 'deleted', updatedAt: serverTimestamp() });
      for (const name of ['records', 'invites', 'audit', 'installs', 'members'] as const) await deleteAll(sub(db, t, name));
      await deleteDoc(root(db, t));
      return ok(undefined);
    }),

    join: (token) => deps.join(token),

    listMembers: (t) => attempt(async (db) => {
      const snap = await getDocs(sub(db, t, 'members'));
      return ok(snap.docs.flatMap((d) => toMember(d) ?? []));
    }),

    setRole: (t, target, role) => attempt(async (db, uid) => {
      const batch = writeBatch(db);
      batch.update(doc(sub(db, t, 'members'), target), { role });
      if (t.kind === 'app') batch.set(auditRef(db, t.id), { actor: uid, kind: 'member_role_changed', at: serverTimestamp(), target, role });
      await batch.commit();
      return ok(undefined);
    }),

    removeMember: (t, target, leaving) => attempt(async (db, uid) => {
      const batch = writeBatch(db);
      batch.delete(doc(sub(db, t, 'members'), target));
      if (t.kind === 'app') batch.set(auditRef(db, t.id), { actor: uid, kind: leaving ? 'member_left' : 'member_removed', at: serverTimestamp(), target });
      await batch.commit();
      return ok(undefined);
    }),

    createInvite: (t, i) => attempt(async (db, uid) => {
      const batch = writeBatch(db);
      batch.set(doc(sub(db, t, 'invites'), i.hash), {
        role: i.role, createdBy: uid, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(i.expiresAt), maxUses: i.maxUses, uses: 0,
      });
      if (t.kind === 'app') batch.set(auditRef(db, t.id), { actor: uid, kind: 'invite_created', at: serverTimestamp(), role: i.role });
      await batch.commit();
      return ok(undefined);
    }),

    listInvites: (t) => attempt(async (db) => {
      const snap = await getDocs(sub(db, t, 'invites'));
      return ok(snap.docs.flatMap((d) => toInvite(d.id, d.data()) ?? []));
    }),

    deleteInvite: (t, hash) => attempt(async (db, uid) => {
      const batch = writeBatch(db);
      batch.delete(doc(sub(db, t, 'invites'), hash));
      if (t.kind === 'app') batch.set(auditRef(db, t.id), { actor: uid, kind: 'invite_revoked', at: serverTimestamp() });
      await batch.commit();
      return ok(undefined);
    }),

    readAudit: (sharedId, max) => attempt(async (db) => {
      const snap = await getDocs(query(sub(db, app(sharedId), 'audit'), orderBy('at', 'desc'), limit(Math.min(max, 100))));
      return ok(snap.docs.flatMap((d) => toAudit(d.id, d.data()) ?? []));
    }),

    createTeam: (i) => attempt(async (db, uid) => {
      const t: Target = { kind: 'team', id: i.teamId };
      const batch = writeBatch(db);
      batch.set(root(db, t), { name: i.name, ownerUid: uid, status: 'active', apps: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      batch.set(doc(sub(db, t, 'members'), uid), { role: 'owner', name: i.ownerName, joinedAt: serverTimestamp(), addedBy: uid, installedVersion: 0 });
      await batch.commit();
      return ok(undefined);
    }),

    getTeam: (teamId) => attempt(async (db) => {
      const snap = await getDoc(root(db, { kind: 'team', id: teamId }));
      if (!snap.exists()) return err('not_found');
      const x = snap.data();
      const team = parse(teamSchema, { teamId, name: x.name, ownerUid: x.ownerUid, status: x.status, apps: Array.isArray(x.apps) ? x.apps : [] });
      return team ? ok(team) : err('invalid');
    }),

    setAppTeam: (sharedId, c) => attempt(async (db, uid) => {
      const batch = writeBatch(db);
      batch.update(root(db, app(sharedId)), { teamId: c.to, updatedAt: serverTimestamp() });
      if (c.from) batch.update(root(db, { kind: 'team', id: c.from }), { apps: c.fromApps, updatedAt: serverTimestamp() });
      if (c.to) batch.update(root(db, { kind: 'team', id: c.to }), { apps: c.toApps, updatedAt: serverTimestamp() });
      const team = c.to ?? c.from;
      batch.set(auditRef(db, sharedId), { actor: uid, kind: c.to ? 'team_app_added' : 'team_app_removed', at: serverTimestamp(), ...(team ? { target: team } : {}) });
      await batch.commit();
      return ok(undefined);
    }),

    deleteTeam: (teamId) => attempt(async (db) => {
      const t: Target = { kind: 'team', id: teamId };
      const snap = await getDoc(root(db, t));
      if (!snap.exists()) return ok(undefined);
      if (snap.data().status === 'active') await updateDoc(root(db, t), { status: 'deleted', updatedAt: serverTimestamp() });
      for (const name of ['invites', 'members'] as const) await deleteAll(sub(db, t, name));
      await deleteDoc(root(db, t));
      return ok(undefined);
    }),
  };
}
