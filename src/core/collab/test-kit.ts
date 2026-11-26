/**
 * Fakes for the collaboration tests (imported only by *.test.ts). `createFakeCloud` is one shared
 * in-memory "Firestore" that applies the same membership and version rules as firestore.rules, and
 * hands each person their own `CollabRemote`. Stopping sharing works in two steps like the real adapter
 * (status 'deleted', then clean-up), and any call can be made to fail for one person. Devices get an
 * in-memory app + record database that checks values like the real one (unknown fields, required
 * fields, a per-list cap).
 */
import type { AppRepository, KalamRecord, RecordRepository, RecordValue, StoredApp } from '../contracts';
import { fixtureSpec } from '../backup/test-fixtures';
import type { KalamSpec } from '../spec/schema';
import { createCollabEngine, type CollabEngine, type CollabUser } from './engine';
import { parseToken, secretHash } from './invite';
import type { AuditEntry, Invite, Member, RemoteRecord, RemoteSpace, Role, Target, Team } from './model';
import type { CollabRemote, CollabStateStore, RemoteError, RemoteResult } from './ports';
import { createMemoryCollabStore } from './ports';
import { effectiveRole, roleRank } from './roles';

const ok = <T>(value: T): RemoteResult<T> => ({ ok: true, value });
const no = <T>(error: 'offline' | 'denied' | 'not_found'): RemoteResult<T> => ({ ok: false, error });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function createFakeCloud() {
  let clock = 1_000;
  const spaces = new Map<string, RemoteSpace>();
  const teams = new Map<string, Team>();
  const members = new Map<string, Map<string, Member>>();
  const records = new Map<string, Map<string, RemoteRecord>>();
  const invites = new Map<string, Map<string, Invite>>();
  const audit = new Map<string, AuditEntry[]>();
  const installs = new Map<string, Map<string, number>>();
  const offline = new Set<string>();
  /** `${uid}:${method}` → the error that call returns. */
  const failures = new Map<string, RemoteError>();
  let cleanupFails = 0;
  const key = (t: Target) => `${t.kind}:${t.id}`;
  const membersOf = (t: Target) => members.get(key(t)) ?? members.set(key(t), new Map()).get(key(t))!;
  const tick = () => (clock += 10);

  function rank(sid: string, uid: string): number {
    const s = spaces.get(sid);
    if (!s || s.status !== 'active') return 0;
    const direct = membersOf({ kind: 'app', id: sid }).get(uid)?.role;
    const team = s.teamId && teams.get(s.teamId)?.status === 'active' ? membersOf({ kind: 'team', id: s.teamId }).get(uid)?.role : undefined;
    return roleRank(effectiveRole(direct, team));
  }
  const targetRank = (t: Target, uid: string) =>
    t.kind === 'app' ? rank(t.id, uid) : teams.get(t.id)?.status === 'active' ? roleRank(membersOf(t).get(uid)?.role) : 0;
  const log = (sid: string, e: Omit<AuditEntry, 'id' | 'at'>) => {
    const list = audit.get(sid) ?? [];
    list.unshift({ id: `e${list.length}`, at: clock, ...e });
    audit.set(sid, list);
  };

  function remoteFor(uid: string, name = uid): CollabRemote {
    const gate = <T>(work: () => RemoteResult<T>): Promise<RemoteResult<T>> => Promise.resolve(offline.has(uid) ? no<T>('offline') : work());
    const remote: CollabRemote = {
      createSpace: (i) => gate(() => {
        spaces.set(i.sharedId, { sharedId: i.sharedId, ownerUid: uid, title: i.title, status: 'active', specGz: i.specGz, specHash: i.specHash, specVersion: 1, teamId: null, updatedAt: tick() });
        membersOf({ kind: 'app', id: i.sharedId }).set(uid, { uid, role: 'owner', name: i.ownerName, joinedAt: clock, installedVersion: 1 });
        log(i.sharedId, { actor: uid, kind: 'shared' });
        return ok(undefined);
      }),
      getSpace: (sid) => gate(() => {
        const s = spaces.get(sid);
        if (!s) return no('not_found');
        const member = membersOf({ kind: 'app', id: sid }).has(uid);
        return s.ownerUid === uid || member || rank(sid, uid) > 0 ? ok(copy(s)) : no('denied');
      }),
      myMembership: (t) => gate(() => ok(copy(membersOf(t).get(uid) ?? null))),
      updateSpec: (sid, i) => gate(() => {
        const s = spaces.get(sid);
        if (!s || s.ownerUid !== uid || s.status !== 'active' || i.specVersion !== s.specVersion + 1) return no('denied');
        Object.assign(s, { specGz: i.specGz, specHash: i.specHash, specVersion: i.specVersion, updatedAt: tick() });
        log(sid, { actor: uid, kind: 'spec_updated', version: i.specVersion });
        return ok(undefined);
      }),
      pullRecords: (sid, since) => gate(() => {
        if (rank(sid, uid) < 1) return no('denied');
        return ok(copy([...(records.get(sid)?.values() ?? [])].filter((r) => r.updatedAt >= since).sort((a, b) => a.updatedAt - b.updatedAt)));
      }),
      pushRecord: (sid, w) => gate(() => {
        if (rank(sid, uid) < 2) return no('denied');
        const list = records.get(sid) ?? records.set(sid, new Map()).get(sid)!;
        const current = list.get(w.id) ?? null;
        if ((current?.version ?? 0) !== w.baseVersion) return ok({ status: 'conflict' as const, current: copy(current) });
        const version = w.baseVersion + 1;
        list.set(w.id, {
          id: w.id, collectionId: w.collectionId, values: w.deleted ? {} : copy(w.values), version, deleted: w.deleted,
          createdBy: current?.createdBy ?? uid, updatedBy: uid, updatedAt: tick(),
        });
        log(sid, { actor: uid, kind: w.deleted ? 'record_deleted' : current ? 'record_updated' : 'record_created', target: w.id, version });
        return ok({ status: 'written' as const, version });
      }),
      setInstalledVersion: (sid, v) => gate(() => {
        if (rank(sid, uid) < 1) return no('denied');
        (installs.get(sid) ?? installs.set(sid, new Map()).get(sid)!).set(uid, v);
        return ok(undefined);
      }),
      listInstalls: (sid) => gate(() => (rank(sid, uid) >= 3 ? ok(Object.fromEntries(installs.get(sid) ?? [])) : no('denied'))),
      deleteSpace: (sid) => gate(() => {
        const s = spaces.get(sid);
        if (!s) return no('not_found');
        if (s.ownerUid !== uid) return no('denied');
        // Like the adapter: cut everyone off first, then clean up (which a test can make fail part way).
        s.status = 'deleted';
        if (cleanupFails > 0) {
          cleanupFails--;
          records.delete(sid);
          return no('offline');
        }
        spaces.delete(sid);
        installs.delete(sid);
        members.delete(key({ kind: 'app', id: sid }));
        records.delete(sid);
        invites.delete(key({ kind: 'app', id: sid }));
        audit.delete(sid);
        return ok(undefined);
      }),
      join: (token) => gate(() => {
        const p = parseToken(token);
        if (!p) return no('denied');
        const inv = invites.get(key(p.target))?.get(secretHash(p.secret));
        const alive = p.target.kind === 'app' ? spaces.get(p.target.id)?.status === 'active' : teams.get(p.target.id)?.status === 'active';
        if (!inv || !alive || inv.expiresAt <= clock || inv.uses >= inv.maxUses) return { ok: false, error: 'denied', message: 'This invite does not work any more.' };
        const existing = membersOf(p.target).get(uid);
        if (existing) return ok({ target: p.target, role: existing.role, already: true });
        inv.uses++;
        membersOf(p.target).set(uid, { uid, role: inv.role, name, joinedAt: tick(), installedVersion: 0 });
        if (p.target.kind === 'app') log(p.target.id, { actor: uid, kind: 'member_joined', target: uid, role: inv.role });
        return ok({ target: p.target, role: inv.role as Role, already: false });
      }),
      listMembers: (t) => gate(() => (targetRank(t, uid) >= 1 ? ok(copy([...membersOf(t).values()])) : no('denied'))),
      setRole: (t, target, role) => gate(() => {
        const m = membersOf(t).get(target);
        const me = targetRank(t, uid);
        if (!m || me < 3 || roleRank(m.role) >= me || roleRank(role) >= me || role === 'owner') return no('denied');
        m.role = role;
        return ok(undefined);
      }),
      removeMember: (t, target, leaving) => gate(() => {
        const m = membersOf(t).get(target);
        if (!m) return no('denied');
        const allowed = leaving ? target === uid && m.role !== 'owner' : targetRank(t, uid) >= 3 && roleRank(m.role) < targetRank(t, uid);
        if (!allowed) return no('denied');
        membersOf(t).delete(target);
        return ok(undefined);
      }),
      createInvite: (t, i) => gate(() => {
        if (targetRank(t, uid) < 3 || roleRank(i.role) >= targetRank(t, uid)) return no('denied');
        const list = invites.get(key(t)) ?? invites.set(key(t), new Map()).get(key(t))!;
        list.set(i.hash, { ...i, createdBy: uid, createdAt: clock, uses: 0 });
        return ok(undefined);
      }),
      listInvites: (t) => gate(() => (targetRank(t, uid) >= 3 ? ok(copy([...(invites.get(key(t))?.values() ?? [])])) : no('denied'))),
      deleteInvite: (t, hash) => gate(() => {
        if (targetRank(t, uid) < 3) return no('denied');
        invites.get(key(t))?.delete(hash);
        return ok(undefined);
      }),
      readAudit: (sid, limit) => gate(() => (rank(sid, uid) >= 1 ? ok(copy((audit.get(sid) ?? []).slice(0, limit))) : no('denied'))),
      createTeam: (i) => gate(() => {
        teams.set(i.teamId, { teamId: i.teamId, name: i.name, ownerUid: uid, status: 'active', apps: [] });
        membersOf({ kind: 'team', id: i.teamId }).set(uid, { uid, role: 'owner', name: i.ownerName, joinedAt: tick(), installedVersion: 0 });
        return ok(undefined);
      }),
      getTeam: (tid) => gate(() => {
        const t = teams.get(tid);
        if (!t) return no('not_found');
        return t.ownerUid === uid || targetRank({ kind: 'team', id: tid }, uid) >= 1 ? ok(copy(t)) : no('denied');
      }),
      setAppTeam: (sid, c) => gate(() => {
        const s = spaces.get(sid);
        if (!s || s.ownerUid !== uid) return no('denied');
        if (c.to && targetRank({ kind: 'team', id: c.to }, uid) < 3) return no('denied');
        s.teamId = c.to;
        if (c.from && teams.get(c.from)) teams.get(c.from)!.apps = copy(c.fromApps);
        if (c.to && teams.get(c.to)) teams.get(c.to)!.apps = copy(c.toApps);
        return ok(undefined);
      }),
      deleteTeam: (tid) => gate(() => {
        const t = teams.get(tid);
        if (!t || t.ownerUid !== uid) return no('denied');
        teams.delete(tid);
        members.delete(key({ kind: 'team', id: tid }));
        return ok(undefined);
      }),
    };
    for (const k of Object.keys(remote) as (keyof CollabRemote)[]) {
      const real = remote[k] as (...a: unknown[]) => Promise<RemoteResult<unknown>>;
      (remote as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => {
        const f = failures.get(`${uid}:${k}`);
        return f ? Promise.resolve({ ok: false, error: f }) : real(...a);
      };
    }
    return remote;
  }

  return {
    remoteFor,
    setOffline(uid: string, value: boolean) {
      if (value) offline.add(uid);
      else offline.delete(uid);
    },
    /** Makes one person's calls to `method` fail with `error` until called again without an error. */
    fail(uid: string, method: keyof CollabRemote, error?: RemoteError) {
      if (error) failures.set(`${uid}:${method}`, error);
      else failures.delete(`${uid}:${method}`);
    },
    /** The next `n` clean-ups after stopping are cut short (the app is already marked stopped). */
    breakCleanup(n = 1) {
      cleanupFails = n;
    },
    installs: (sid: string) => Object.fromEntries(installs.get(sid) ?? []),
    /** Moves the cloud clock forward, past the pull overlap window. */
    advance(ms: number) {
      clock += ms;
    },
    space: (sid: string) => spaces.get(sid),
    records: (sid: string) => [...(records.get(sid)?.values() ?? [])],
    members: (t: Target) => [...membersOf(t).values()],
    audit: (sid: string) => audit.get(sid) ?? [],
    tick,
  };
}
export type FakeCloud = ReturnType<typeof createFakeCloud>;

/** One device: apps + records in memory, with the change listeners the runtime and scheduler use. */
export function createFakeDevice() {
  const apps = new Map<string, StoredApp>();
  const rows: KalamRecord[] = [];
  const listeners = new Map<string, Set<() => void>>();
  let n = 0;
  const emit = (appId: string) => listeners.get(appId)?.forEach((l) => l());
  const appRepo: Pick<AppRepository, 'get' | 'save' | 'remove'> = {
    get: async (id) => (apps.has(id) ? copy(apps.get(id)!) : undefined),
    async save(app) {
      const prev = apps.get(app.id);
      const saved = { ...copy(app), spec: { ...copy(app.spec), version: (prev?.spec.version ?? 0) + 1 } };
      apps.set(app.id, saved);
      return copy(saved);
    },
    async remove(id) {
      apps.delete(id);
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.appId === id) rows.splice(i, 1);
    },
  };
  const limits = { cap: Number.POSITIVE_INFINITY };
  /** Same checks as the real database's: known fields only, required fields filled, the list not full. */
  const check = (appId: string, collectionId: string, values: Record<string, RecordValue>) => {
    const fields = apps.get(appId)?.spec.collections[collectionId]?.fields;
    if (!fields) throw new Error('No such collection');
    for (const k of Object.keys(values)) if (!Object.prototype.hasOwnProperty.call(fields, k)) throw new Error(`Unknown field ${k}`);
    for (const [k, f] of Object.entries(fields)) if (f.required && (values[k] === undefined || values[k] === null || values[k] === '')) throw new Error(`Required ${k}`);
  };
  const records: RecordRepository = {
    list: async (a, c) => copy(rows.filter((r) => r.appId === a && r.collectionId === c)),
    async listAll(a) {
      const out: Record<string, KalamRecord[]> = {};
      for (const id of Object.keys(apps.get(a)?.spec.collections ?? {})) out[id] = [];
      for (const r of rows.filter((x) => x.appId === a)) (out[r.collectionId] ??= []).push(copy(r));
      return out;
    },
    async insert(a, c, values) {
      check(a, c, values);
      if (rows.filter((r) => r.appId === a && r.collectionId === c).length >= limits.cap) throw new Error('This list is full');
      const r: KalamRecord = { id: `local${++n}`, appId: a, collectionId: c, createdAt: n, updatedAt: n, values: copy(values) };
      rows.push(r);
      emit(a);
      return copy(r);
    },
    async update(a, c, id, values) {
      const r = rows.find((x) => x.id === id && x.appId === a && x.collectionId === c);
      if (!r) throw new Error('Record not found');
      const fields = apps.get(a)?.spec.collections[c]?.fields ?? {};
      const kept = Object.fromEntries(Object.entries(r.values).filter(([k]) => Object.prototype.hasOwnProperty.call(fields, k)));
      check(a, c, { ...kept, ...values });
      r.values = { ...r.values, ...copy(values) };
      emit(a);
      return copy(r);
    },
    async remove(a, c, id) {
      const i = rows.findIndex((x) => x.id === id && x.appId === a && x.collectionId === c);
      if (i < 0) throw new Error('Record not found');
      rows.splice(i, 1);
      emit(a);
    },
    subscribe(a, l) {
      const set = listeners.get(a) ?? listeners.set(a, new Set()).get(a)!;
      set.add(l);
      return () => void set.delete(l);
    },
  };
  return { apps: appRepo, records, rawApps: apps, rows, limits };
}

