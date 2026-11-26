/**
 * Collaborative apps engine (docs/14 §17, §21). Local first: an app is only shared after its owner
 * signs in and agrees, per app; until then nothing here touches the network. Entries stay in the
 * device database and keep working offline; sync compares them with what the device last agreed with
 * the cloud, sends the difference, then fetches what others changed.
 *
 * Rules this engine keeps:
 * - The cloud refuses a write unless the entry is still at the version this device saw (rules +
 *   transaction). A refused write is merged field by field; a real clash becomes a visible conflict.
 * - Only the owner changes the design. Everyone else receives each new version, saved as a new local
 *   version so their history keeps the old one; a member's own design edits are replaced by the shared one.
 * - Losing access (removed, or the owner stopped sharing) is only acted on when the person's own
 *   membership is confirmed gone; then the local copy is removed. A device that never comes online
 *   again keeps its copy: that is the documented revocation limit (docs/14 §17.6).
 * - Sync state is saved while a pull writes to the device, and a pull that was cut short is finished
 *   before anything is sent, so an entry is never uploaded twice.
 */
import type { AppRepository, KalamRecord, RecordRepository, RecordValue, StoredApp } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { COLLAB_COPY } from './copy';
import { makeToken, newCloudId, parseToken, randomBase32, secretHash, SECRET_LENGTH } from './invite';
import { designHash, localChanges, merge3, packSpec, sameValues, sharedDesign, syncable, unpackSpec, type LocalChange } from './merge';
import {
  COLLAB_LIMITS, type AuditEntry, type Conflict, type EndedNotice, type Invite, type InviteRole, type LocalSpace, type LocalTeam,
  type Member, type RemoteRecord, type RemoteSpace, type Role, type SyncValues, type Target, type TeamApp,
} from './model';
import type { CollabRemote, CollabStateStore, RemoteError } from './ports';
import { canAssign, canChangeStructure, canEditEntries, canLeave, canManageMembers, canRemove, canStopSharing, effectiveRole, invitableRoles, roleRank } from './roles';

export interface CollabUser { uid: string; name: string; isAnonymous: boolean }

export interface CollabDeps {
  remote: CollabRemote;
  store: CollabStateStore;
  apps: Pick<AppRepository, 'get' | 'save' | 'remove'>;
  /** The device database's own repository (not a wrapped one), so applying cloud changes is not seen as new edits. */
  records: RecordRepository;
  online: () => boolean;
  user: () => CollabUser | null;
  randomBytes: (n: number) => Uint8Array;
  newAppId: () => string;
  now?: () => number;
}

export type CollabCode =
  | 'sign_in' | 'guest_account' | 'offline' | 'no_consent' | 'no_app' | 'already_shared' | 'not_shared' | 'spec_too_big'
  | 'spec_invalid' | 'spec_newer' | 'denied' | 'not_set_up' | 'unavailable' | 'invalid_code' | 'invite_refused' | 'not_allowed'
  | 'owner_cannot_leave' | 'gone';
export type Fail = { ok: false; code: CollabCode; message: string };
export type Result<T = object> = ({ ok: true } & T) | Fail;

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error' | 'signed_out';
export interface SyncStatus {
  shared: boolean;
  role?: Role;
  phase: SyncPhase;
  /** Entries changed here and not yet in the cloud (for viewers: changes that cannot be sent). */
  pending: number;
  conflicts: number;
  /** Entries from others this device could not add yet; fetched again on every sync. */
  skipped: number;
  lastSyncAt?: number;
  error?: CollabCode;
}
export interface SyncReport { pushed: number; pulled: number; conflicts: number; skipped: number; ended: boolean; error?: CollabCode }
export interface Deployment { uid: string; name: string; role: Role; version: number }

/** Codes that sync cannot fix by trying again: the person (or the owner) has to change something. */
export const LASTING_CODES: readonly CollabCode[] = ['spec_too_big', 'spec_invalid', 'spec_newer', 'denied', 'not_set_up'];

export class CollabReadOnlyError extends Error {
  readonly code = 'collab_read_only';
  constructor() {
    super(COLLAB_COPY.errors.read_only);
    this.name = 'CollabReadOnlyError';
  }
}

const NOT_SHARED: SyncStatus = { shared: false, phase: 'idle', pending: 0, conflicts: 0, skipped: 0 };
const REMOTE_CODE: Record<RemoteError, CollabCode> = {
  offline: 'offline', denied: 'denied', not_found: 'gone', unavailable: 'unavailable', invalid: 'unavailable', not_set_up: 'not_set_up',
};
const fail = (code: CollabCode, message?: string): Fail => ({ ok: false, code, message: message ?? COLLAB_COPY.errors[code] });
const remoteFail = (r: { error: RemoteError; message?: string }): Fail => fail(REMOTE_CODE[r.error], r.message);
const EMPTY_REPORT: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, skipped: 0, ended: false };

interface PullResult { pulled: number; skipped: number; error?: RemoteError }

export function createCollabEngine(deps: CollabDeps) {
  const { remote, store, apps, records } = deps;
  const now = deps.now ?? Date.now;
  const statuses = new Map<string, SyncStatus>();
  const listeners = new Set<() => void>();
  const chains = new Map<string, Promise<unknown>>();

  const emit = () => {
    for (const l of [...listeners]) {
      try {
        l();
      } catch {
        // A listener never breaks sync.
      }
    }
  };
  const setStatus = (appId: string, s: SyncStatus) => {
    statuses.set(appId, s);
    emit();
  };
  /** One sync at a time per app, so two triggers never interleave writes. Never call it from inside `work`. */
  const serial = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const next = (chains.get(key) ?? Promise.resolve()).then(work, work);
    chains.set(key, next.catch(() => undefined));
    return next;
  };
  /** Changes stored state between syncs, never in the middle of one, re-reading it first. */
  const patch = (localAppId: string, change: Partial<LocalSpace>) => serial(localAppId, async () => {
    const current = await store.get(localAppId);
    if (current) await store.put({ ...current, ...change });
  });

  function account(): { ok: true; user: CollabUser } | Fail {
    const user = deps.user();
    if (!user) return fail('sign_in');
    if (user.isAnonymous) return fail('guest_account');
    return { ok: true, user };
  }

  async function pendingOf(state: LocalSpace): Promise<number> {
    const app = await apps.get(state.localAppId);
    if (!app) return 0;
    return localChanges(await records.listAll(state.localAppId), state, app.spec).length;
  }

  async function publishStatus(state: LocalSpace, phase: SyncPhase, error?: CollabCode): Promise<void> {
    setStatus(state.localAppId, {
      shared: true, role: state.role, phase, pending: await pendingOf(state).catch(() => 0), conflicts: state.conflicts.length,
      skipped: state.skipped ?? 0, lastSyncAt: state.lastSyncAt, error,
    });
  }

  // ─── Access ────────────────────────────────────────────────────────────────
  async function currentRole(state: LocalSpace, space: RemoteSpace): Promise<{ role?: Role; known: boolean }> {
    if (space.ownerUid === state.myUid) return { role: 'owner', known: true };
    const direct = await remote.myMembership({ kind: 'app', id: space.sharedId });
    if (!direct.ok) return { known: false };
    let team: Role | undefined;
    if (space.teamId) {
      const t = await remote.myMembership({ kind: 'team', id: space.teamId });
      if (!t.ok) return { known: false };
      team = t.value?.role;
    }
    return { role: effectiveRole(direct.value?.role, team), known: true };
  }

  /**
   * A refused read alone never deletes anything (it could be an App Check, token or network problem).
   * Access is gone only when this person's own app row reads back as missing and, for access through a
   * team, the team row is missing too, or the team itself is gone or no longer lists the app.
   */
  async function accessGone(state: LocalSpace): Promise<boolean> {
    const direct = await remote.myMembership({ kind: 'app', id: state.sharedId });
    if (!direct.ok || direct.value) return false;
    if (!state.teamId) return true;
    const inTeam = await remote.myMembership({ kind: 'team', id: state.teamId });
    if (!inTeam.ok) return false;
    if (!inTeam.value) return true;
    const team = await remote.getTeam(state.teamId);
    if (!team.ok) return team.error === 'not_found';
    return team.value.status !== 'active' || !team.value.apps.some((a) => a.sharedId === state.sharedId);
  }

  async function endAccess(state: LocalSpace): Promise<SyncReport> {
    if (state.role !== 'owner') {
      await apps.remove(state.localAppId).catch(() => undefined);
      await store.addNotice({ sharedId: state.sharedId, title: state.title, at: now() });
    }
    await store.remove(state.localAppId);
    setStatus(state.localAppId, NOT_SHARED);
    return { ...EMPTY_REPORT, ended: true };
  }

  async function failed(state: LocalSpace, error: RemoteError): Promise<SyncReport> {
    await publishStatus(state, error === 'offline' ? 'offline' : 'error', REMOTE_CODE[error]);
    return { ...EMPTY_REPORT, error: REMOTE_CODE[error] };
  }

  /** The app was deleted from this device: the owner's deletion stops sharing; anyone else leaves. */
  async function localAppGone(state: LocalSpace): Promise<SyncReport> {
    if (state.role === 'owner' && state.teamId) await moveTeam(state, null); // best effort: the deletion cuts access anyway
    const res = state.role === 'owner'
      ? await remote.deleteSpace(state.sharedId)
      : await remote.removeMember({ kind: 'app', id: state.sharedId }, state.myUid, true);
    const settled = res.ok || res.error === 'not_found' || (res.error === 'denied' && state.role !== 'owner');
    if (!settled) return { ...EMPTY_REPORT, error: REMOTE_CODE[res.error] };
    await store.remove(state.localAppId);
    setStatus(state.localAppId, NOT_SHARED);
    return { ...EMPTY_REPORT, ended: true };
  }

  // ─── Design ────────────────────────────────────────────────────────────────
  async function applyRemoteDesign(state: LocalSpace, app: StoredApp, space: RemoteSpace): Promise<LocalSpace> {
    const unpacked = unpackSpec(space);
    if (!unpacked.ok) return { ...state, lastError: unpacked.code };
    const spec: KalamSpec = sharedDesign({ ...unpacked.spec, id: app.id });
    const saved = await apps.save({ ...app, spec, updatedAt: now() }, { summary: COLLAB_COPY.summary.designUpdate, source: 'import', origin: 'import' });
    void remote.setInstalledVersion(space.sharedId, space.specVersion);
    return { ...state, specVersion: space.specVersion, designHash: designHash(saved.spec) };
  }

  async function syncDesign(state: LocalSpace, app: StoredApp, space: RemoteSpace): Promise<LocalSpace> {
    if (state.role !== 'owner') {
      // A member's own design edits are replaced by the shared design: entries must fit the design everyone has.
      return space.specVersion > state.specVersion || designHash(app.spec) !== state.designHash ? applyRemoteDesign(state, app, space) : state;
    }
    let mine = app;
    const relaxed = sharedDesign(app.spec);
    if (relaxed !== app.spec) {
      mine = await apps.save({ ...app, spec: relaxed, updatedAt: now() }, { summary: COLLAB_COPY.summary.photosOptional, source: 'edit', origin: 'user' });
    }
    const hash = designHash(mine.spec);
    if (hash !== state.designHash) {
      // ponytail: between one owner's own devices the last design sent wins; members never send designs.
      const packed = packSpec(mine.spec);
      if (!packed.ok) return { ...state, lastError: packed.code };
      const specVersion = space.specVersion + 1;
      const res = await remote.updateSpec(space.sharedId, { specGz: packed.specGz, specHash: packed.specHash, specVersion });
      if (!res.ok) return { ...state, lastError: REMOTE_CODE[res.error] };
      void remote.setInstalledVersion(space.sharedId, specVersion);
      return { ...state, specVersion, designHash: hash };
    }
    if (space.specVersion > state.specVersion) return applyRemoteDesign(state, mine, space);
    return state;
  }

  // ─── Entries ───────────────────────────────────────────────────────────────
  const byId = (local: Record<string, KalamRecord[]>) => new Map(Object.values(local).flat().map((r) => [r.id, r]));

  function conflictFrom(id: string, collectionId: string, kind: Conflict['kind'], current: RemoteRecord, fields: Conflict['fields'] = [], mine?: SyncValues): Conflict {
    return {
      id, collectionId, kind, fields, theirs: current.deleted ? {} : current.values, ...(mine ? { mine } : {}), theirVersion: current.version,
      theirActor: current.updatedBy, detectedAt: now(),
    };
  }

  async function writeLocal(appId: string, collectionId: string, localId: string, values: Record<string, RecordValue>): Promise<KalamRecord | undefined> {
    try {
      return await records.update(appId, collectionId, localId, values);
    } catch {
      return undefined;
    }
  }

  /** The cloud refused a write because someone else changed the entry first. */
  async function onPushConflict(state: LocalSpace, spec: KalamSpec, ch: LocalChange, current: RemoteRecord | null): Promise<{ merged: boolean; error?: RemoteError }> {
    const t = state.tracked[ch.remoteId];
    if (!current) {
      // The entry vanished from the cloud: send it again as new, or settle a delete.
      if (ch.kind === 'delete') state.tracked[ch.remoteId] = { localId: '', collectionId: ch.collectionId, version: 0, base: {}, deleted: true };
      else delete state.tracked[ch.remoteId];
      return { merged: false };
    }
    if (ch.kind === 'delete') {
      if (current.deleted) state.tracked[ch.remoteId] = { localId: '', collectionId: ch.collectionId, version: current.version, base: {}, deleted: true };
      else state.conflicts.push(conflictFrom(ch.remoteId, ch.collectionId, 'deleted_here', current));
      return { merged: false };
    }
    if (current.deleted) {
      state.conflicts.push(conflictFrom(ch.remoteId, ch.collectionId, 'deleted_there', current, [], ch.values));
      return { merged: false };
    }
    const { merged, clashes } = merge3(t?.base ?? {}, ch.values, current.values);
    // Their changes to other fields show up here at once; this device's clashing values stay until the person decides.
    const written = await writeLocal(state.localAppId, ch.collectionId, ch.localId, syncable(merged, spec.collections[ch.collectionId]));
    if (clashes.length) {
      state.conflicts.push(conflictFrom(ch.remoteId, ch.collectionId, 'both_changed', current, clashes, ch.values));
      return { merged: false };
    }
    // Could not save the combination here: send nothing; the next sync meets the same refusal and tries again.
    if (!written) return { merged: false };
    // Different fields changed: send the combination once more against their version.
    const retry = await remote.pushRecord(state.sharedId, { id: ch.remoteId, collectionId: ch.collectionId, values: merged, deleted: false, baseVersion: current.version });
    if (retry.ok && retry.value.status === 'written') {
      state.tracked[ch.remoteId] = { localId: ch.localId, collectionId: ch.collectionId, version: retry.value.version, base: merged, deleted: false };
      return { merged: true };
    }
    // Someone changed it again meanwhile: agree on their version; the merged values go out next time.
    state.tracked[ch.remoteId] = { localId: ch.localId, collectionId: ch.collectionId, version: current.version, base: current.values, deleted: false };
    return { merged: false, error: retry.ok ? undefined : retry.error };
  }

  async function pushChanges(state: LocalSpace, spec: KalamSpec): Promise<{ pushed: number; error?: RemoteError }> {
    if (!canEditEntries(state.role)) return { pushed: 0 };
    let pushed = 0;
    for (const ch of localChanges(await records.listAll(state.localAppId), state, spec)) {
      const res = await remote.pushRecord(state.sharedId, {
        id: ch.remoteId, collectionId: ch.collectionId, values: ch.values, deleted: ch.kind === 'delete', baseVersion: ch.baseVersion,
      });
      if (!res.ok) return { pushed, error: res.error };
      if (res.value.status === 'written') {
        state.tracked[ch.remoteId] = ch.kind === 'delete'
          ? { localId: '', collectionId: ch.collectionId, version: res.value.version, base: {}, deleted: true }
          : { localId: ch.localId, collectionId: ch.collectionId, version: res.value.version, base: ch.values, deleted: false };
        pushed++;
        continue;
      }
      const out = await onPushConflict(state, spec, ch, res.value.current);
      if (out.merged) pushed++;
      if (out.error) return { pushed, error: out.error };
    }
    return { pushed };
  }

  /** A newer cloud version arrived for an entry with an open conflict: re-check it. False when it could not be saved here. */
  async function refreshConflict(state: LocalSpace, c: Conflict, r: RemoteRecord, local: KalamRecord | undefined, spec: KalamSpec): Promise<boolean> {
    const i = state.conflicts.indexOf(c);
    const t = state.tracked[r.id];
    const collection = spec.collections[r.collectionId];
    const mine = local ? syncable(local.values, collection) : undefined;
    if (r.deleted) {
      if (!mine) {
        state.conflicts.splice(i, 1);
        state.tracked[r.id] = { localId: '', collectionId: r.collectionId, version: r.version, base: {}, deleted: true };
      } else state.conflicts[i] = conflictFrom(r.id, r.collectionId, 'deleted_there', r, [], mine);
      return true;
    }
    if (!mine) {
      state.conflicts[i] = conflictFrom(r.id, r.collectionId, 'deleted_here', r);
      return true;
    }
    const { merged, clashes } = merge3(t?.base ?? {}, mine, r.values);
    if (!(await writeLocal(state.localAppId, r.collectionId, local!.id, syncable(merged, collection)))) return false;
    if (clashes.length) {
      state.conflicts[i] = conflictFrom(r.id, r.collectionId, 'both_changed', r, clashes, mine);
      return true;
    }
    state.conflicts.splice(i, 1);
    state.tracked[r.id] = { localId: local!.id, collectionId: r.collectionId, version: r.version, base: syncable(r.values, collection), deleted: false };
    return true;
  }

  /**
   * Fetches what others changed and applies it here. Values for fields this design does not have are
   * dropped before saving. An entry that still cannot be saved (the list is full, a value the design no
   * longer allows, a list from a design this device could not apply yet) holds the cursor, so it is
   * fetched again on every sync until it fits, and is counted in `skipped` for the screen.
   *
   * `adopt` finishes a pull that was cut short: an entry it already saved but did not get to record is
   * recognised by its values instead of being saved a second time.
   */
  async function pullChanges(state: LocalSpace, spec: KalamSpec, designBehind: boolean, adopt: boolean): Promise<PullResult> {
    const res = await remote.pullRecords(state.sharedId, Math.max(0, state.cursor - COLLAB_LIMITS.pullOverlapMs));
    if (!res.ok) return { pulled: 0, skipped: 0, error: res.error };
    const all = await records.listAll(state.localAppId);
    const local = byId(all);
    const trackedLocal = new Set(Object.values(state.tracked).map((t) => t.localId).filter(Boolean));
    let pulled = 0;
    let skipped = 0;
    let hold = Number.POSITIVE_INFINITY;
    let writes = 0;
    const skip = (r: RemoteRecord) => {
      skipped++;
      hold = Math.min(hold, r.updatedAt);
    };
    // Saved before the first write here (so a cut-short pull is noticed) and every few writes after.
    const beforeWrite = async () => {
      if (state.pulling) return;
      state.pulling = true;
      await store.put(state);
    };
    const afterWrite = async () => {
      if (++writes % COLLAB_LIMITS.checkpointEvery === 0) await store.put(state);
    };
    const twinOf = (r: RemoteRecord, values: SyncValues): KalamRecord | undefined => {
      const collection = spec.collections[r.collectionId];
      const twin = (all[r.collectionId] ?? []).find((x) => !trackedLocal.has(x.id) && sameValues(syncable(x.values, collection), values));
      if (twin) trackedLocal.add(twin.id);
      return twin;
    };

    for (const r of res.value) {
      state.cursor = Math.min(Math.max(state.cursor, r.updatedAt), hold);
      const t = state.tracked[r.id];
      if (t && r.version <= t.version) continue;
      const collection = spec.collections[r.collectionId];
      if (!collection) {
        // A list this design does not have: wait for the design that has it, or ignore it when the owner removed the list.
        if (designBehind) skip(r);
        continue;
      }
      const values = syncable(r.values, collection);
      const localRec = t?.localId ? local.get(t.localId) : undefined;
      const conflict = state.conflicts.find((c) => c.id === r.id);
      if (conflict) {
        await beforeWrite();
        if (!(await refreshConflict(state, conflict, r, localRec, spec))) skip(r);
        else await afterWrite();
        continue;
      }
      const mine = localRec ? syncable(localRec.values, collection) : undefined;
      if (r.deleted) {
        if (localRec && t && !sameValues(mine ?? {}, t.base)) {
          state.conflicts.push(conflictFrom(r.id, r.collectionId, 'deleted_there', r, [], mine));
          continue;
        }
        if (localRec) {
          await beforeWrite();
          await records.remove(state.localAppId, r.collectionId, localRec.id).catch(() => undefined);
        }
        state.tracked[r.id] = { localId: '', collectionId: r.collectionId, version: r.version, base: {}, deleted: true };
        if (localRec) await afterWrite();
        pulled++;
        continue;
      }
      if (!t || t.deleted) {
        const twin = adopt && !t ? twinOf(r, values) : undefined;
        if (twin) {
          state.tracked[r.id] = { localId: twin.id, collectionId: r.collectionId, version: r.version, base: syncable(twin.values, collection), deleted: false };
          pulled++;
          continue;
        }
        await beforeWrite();
        let inserted: KalamRecord;
        try {
          inserted = await records.insert(state.localAppId, r.collectionId, values);
        } catch {
          skip(r);
          continue;
        }
        trackedLocal.add(inserted.id);
        state.tracked[r.id] = { localId: inserted.id, collectionId: r.collectionId, version: r.version, base: syncable(inserted.values, collection), deleted: false };
        await afterWrite();
        pulled++;
        continue;
      }
      if (!localRec || !mine) {
        state.conflicts.push(conflictFrom(r.id, r.collectionId, 'deleted_here', r));
        continue;
      }
      await beforeWrite();
      if (sameValues(mine, t.base)) {
        const written = await writeLocal(state.localAppId, r.collectionId, localRec.id, values);
        if (!written) {
          skip(r);
          continue;
        }
        state.tracked[r.id] = { ...t, version: r.version, base: syncable(written.values, collection) };
      } else {
        const { merged, clashes } = merge3(t.base, mine, values);
        if (!(await writeLocal(state.localAppId, r.collectionId, localRec.id, merged))) {
          skip(r);
          continue;
        }
        if (clashes.length) state.conflicts.push(conflictFrom(r.id, r.collectionId, 'both_changed', r, clashes, mine));
        else state.tracked[r.id] = { ...t, version: r.version, base: values };
      }
      await afterWrite();
      pulled++;
    }
    // ponytail: a held entry is fetched again with everything after it on every sync; a per-entry retry list
    // would save reads if entries that never fit (a full list) turn out to be common.
    state.cursor = Math.min(state.cursor, hold);
    state.pulling = undefined;
    state.skipped = skipped;
    return { pulled, skipped };
  }

  async function syncOnce(localAppId: string): Promise<SyncReport> {
    let state = await store.get(localAppId);
    if (!state) {
      setStatus(localAppId, NOT_SHARED);
      return EMPTY_REPORT;
    }
    const user = deps.user();
    if (!user || user.uid !== state.myUid) {
      await publishStatus(state, 'signed_out', 'sign_in');
      return { ...EMPTY_REPORT, error: 'sign_in' };
    }
    if (!deps.online()) {
      await publishStatus(state, 'offline', 'offline');
      return { ...EMPTY_REPORT, error: 'offline' };
    }
    setStatus(localAppId, { ...(statuses.get(localAppId) ?? NOT_SHARED), shared: true, role: state.role, phase: 'syncing' });
    const app = await apps.get(localAppId);
    if (!app) return localAppGone(state);

    const space = await remote.getSpace(state.sharedId);
    if (!space.ok) {
      if ((space.error === 'denied' || space.error === 'not_found') && (await accessGone(state))) return endAccess(state);
      return failed(state, space.error);
    }
    if (space.value.status === 'deleted') {
      if (space.value.ownerUid !== state.myUid) return endAccess(state);
      // The owner's clean-up was cut short (stop sharing, or deleting the app): finish it before forgetting the app here.
      const cleaned = await remote.deleteSpace(state.sharedId);
      return cleaned.ok || cleaned.error === 'not_found' ? endAccess(state) : failed(state, cleaned.error);
    }

    const role = await currentRole(state, space.value);
    if (role.known && !role.role) return endAccess(state);
    state = { ...state, role: role.role ?? state.role, teamId: space.value.teamId, title: space.value.title, lastError: undefined };
    state = await syncDesign(state, app, space.value);

    const spec = (await apps.get(localAppId))?.spec ?? app.spec;
    const behind = space.value.specVersion > state.specVersion;
    const recovering = state.pulling === true;
    let pushed: { pushed: number; error?: RemoteError } = { pushed: 0 };
    let pulled: PullResult = { pulled: 0, skipped: 0 };
    try {
      // A pull cut short last time is finished first, so the entries it saved are not sent back as new ones.
      if (recovering) pulled = await pullChanges(state, spec, behind, true);
      if (!pulled.error) pushed = await pushChanges(state, spec);
      if (!recovering && !pushed.error) pulled = await pullChanges(state, spec, behind, false);
    } catch (e) {
      // Keep what was done. If a pull was cut short, `pulling` stays set and the next sync finishes it.
      await store.put(state).catch(() => undefined);
      throw e;
    }
    const error = pushed.error ?? pulled.error;
    const code: CollabCode | undefined = error ? REMOTE_CODE[error] : (state.lastError as CollabCode | undefined);
    state = { ...state, lastSyncAt: error ? state.lastSyncAt : now(), lastError: code };
    await store.put(state);
    await publishStatus(state, error === 'offline' ? 'offline' : code ? 'error' : 'idle', code);
    return { pushed: pushed.pushed, pulled: pulled.pulled, conflicts: state.conflicts.length, skipped: state.skipped ?? 0, ended: false, error: code };
  }

  async function sync(localAppId: string): Promise<SyncReport> {
    try {
      return await serial(localAppId, () => syncOnce(localAppId));
    } catch {
      const state = await store.get(localAppId).catch(() => undefined);
      if (state) await publishStatus(state, 'error', 'unavailable');
      return { ...EMPTY_REPORT, error: 'unavailable' };
    }
  }

  // ─── Joining and sharing ───────────────────────────────────────────────────
  async function install(sharedId: string): Promise<Result<{ localAppId: string }>> {
    const existing = (await store.list()).find((s) => s.sharedId === sharedId);
    if (existing) return { ok: true, localAppId: existing.localAppId };
    const acct = account();
    if (!acct.ok) return acct;
    const space = await remote.getSpace(sharedId);
    if (!space.ok) return remoteFail(space);
    if (space.value.status !== 'active') return fail('gone');
    const unpacked = unpackSpec(space.value);
    if (!unpacked.ok) return fail(unpacked.code);
    const localAppId = deps.newAppId();
    const time = now();
    const saved = await apps.save(
      { id: localAppId, spec: sharedDesign({ ...unpacked.spec, id: localAppId }), createdAt: time, updatedAt: time, origin: { route: 'import' } },
      { summary: COLLAB_COPY.summary.joined(space.value.title), source: 'import', origin: 'import' },
    );
    const draft: LocalSpace = {
      v: 1, sharedId, localAppId, role: 'viewer', ownerUid: space.value.ownerUid, myUid: acct.user.uid, teamId: space.value.teamId,
      title: space.value.title, specVersion: space.value.specVersion, designHash: designHash(saved.spec), cursor: 0, tracked: {}, conflicts: [],
      ackAt: time,
    };
    const role = await currentRole(draft, space.value);
    await store.put({ ...draft, role: role.role ?? 'viewer' });
    void remote.setInstalledVersion(sharedId, space.value.specVersion);
    await sync(localAppId);
    return { ok: true, localAppId };
  }

  /**
   * Moves a shared app into a team, or out of one (`teamId` null), and keeps the teams' directories right.
   * Network only; callers save `teamId`. A team that was deleted, or whose directory this person may no
   * longer edit, keeps its old entry: only the app's own link changes (a stale directory entry opens nothing).
   */
  async function moveTeam(state: LocalSpace, teamId: string | null): Promise<Result> {
    const app: TeamApp = { sharedId: state.sharedId, title: state.title || COLLAB_COPY.untitled };
    let from = state.teamId === teamId ? null : state.teamId;
    let fromApps: TeamApp[] = [];
    if (from) {
      const old = await remote.getTeam(from);
      if (old.ok && old.value.status === 'active') fromApps = old.value.apps.filter((a) => a.sharedId !== state.sharedId);
      else if (old.ok || old.error === 'not_found' || old.error === 'denied') from = null;
      else return remoteFail(old);
    }
    let toApps: TeamApp[] = [];
    if (teamId) {
      const to = await remote.getTeam(teamId);
      if (!to.ok) return remoteFail(to);
      if (to.value.status !== 'active') return fail('gone');
      if (to.value.apps.length >= COLLAB_LIMITS.teamApps && !to.value.apps.some((a) => a.sharedId === state.sharedId)) return fail('not_allowed', COLLAB_COPY.errors.team_full);
      toApps = [...to.value.apps.filter((a) => a.sharedId !== state.sharedId), app];
    }
    const change = { from, to: teamId, app, fromApps, toApps };
    let res = await remote.setAppTeam(state.sharedId, change);
    if (!res.ok && res.error === 'denied' && from) res = await remote.setAppTeam(state.sharedId, { ...change, from: null, fromApps: [] });
    return res.ok ? { ok: true } : remoteFail(res);
  }

  async function needOnlineAccount(): Promise<{ ok: true; user: CollabUser } | Fail> {
    const acct = account();
    if (!acct.ok) return acct;
    if (!deps.online()) return fail('offline');
    return acct;
  }

  const targetOf = (s: LocalSpace): Target => ({ kind: 'app', id: s.sharedId });
  const byRank = <T extends { role: Role; name: string }>(a: T, b: T) => roleRank(b.role) - roleRank(a.role) || a.name.localeCompare(b.name);

  async function myRoleIn(target: Target): Promise<Role | undefined> {
    if (target.kind === 'team') return (await store.teams()).find((t) => t.teamId === target.id)?.role;
    return (await store.list()).find((s) => s.sharedId === target.id)?.role;
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    status: (localAppId: string): SyncStatus => statuses.get(localAppId) ?? NOT_SHARED,
    /** Reads stored state so badges and the write guard are right before the first sync. */
    async load(): Promise<LocalSpace[]> {
      const all = await store.list();
      for (const s of all) {
        const code = s.lastError as CollabCode | undefined;
        await publishStatus(s, statuses.get(s.localAppId)?.phase ?? (code && LASTING_CODES.includes(code) ? 'error' : 'idle'), code);
      }
      return all;
    },
    async refresh(localAppId: string): Promise<void> {
      const s = await store.get(localAppId);
      if (s) await publishStatus(s, statuses.get(localAppId)?.phase === 'syncing' ? 'syncing' : deps.online() ? statuses.get(localAppId)?.phase ?? 'idle' : 'offline', s.lastError as CollabCode | undefined);
      else setStatus(localAppId, NOT_SHARED);
    },
    space: (localAppId: string) => store.get(localAppId),
    spaces: () => store.list(),
    sync,
    async syncAll(): Promise<void> {
      for (const s of await store.list()) await sync(s.localAppId);
    },

    /**
     * Shares one app. `consent` is the person's explicit yes to the upload notice; nothing happens without it.
     * `teamError` says why the app could not also be put in the chosen team (it is shared either way).
     */
    async share(localAppId: string, opts: { consent: boolean; teamId?: string | null }): Promise<Result<{ sharedId: string; report: SyncReport; teamError?: string }>> {
      if (!opts.consent) return fail('no_consent');
      const acct = await needOnlineAccount();
      if (!acct.ok) return acct;
      if (await store.get(localAppId)) return fail('already_shared');
      const app = await apps.get(localAppId);
      if (!app) return fail('no_app');
      const spec = sharedDesign(app.spec);
      const packed = packSpec(spec);
      if (!packed.ok) return fail(packed.code);
      const sharedId = newCloudId('s', deps.randomBytes(19));
      const title = app.spec.name.slice(0, COLLAB_LIMITS.titleLength) || COLLAB_COPY.untitled;
      const res = await remote.createSpace({ sharedId, title, specGz: packed.specGz, specHash: packed.specHash, ownerName: acct.user.name });
      if (!res.ok) return remoteFail(res);
      if (spec !== app.spec) await apps.save({ ...app, spec, updatedAt: now() }, { summary: COLLAB_COPY.summary.photosOptional, source: 'edit', origin: 'user' });
      const state: LocalSpace = {
        v: 1, sharedId, localAppId, role: 'owner', ownerUid: acct.user.uid, myUid: acct.user.uid, teamId: null, title, specVersion: 1,
        designHash: designHash(spec), cursor: 0, tracked: {}, conflicts: [], ackAt: now(),
      };
      await store.put(state);
      void remote.setInstalledVersion(sharedId, 1);
      let teamError: string | undefined;
      if (opts.teamId) {
        const moved = await moveTeam(state, opts.teamId);
        if (moved.ok) await patch(localAppId, { teamId: opts.teamId });
        else teamError = moved.message;
      }
      return { ok: true, sharedId, report: await sync(localAppId), ...(teamError ? { teamError } : {}) };
    },

    /**
     * Joins with an invite code or link: a shared app (copied to this device) or a team. `consent` is the
     * person's yes to the notice that entries sync through the cloud and others see them.
     */
    async join(code: string, opts: { consent: boolean }): Promise<Result<{ kind: 'app'; localAppId: string } | { kind: 'team'; teamId: string }>> {
      const parsed = parseToken(code);
      if (!parsed) return fail('invalid_code');
      if (!opts.consent) return fail('no_consent');
      const acct = await needOnlineAccount();
      if (!acct.ok) return acct;
      const res = await remote.join(makeToken(parsed.target, parsed.secret));
      if (!res.ok) return res.error === 'denied' || res.error === 'not_found' ? fail('invite_refused', res.message) : remoteFail(res);
      if (res.value.target.kind === 'team') {
        const team = await remote.getTeam(res.value.target.id);
        await store.putTeam({ v: 1, teamId: res.value.target.id, name: team.ok ? team.value.name : COLLAB_COPY.untitled, role: res.value.role, myUid: acct.user.uid });
        emit();
        return { ok: true, kind: 'team', teamId: res.value.target.id };
      }
      const installed = await install(res.value.target.id);
      return installed.ok ? { ok: true, kind: 'app', localAppId: installed.localAppId } : installed;
    },

    /** Copies a team's app to this device (team members need no separate invite), after the same notice as joining. */
    async getTeamApp(sharedId: string, opts: { consent: boolean }): Promise<Result<{ localAppId: string }>> {
      if (!opts.consent) return fail('no_consent');
      if (!deps.online()) return fail('offline');
      return install(sharedId);
    },

    /** Settles one conflict: keep this device's values, or take the other person's. */
    async resolve(localAppId: string, conflictId: string, choice: 'mine' | 'theirs'): Promise<Result> {
      const done = await serial(localAppId, async (): Promise<Result> => {
        const state = await store.get(localAppId);
        const c = state?.conflicts.find((x) => x.id === conflictId);
        if (!state || !c) return fail('not_shared');
        const local = (await records.list(localAppId, c.collectionId).catch(() => [] as KalamRecord[])).find((r) => r.id === state.tracked[c.id]?.localId);
        const keep = (localId: string, base: Conflict['theirs'], deleted = false) => {
          state.tracked[c.id] = { localId, collectionId: c.collectionId, version: c.theirVersion, base, deleted };
        };
        if (c.kind === 'both_changed') {
          if (choice === 'theirs' && local) {
            // Only the clashing fields: this device's other changes stay, and go out on the next sync.
            const picked = Object.fromEntries(c.fields.map((f) => [f.field, f.theirs]));
            if (!(await writeLocal(localAppId, c.collectionId, local.id, picked))) return fail('unavailable', COLLAB_COPY.errors.cannot_apply);
          }
          keep(local?.id ?? '', c.theirs, !local);
        } else if (c.kind === 'deleted_there') {
          if (choice === 'theirs') {
            if (local) await records.remove(localAppId, c.collectionId, local.id).catch(() => undefined);
            keep('', {}, true);
          } else keep(local?.id ?? '', {}, !local);
        } else if (choice === 'theirs') {
          try {
            const inserted = await records.insert(localAppId, c.collectionId, c.theirs);
            keep(inserted.id, c.theirs);
          } catch {
            return fail('unavailable', COLLAB_COPY.errors.cannot_apply);
          }
        } else {
          // Keep the deletion: still tracked, missing here, so the next sync sends the delete.
          keep(state.tracked[c.id]?.localId || c.id, c.theirs);
        }
        state.conflicts = state.conflicts.filter((x) => x.id !== c.id);
        await store.put(state);
        return { ok: true };
      });
      if (done.ok) void sync(localAppId);
      return done;
    },

    /** A member leaves: their membership ends in the cloud and the copy on this device is removed. */
    async leave(localAppId: string): Promise<Result> {
      const state = await store.get(localAppId);
      if (!state) return fail('not_shared');
      if (!canLeave(state.role)) return fail('owner_cannot_leave');
      const acct = await needOnlineAccount();
      if (!acct.ok) return acct;
      const res = await remote.removeMember(targetOf(state), state.myUid, true);
      // A member through a team has no row of their own to remove.
      if (!res.ok && !(state.teamId && (res.error === 'denied' || res.error === 'not_found'))) return remoteFail(res);
      await serial(localAppId, async () => {
        await apps.remove(localAppId).catch(() => undefined);
        await store.remove(localAppId);
      });
      setStatus(localAppId, NOT_SHARED);
      return { ok: true };
    },

    /**
     * The owner stops sharing: every cloud copy is deleted and members lose access. This device keeps the
     * app. If the clean-up is cut short, members are already cut off and the next sync finishes it.
     */
    async stopSharing(localAppId: string): Promise<Result> {
      const state = await store.get(localAppId);
      if (!state) return fail('not_shared');
      if (!canStopSharing(state.role)) return fail('not_allowed');
      const acct = await needOnlineAccount();
      if (!acct.ok) return acct;
      if (state.teamId) await moveTeam(state, null); // best effort: the deletion below cuts access either way
      const res = await remote.deleteSpace(state.sharedId);
      if (!res.ok && res.error !== 'not_found') return remoteFail(res);
      await serial(localAppId, () => store.remove(localAppId));
      setStatus(localAppId, NOT_SHARED);
      return { ok: true };
    },

    // ─── People ──────────────────────────────────────────────────────────────
    myRoleIn,
    async members(target: Target): Promise<Result<{ members: Member[] }>> {
      if (!deps.online()) return fail('offline');
      const res = await remote.listMembers(target);
      return res.ok ? { ok: true, members: [...res.value].sort(byRank) } : remoteFail(res);
    },
    /**
     * Managers: which design version each person has (docs/14 §21.2 deployment status), for people invited
     * directly and people who get the app through its team. Nothing else about them is collected.
     */
    async deployment(localAppId: string): Promise<Result<{ latest: number; people: Deployment[] }>> {
      const state = await store.get(localAppId);
      if (!state) return fail('not_shared');
      if (!canManageMembers(state.role)) return fail('not_allowed');
      if (!deps.online()) return fail('offline');
      const [direct, installs] = await Promise.all([remote.listMembers(targetOf(state)), remote.listInstalls(state.sharedId)]);
      if (!direct.ok) return remoteFail(direct);
      if (!installs.ok) return remoteFail(installs);
      // Only people in a team can list it; an app owner outside the team sees the people invited directly.
      const team = state.teamId ? await remote.listMembers({ kind: 'team', id: state.teamId }) : undefined;
      const directBy = new Map(direct.value.map((m) => [m.uid, m]));
      const teamBy = new Map((team?.ok ? team.value : []).map((m) => [m.uid, m]));
      const people = [...new Set([...directBy.keys(), ...teamBy.keys()])].flatMap((uid): Deployment[] => {
        const d = directBy.get(uid);
        const t = teamBy.get(uid);
        const role = effectiveRole(d?.role, t?.role);
        return role ? [{ uid, name: d?.name || t?.name || '', role, version: installs.value[uid] ?? 0 }] : [];
      });
      return { ok: true, latest: state.specVersion, people: people.sort(byRank) };
    },
    async setRole(target: Target, member: Member, role: Role): Promise<Result> {
      if (!canAssign(await myRoleIn(target), member.role, role)) return fail('not_allowed');
      const acct = await needOnlineAccount();
      if (!acct.ok) return acct;
      const res = await remote.setRole(target, member.uid, role);
      return res.ok ? { ok: true } : remoteFail(res);
    },
    /** Revokes someone's access. Their next sync confirms it and removes their copy. */
    async removeMember(target: Target, member: Member): Promise<Result> {
      if (!canRemove(await myRoleIn(target), member.role)) return fail('not_allowed');
      const acct = await needOnlineAccount();
      if (!acct.ok) return acct;
      const res = await remote.removeMember(target, member.uid, false);
      return res.ok ? { ok: true } : remoteFail(res);
    },
    async createInvite(target: Target, role: InviteRole, opts: { days?: number; maxUses?: number } = {}): Promise<Result<{ code: string; expiresAt: number }>> {
      if (!invitableRoles(await myRoleIn(target)).includes(role)) return fail('not_allowed');
      const acct = await needOnlineAccount();
      if (!acct.ok) return acct;
      const secret = randomBase32(deps.randomBytes(SECRET_LENGTH));
      const days = Math.min(Math.max(1, Math.round(opts.days ?? 7)), COLLAB_LIMITS.inviteMaxDays);
      const expiresAt = now() + days * 86_400_000;
      const maxUses = Math.min(Math.max(1, Math.round(opts.maxUses ?? 10)), COLLAB_LIMITS.inviteMaxUses);
      const res = await remote.createInvite(target, { hash: secretHash(secret), role, expiresAt, maxUses });
      return res.ok ? { ok: true, code: makeToken(target, secret), expiresAt } : remoteFail(res);
    },
    async invites(target: Target): Promise<Result<{ invites: Invite[] }>> {
      if (!canManageMembers(await myRoleIn(target))) return fail('not_allowed');
      if (!deps.online()) return fail('offline');
      const res = await remote.listInvites(target);
      return res.ok ? { ok: true, invites: res.value.filter((i) => i.expiresAt > now() && i.uses < i.maxUses) } : remoteFail(res);
    },
    async revokeInvite(target: Target, hash: string): Promise<Result> {
      if (!canManageMembers(await myRoleIn(target))) return fail('not_allowed');
      if (!deps.online()) return fail('offline');
      const res = await remote.deleteInvite(target, hash);
      return res.ok ? { ok: true } : remoteFail(res);
    },
    /** Who changed what, newest first. Never record values. */
    async history(localAppId: string, limit = 30): Promise<Result<{ entries: AuditEntry[] }>> {
      const state = await store.get(localAppId);
      if (!state) return fail('not_shared');
      if (!deps.online()) return fail('offline');
      const res = await remote.readAudit(state.sharedId, limit);
      return res.ok ? { ok: true, entries: res.value } : remoteFail(res);
    },

    // ─── Teams ───────────────────────────────────────────────────────────────
    teams: (): Promise<LocalTeam[]> => store.teams(),
    async createTeam(name: string): Promise<Result<{ teamId: string }>> {
      const clean = name.trim().replace(/[<>]/g, '').slice(0, COLLAB_LIMITS.titleLength);
      if (!clean) return fail('not_allowed', COLLAB_COPY.errors.team_name);
      const acct = await needOnlineAccount();
      if (!acct.ok) return acct;
      const teamId = newCloudId('t', deps.randomBytes(19));
      const res = await remote.createTeam({ teamId, name: clean, ownerName: acct.user.name });
      if (!res.ok) return remoteFail(res);
      await store.putTeam({ v: 1, teamId, name: clean, role: 'owner', myUid: acct.user.uid });
      emit();
      return { ok: true, teamId };
    },
    /** The team as the cloud has it now. A team this person lost is removed from the device list. */
    async team(teamId: string): Promise<Result<{ name: string; apps: (TeamApp & { localAppId?: string })[]; role?: Role }>> {
      if (!deps.online()) return fail('offline');
      const res = await remote.getTeam(teamId);
      const local = (await store.teams()).find((t) => t.teamId === teamId);
      if (!res.ok || res.value.status !== 'active') {
        const me = await remote.myMembership({ kind: 'team', id: teamId });
        if (me.ok && !me.value && local) {
          await store.removeTeam(teamId);
          emit();
        }
        return res.ok ? fail('gone') : remoteFail(res);
      }
      const mine = await remote.myMembership({ kind: 'team', id: teamId });
      const role = mine.ok ? mine.value?.role : local?.role;
      if (local && (local.name !== res.value.name || (role && role !== local.role))) await store.putTeam({ ...local, name: res.value.name, role: role ?? local.role });
      const installed = new Map((await store.list()).map((s) => [s.sharedId, s.localAppId]));
      return { ok: true, name: res.value.name, role, apps: res.value.apps.map((a) => ({ ...a, localAppId: installed.get(a.sharedId) })) };
    },
    /** Puts a shared app the person owns into a team they manage, or takes it out (`teamId` null). */
    async setTeam(localAppId: string, teamId: string | null): Promise<Result> {
      const state = await store.get(localAppId);
      if (!state) return fail('not_shared');
      if (!canChangeStructure(state.role)) return fail('not_allowed');
      if (teamId && !canManageMembers(await myRoleIn({ kind: 'team', id: teamId }))) return fail('not_allowed');
      const acct = await needOnlineAccount();
      if (!acct.ok) return acct;
      const moved = await moveTeam(state, teamId);
      if (moved.ok) await patch(localAppId, { teamId });
      return moved;
    },
    async leaveTeam(teamId: string): Promise<Result> {
      const team = (await store.teams()).find((t) => t.teamId === teamId);
      if (!team) return fail('not_shared');
      if (team.role === 'owner') return fail('owner_cannot_leave');
      const acct = await needOnlineAccount();
      if (!acct.ok) return acct;
      const res = await remote.removeMember({ kind: 'team', id: teamId }, team.myUid, true);
      if (!res.ok) return remoteFail(res);
      await store.removeTeam(teamId);
      emit();
      return { ok: true };
    },
    async deleteTeam(teamId: string): Promise<Result> {
      const team = (await store.teams()).find((t) => t.teamId === teamId);
      if (!team || team.role !== 'owner') return fail('not_allowed');
      const acct = await needOnlineAccount();
      if (!acct.ok) return acct;
      const res = await remote.deleteTeam(teamId);
      if (!res.ok && res.error !== 'not_found') return remoteFail(res);
      await store.removeTeam(teamId);
      emit();
      return { ok: true };
    },

    notices: (): Promise<EndedNotice[]> => store.notices(),
    async clearNotices(): Promise<void> {
      await store.clearNotices();
      emit();
    },

    /**
     * Wraps the runtime's record repository: a viewer's copy refuses writes with a plain message
     * instead of letting edits pile up that can never be sent. Reads pass straight through.
     */
    guard(base: RecordRepository): RecordRepository {
      const check = (appId: string) => {
        const s = statuses.get(appId);
        if (s?.shared && s.role && !canEditEntries(s.role)) throw new CollabReadOnlyError();
      };
      return {
        list: (a, c) => base.list(a, c),
        listAll: (a) => base.listAll(a),
        insert: async (a, c, v) => (check(a), base.insert(a, c, v)),
        update: async (a, c, id, v) => (check(a), base.update(a, c, id, v)),
        remove: async (a, c, id) => (check(a), base.remove(a, c, id)),
        subscribe: (a, l) => base.subscribe(a, l),
        // A batch is several writes at once, so a viewer's copy refuses it the same way.
        ...(base.batch ? { batch: async (a: string, ops: Parameters<NonNullable<RecordRepository['batch']>>[1]) => (check(a), base.batch!(a, ops)) } : {}),
      };
    },
  };
}

export type CollabEngine = ReturnType<typeof createCollabEngine>;