let seq = 0;
/** Deterministic "random" bytes: unique per call, so ids and secrets never collide in a test. */
export function fakeRandom(n: number): Uint8Array {
  seq++;
  return Uint8Array.from({ length: n }, (_, i) => (seq * 7 + i * 13) % 256);
}

export interface Person {
  uid: string;
  engine: CollabEngine;
  device: ReturnType<typeof createFakeDevice>;
  store: CollabStateStore;
  online: { value: boolean };
  user: { value: CollabUser | null };
  /** Adds an app with the expense fixture design. */
  addApp(id?: string): Promise<StoredApp>;
  entries(appId: string): KalamRecord[];
  add(appId: string, values: Record<string, RecordValue>): Promise<KalamRecord>;
}

export function person(cloud: FakeCloud, uid: string): Person {
  const device = createFakeDevice();
  const store = createMemoryCollabStore();
  const online = { value: true };
  const user = { value: { uid, name: uid[0]!.toUpperCase() + uid.slice(1), isAnonymous: false } as CollabUser | null };
  let apps = 0;
  const engine = createCollabEngine({
    remote: cloud.remoteFor(uid, user.value!.name),
    store,
    apps: device.apps,
    records: device.records,
    online: () => online.value,
    user: () => user.value,
    randomBytes: fakeRandom,
    newAppId: () => `${uid}_app${++apps}`,
    now: () => cloud.tick(),
  });
  return {
    uid, engine, device, store, online, user,
    async addApp(id = `${uid}_own`) {
      const spec: KalamSpec = fixtureSpec(id, 'Shop orders');
      return device.apps.save({ id, spec, createdAt: 1, updatedAt: 1, origin: { route: 'template' } }, { summary: 'test', source: 'create' });
    },
    entries: (appId) => device.rows.filter((r) => r.appId === appId),
    add: (appId, values) => device.records.insert(appId, 'expenses', values),
  };
}
