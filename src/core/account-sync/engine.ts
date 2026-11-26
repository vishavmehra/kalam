/**
 * "My apps in my account" engine. Local first and opt-in: nothing leaves the device until the person
 * picks a choice on this device, sync never blocks using an app, and signing out keeps everything here.
 *
 * One pass: pull what changed in the account → plan per app (./plan.ts) → apply → back up records
 * (choice "apps and records"). Pending local changes are found by comparing designs with what this
 * device last agreed with the account, so the "offline queue" survives restarts with nothing to replay.
 * Designs are packed and checked with the Collaborative Apps helpers (packSpec, unpackSpec,
 * designHash); records use N5's encrypted backup format.
 */
import type { AppRepository, CreationRoute, KalamRecord, KeyValueRepository, RecordRepository, StoredApp, VersionRepository } from '../contracts';
import { passphraseLength } from '../backup/service';
import { MIN_KDF_ITERATIONS, KDF_ITERATIONS, MIN_PASSPHRASE_LENGTH, type RandomBytes } from '../backup/crypto';
import { BackupError } from '../backup/errors';
import type { ValidatedBackup } from '../backup/payload';
import { isLocalOnlyStateKey } from '../backup/schemas';
import type { BackupData, BackupStateRow, BackupStore } from '../backup/types';
import { designHash, packSpec, unpackSpec } from '../collab/merge';
import {
  ACCOUNT_LIMITS, bazaarSourceSchema, emptyLocal, problemOf, type AccountLocal, type AccountRemote, type AccountSyncStatus, type AccountSyncStore,
  type AppSyncState, type BazaarSource, type RecordsPointer, type RemoteApp, type SyncChoice, type SyncProblem,
} from './model';
import { pendingCount, planSync, type LocalApp, type SyncAction } from './plan';
import { keyFromBase64, keyToBase64, newRecordsKey, openRecords, sealRecords, splitChunks, textHash, type RecordsKey } from './records';

export interface AccountUser { uid: string; isAnonymous: boolean }

export interface AccountSyncDeps {
  remote: AccountRemote;
  store: AccountSyncStore;
  /** The device database's own repositories. */
  apps: Pick<AppRepository, 'list' | 'get' | 'save' | 'remove'>;
  versions: Pick<VersionRepository, 'list'>;
  records: Pick<RecordRepository, 'listAll'>;
  state: Pick<KeyValueRepository, 'all'>;
  /** One-transaction write used to bring records back (N5's restore path). */
  backup: Pick<BackupStore, 'writeBackupData'>;
  online: () => boolean;
  randomBytes: RandomBytes;
  now?: () => number;
  /** Apps that already have a cloud home (shared through Collaborative Apps). Left alone. */
  excluded?: () => Promise<ReadonlySet<string>>;
  /** Bazaar install origin kept on this device, so an installed app keeps its update checks. */
  bazaar?: { get(appId: string): Promise<BazaarSource | undefined>; set(appId: string, from: BazaarSource): Promise<void> };
  /** Called after apps on this device were added, changed or removed by sync (refresh the shelf). */
  onLocalAppsChanged?: () => void;
  /** PBKDF2 work factor. Production keeps the defaults. */
  iterations?: number;
  minIterations?: number;
}

export type AccountResult = { ok: true } | { ok: false; problem: SyncProblem };

/** Plain-English Time Machine summaries (stored with each version, like COLLAB_COPY). */
export const ACCOUNT_SYNC_COPY = {
  added: 'Added from your account',
  updated: 'Updated from your account',
  otherDevice: 'Version from your other device',
  keptHere: 'Kept the version from this device',
  archived: 'Deleted on your other device. Kept here because it has records',
} as const;

/** Pull a little before the last cursor: server times of concurrent writes can arrive out of order. */
const OVERLAP_MS = 60_000;
const ROUTES: readonly CreationRoute[] = ['template', 'template+on_device', 'cloud', 'cloud+repair', 'specialist', 'import', 'manual'];
const routeOf = (r: string): CreationRoute => (ROUTES as readonly string[]).includes(r) ? (r as CreationRoute) : 'import';
const SET_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function createAccountSync(deps: AccountSyncDeps) {
  const { remote, store } = deps;
  const now = deps.now ?? Date.now;
  const iterations = deps.iterations ?? KDF_ITERATIONS;
  const minIterations = deps.minIterations ?? MIN_KDF_ITERATIONS;

  let user: AccountUser | null = null;
  let local: AccountLocal = emptyLocal();
  let phase: AccountSyncStatus['phase'] = 'signed_out';
  let problem: SyncProblem | undefined;
  let pending = 0;
  let restored: AccountSyncStatus['restored'];
  let pendingRestore: ValidatedBackup | undefined;
  let recordsDirty = true;
  let running: Promise<void> | undefined;
  let again = false;
  /** Bumped when the account changes; a pass for the previous account stops at the next step. */
  let generation = 0;
  const hashes = new Map<string, { updatedAt: number; hash: string }>();
  const listeners = new Set<() => void>();
  const signedIn = () => !!user && !user.isAnonymous;
  let snapshot: AccountSyncStatus = computeStatus();

  function computeStatus(): AccountSyncStatus {
    const alive = Object.values(local.apps).filter((s) => !s.deleted && s.remoteHash).length;
    return {
      phase,
      choice: local.choice,
      needsPrompt: signedIn() && local.choice === undefined,
      lastSyncAt: local.lastSyncAt,
      appsInAccount: alive,
      pending: local.choice && local.choice !== 'off' ? pending : 0,
      recordsBackupAt: local.records?.lastBackupAt,
      ...(restored ? { restored } : {}),
      ...(problem ? { problem } : {}),
    };
  }
  function emit() {
    snapshot = computeStatus();
    for (const l of listeners) l();
  }
  async function persist() {
    if (user && signedIn()) await store.put(user.uid, local);
  }

  function hashOf(app: StoredApp): string {
    const hit = hashes.get(app.id);
    if (hit && hit.updatedAt === app.updatedAt) return hit.hash;
    const hash = designHash(app.spec);
    hashes.set(app.id, { updatedAt: app.updatedAt, hash });
    return hash;
  }
  const toLocal = (a: StoredApp): LocalApp => ({ id: a.id, hash: hashOf(a), updatedAt: a.updatedAt });

  async function localApps(): Promise<{ apps: StoredApp[]; excluded: ReadonlySet<string> }> {
    const excluded = (await deps.excluded?.().catch(() => new Set<string>())) ?? new Set<string>();
    return { apps: (await deps.apps.list()).filter((a) => !excluded.has(a.id)), excluded };
  }

  const recordCount = async (appId: string) =>
    Object.values(await deps.records.listAll(appId)).reduce((n, rows) => n + rows.length, 0);

  // ── App designs ─────────────────────────────────────────────────────────────────────────────────

  async function upload(uid: string, app: StoredApp): Promise<boolean> {
    const packed = packSpec(app.spec);
    if (!packed.ok) return false;
    const source = bazaarSourceSchema.safeParse(await deps.bazaar?.get(app.id).catch(() => undefined));
    const bazaar = source.success ? source.data : null;
    await remote.putApp(uid, app.id, {
      name: app.spec.name, icon: app.spec.icon ?? null, version: app.spec.version, specGz: packed.specGz, specHash: packed.specHash,
      updatedAt: app.updatedAt, deleted: false, route: app.origin.route, bazaar,
    });
    local.apps[app.id] = { localHash: hashOf(app), remoteHash: packed.specHash, remoteUpdatedAt: app.updatedAt, deleted: false };
    return true;
  }

  async function saveRemote(app: StoredApp | undefined, r: RemoteApp, spec: StoredApp['spec'], summary: string): Promise<StoredApp> {
    const time = now();
    const saved = app
      ? await deps.apps.save({ ...app, spec }, { summary, source: 'import', origin: 'import' })
      : await deps.apps.save({ id: r.id, spec, createdAt: time, updatedAt: time, origin: { route: routeOf(r.route) } }, { summary, source: 'import', origin: 'import' });
    if (!app && r.bazaar) await deps.bazaar?.set(r.id, r.bazaar).catch(() => undefined);
    return saved;
  }

  /** Applies one planned step. Returns false when the account copy could not be read here (kept for later). */
  async function apply(uid: string, action: SyncAction, byId: Map<string, StoredApp>, flags: { tooBig: boolean; changed: boolean }): Promise<boolean> {
    const app = byId.get(action.appId);
    const agree = (saved: StoredApp, r: RemoteApp): AppSyncState =>
      (local.apps[r.id] = { localHash: hashOf(saved), remoteHash: r.specHash, remoteUpdatedAt: r.updatedAt, deleted: false });

    switch (action.kind) {
      case 'upload':
        if (app && !(await upload(uid, app))) flags.tooBig = true;
        return true;
      case 'tombstone': {
        const time = now();
        await remote.putApp(uid, action.appId, {
          name: '', icon: null, version: 0, specGz: null, specHash: null, updatedAt: time, deleted: true, route: '', bazaar: null,
        });
        const before = local.apps[action.appId];
        local.apps[action.appId] = { localHash: before?.localHash ?? '', remoteHash: null, remoteUpdatedAt: time, deleted: true };
        return true;
      }
      case 'note':
        local.apps[action.appId] = { localHash: '', remoteHash: null, remoteUpdatedAt: action.remote.updatedAt, deleted: true };
        return true;
      case 'remove_local': {
        if (app) {
          // Never lose records because of a delete made elsewhere: an app with records is archived instead.
          if ((await recordCount(app.id)) > 0) {
            await deps.apps.save({ ...app, archived: true }, { summary: ACCOUNT_SYNC_COPY.archived, source: 'edit' });
          } else {
            await deps.apps.remove(app.id);
          }
          flags.changed = true;
        }
        local.apps[action.appId] = { localHash: app ? hashOf(app) : '', remoteHash: null, remoteUpdatedAt: action.remote.updatedAt, deleted: true };
        return true;
      }
      case 'download':
      case 'conflict': {
        const r = action.remote;
        const unpacked = r.specGz && r.specHash ? unpackSpec({ specGz: r.specGz, specHash: r.specHash }) : undefined;
        // Unreadable here (damaged, or made by a newer Kalam): leave both copies as they are and try again later.
        if (!unpacked?.ok || unpacked.spec.id !== r.id) return false;
        const remoteSpec = unpacked.spec;
        if (action.kind === 'conflict' && app) {
          if (designHash(remoteSpec) === hashOf(app)) {
            agree(app, r);
            return true;
          }
          if (app.updatedAt >= r.updatedAt) {
            // This device wins. The account's design goes into the Time Machine first, then this one on top.
            await deps.apps.save({ ...app, spec: remoteSpec }, { summary: ACCOUNT_SYNC_COPY.otherDevice, source: 'import', origin: 'import' });
            const kept = await deps.apps.save(app, { summary: ACCOUNT_SYNC_COPY.keptHere, source: 'edit', origin: 'user' });
            flags.changed = true;
            if (!(await upload(uid, kept))) flags.tooBig = true;
            return true;
          }
        }
        // The account wins: this device's design stays in the Time Machine as the previous version.
        const saved = await saveRemote(app, r, remoteSpec, app ? ACCOUNT_SYNC_COPY.updated : ACCOUNT_SYNC_COPY.added);
        agree(saved, r);
        flags.changed = true;
        return true;
      }
    }
  }

  // ── Records (choice "apps and records") ─────────────────────────────────────────────────────────

  function recordsKey(): RecordsKey | undefined {
    const r = local.records;
    return r ? keyFromBase64(r.key, r.salt, r.iterations) : undefined;
  }

  /** The newest complete backup as text, or null when there is none or a part is missing. */
  async function fetchRecords(uid: string, pointer: RecordsPointer): Promise<string | null> {
    const parts: string[] = [];
    for (let i = 0; i < pointer.parts; i++) {
      const part = await remote.getRecordsPart(uid, pointer.set, i);
      if (part === null) return null;
      parts.push(part);
    }
    const text = parts.join('');
    return text.length === pointer.chars && textHash(text) === pointer.sha256 ? text : null;
  }

  async function snapshotOf(apps: StoredApp[]): Promise<BackupData> {
    const records: KalamRecord[] = [];
    const state: BackupStateRow[] = [];
    for (const app of apps) {
      for (const rows of Object.values(await deps.records.listAll(app.id))) records.push(...rows);
      for (const [key, value] of Object.entries(await deps.state.all(app.id))) if (!isLocalOnlyStateKey(key)) state.push({ appId: app.id, key, value });
    }
    // Designs travel on their own; they are here only so a restore can check each record against its collection.
    const slim = apps.map(({ id, spec, createdAt, updatedAt, origin }) => ({ id, spec, createdAt, updatedAt, origin }));
    return { apps: slim, versions: [], records, state, drawings: [], blobs: [] };
  }

  /** Brings records back into apps that have none on this device. Apps with their own records keep them. */
  async function restoreRecords(backup: ValidatedBackup): Promise<{ apps: number; kept: number }> {
    let apps = 0;
    let kept = 0;
    for (const item of backup.data.apps) {
      const records = backup.data.records.filter((r) => r.appId === item.id);
      const state = backup.data.state.filter((s) => s.appId === item.id);
      if (!records.length && !state.length) continue;
      const here = await deps.apps.get(item.id);
      if (!here) continue;
      if ((await recordCount(item.id)) > 0) {
        kept++;
        continue;
      }
      // ponytail: N5's one-transaction restore replaces the app row as a whole; it runs only for an app with
      // no records yet (a fresh copy from the account), so nothing personal is replaced.
      await deps.backup.writeBackupData(
        { apps: [here], versions: await deps.versions.list(item.id), records, state, drawings: [], blobs: [] },
        { replaceAppIds: [item.id], replaceDrawingIds: [] },
      );
      apps++;
    }
    return { apps, kept };
  }

  async function backupRecords(uid: string, apps: StoredApp[]): Promise<SyncProblem | undefined> {
    const key = recordsKey();
    if (!key || !local.records) return 'needs_passphrase';
    const pointer = await remote.getRecordsPointer(uid);
    if (pointer && pointer.salt !== local.records.salt) return 'passphrase_changed';
    const sealed = sealRecords(await snapshotOf(apps), key, deps.randomBytes, now());
    if (pointer && pointer.set === local.records.lastSet && sealed.checksum === local.records.lastChecksum) return undefined;
    const chunks = splitChunks(sealed.text);
    if (chunks.length > ACCOUNT_LIMITS.maxParts) return 'records_too_big';
    const set = Array.from(deps.randomBytes(12), (b) => SET_ALPHABET[b % 36]).join('');
    for (let i = 0; i < chunks.length; i++) await remote.putRecordsPart(uid, set, i, chunks.length, chunks[i]);
    // The pointer goes last: a restore only ever sees a backup whose parts are all there.
    await remote.putRecordsPointer(uid, {
      set, parts: chunks.length, chars: sealed.text.length, sha256: textHash(sealed.text), salt: key.salt,
      appCount: sealed.appCount, recordCount: sealed.recordCount,
    });
    if (pointer) for (let i = 0; i < pointer.parts; i++) await remote.deleteRecordsPart(uid, pointer.set, i).catch(() => undefined);
    local.records = { ...local.records, lastSet: set, lastBackupAt: now(), lastChecksum: sealed.checksum };
    return undefined;
  }

  // ── One pass ────────────────────────────────────────────────────────────────────────────────────

  async function pass(): Promise<void> {
    const g = generation;
    if (!user || !signedIn()) {
      phase = 'signed_out';
      problem = user?.isAnonymous ? 'guest' : undefined;
      return;
    }
    const uid = user.uid;
    if (!local.choice || local.choice === 'off') {
      phase = 'off';
      problem = undefined;
      return;
    }
    const { apps, excluded } = await localApps();
    // Several synced apps gone at once and none left: this device was cleared ("Delete everything", site
    // data removed). Start over and bring the account's apps back; never send deletes for all of them.
    // ponytail: deleting the last two or more apps while offline looks the same and brings them back;
    // the Settings wipe should call setChoice('off') first if the device is meant to stay empty.
    if (!apps.length && Object.values(local.apps).filter((s) => !s.deleted).length >= 2) local = { ...local, cursor: 0, apps: {} };
    pending = pendingCount(apps.map(toLocal), local.apps, excluded);
    if (!deps.online()) {
      phase = 'offline';
      problem = 'offline';
      return;
    }
    phase = 'syncing';
    problem = undefined;
    emit();
    const flags = { tooBig: false, changed: false };
    try {
      const pulled = await remote.pullApps(uid, Math.max(0, local.cursor - OVERLAP_MS));
      let cursor = local.cursor;
      for (const r of pulled) cursor = Math.max(cursor, r.syncedAt);
      const byId = new Map(apps.map((a) => [a.id, a]));
      for (const action of planSync({ local: apps.map(toLocal), pulled, state: local.apps, excluded })) {
        if (g !== generation) return; // signed out or switched account mid-pass
        // Unreadable account copies are pulled again next time (after Kalam is updated, for example).
        if (!(await apply(uid, action, byId, flags)) && 'remote' in action) cursor = Math.min(cursor, action.remote.syncedAt);
        await persist();
      }
      if (g !== generation) return;
      local.cursor = cursor;
      let recordsProblem: SyncProblem | undefined;
      if (local.choice === 'apps_records') {
        const current = (await localApps()).apps;
        if (pendingRestore && local.records) {
          restored = await restoreRecords(pendingRestore);
          pendingRestore = undefined;
          if (restored.apps) flags.changed = true;
        }
        if (recordsDirty || !local.records?.lastSet) {
          recordsProblem = await backupRecords(uid, current);
          if (!recordsProblem) recordsDirty = false;
        }
      }
      local.lastSyncAt = now();
      await persist();
      const after = await localApps();
      pending = pendingCount(after.apps.map(toLocal), local.apps, after.excluded);
      phase = 'idle';
      problem = flags.tooBig ? 'spec_too_big' : recordsProblem;
    } catch (e) {
      await persist().catch(() => undefined);
      problem = e instanceof BackupError ? 'unavailable' : problemOf(e);
      phase = problem === 'offline' ? 'offline' : 'error';
    } finally {
      if (flags.changed) deps.onLocalAppsChanged?.();
    }
  }

  function sync(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    const g = generation;
    running = (async () => {
      try {
        do {
          again = false;
          await pass().catch(() => {
            phase = 'error';
            problem = 'unavailable';
          });
          if (g === generation) emit();
        } while (again && g === generation);
      } finally {
        running = undefined;
      }
    })();
    return running;
  }

  async function unlockRecords(passphrase: string): Promise<AccountResult> {
    if (!user || !signedIn()) return { ok: false, problem: user?.isAnonymous ? 'guest' : 'signed_out' };
    if (passphraseLength(passphrase) < MIN_PASSPHRASE_LENGTH) return { ok: false, problem: 'weak_passphrase' };
    if (!deps.online()) return { ok: false, problem: 'offline' };
    const uid = user.uid;
    try {
      const pointer = await remote.getRecordsPointer(uid);
      const text = pointer ? await fetchRecords(uid, pointer) : null;
      let key: RecordsKey;
      if (text !== null) {
        // A backup is already in the account: the same passphrase must open it.
        const opened = await openRecords(text, { passphrase }, now(), minIterations);
        key = opened.key;
        pendingRestore = opened.backup;
      } else {
        // No backup, or an incomplete one that can never be opened: start a new one.
        if (pointer) await remote.deleteRecordsPointer(uid);
        key = await newRecordsKey(passphrase, deps.randomBytes, iterations);
      }
      local.records = { key: keyToBase64(key), salt: key.salt, iterations: key.iterations, ...(text !== null && pointer ? { lastSet: pointer.set } : {}) };
      recordsDirty = true;
      await persist();
      return { ok: true };
    } catch (e) {
      if (e instanceof BackupError) return { ok: false, problem: e.code === 'wrong_passphrase_or_damaged' ? 'wrong_passphrase' : 'unavailable' };
      return { ok: false, problem: problemOf(e) };
    }
  }

  const api = {
    status: (): AccountSyncStatus => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Call on every auth change. Signing out drops the records key and in-memory state; apps stay on the device. */
    async setUser(next: AccountUser | null): Promise<void> {
      if (user?.uid === next?.uid && user?.isAnonymous === next?.isAnonymous) return;
      generation++;
      await running?.catch(() => undefined);
      const previous = user;
      if (previous && !previous.isAnonymous && local.records) {
        await store.put(previous.uid, { ...local, records: undefined }).catch(() => undefined);
      }
      user = next;
      local = next && !next.isAnonymous ? await store.get(next.uid).catch(() => emptyLocal()) : emptyLocal();
      pendingRestore = undefined;
      restored = undefined;
      recordsDirty = true;
      phase = !signedIn() ? 'signed_out' : !local.choice || local.choice === 'off' ? 'off' : 'idle';
      problem = next?.isAnonymous ? 'guest' : local.choice === 'apps_records' && !local.records ? 'needs_passphrase' : undefined;
      if (signedIn() && local.choice && local.choice !== 'off') {
        const { apps, excluded } = await localApps().catch(() => ({ apps: [] as StoredApp[], excluded: new Set<string>() }));
        pending = pendingCount(apps.map(toLocal), local.apps, excluded);
      }
      emit();
    },

    /**
     * The person's answer. `apps_records` needs the passphrase the first time on this device (and the
     * same one as before when a records backup is already in the account). Sync starts in the background.
     */
    async setChoice(choice: SyncChoice, passphrase?: string): Promise<AccountResult> {
      if (!user || !signedIn()) return { ok: false, problem: user?.isAnonymous ? 'guest' : 'signed_out' };
      if (choice === 'apps_records' && (passphrase !== undefined || !local.records)) {
        if (passphrase === undefined) return { ok: false, problem: 'needs_passphrase' };
        const unlocked = await unlockRecords(passphrase);
        if (!unlocked.ok) return unlocked;
      }
      if (choice !== 'apps_records') {
        local.records = undefined;
        pendingRestore = undefined;
      }
      local.choice = choice;
      phase = choice === 'off' ? 'off' : 'idle';
      problem = undefined;
      await persist();
      emit();
      if (choice !== 'off') void sync();
      return { ok: true };
    },

    /** "Not now": answered, nothing uploaded. Can be changed in Settings. */
    notNow(): Promise<AccountResult> {
      return api.setChoice('off');
    },

    /** Enter the passphrase again (after signing in again, or after it was changed on another device). */
    async unlockRecords(passphrase: string): Promise<AccountResult> {
      const r = await unlockRecords(passphrase);
      if (r.ok) {
        problem = undefined;
        emit();
        void sync();
      }
      return r;
    },

    sync,

    /** A local app, record or value changed. The scheduler debounces the sync itself. */
    async noteLocalChange(): Promise<void> {
      recordsDirty = true;
      if (!signedIn() || !local.choice || local.choice === 'off') return;
      const { apps, excluded } = await localApps();
      pending = pendingCount(apps.map(toLocal), local.apps, excluded);
      emit();
    },

    /** For the shelf badge. `waiting`: changed here, not in the account yet. */
    appState(app: Pick<StoredApp, 'id' | 'spec' | 'updatedAt'>): 'in_account' | 'waiting' | undefined {
      if (!signedIn() || !local.choice || local.choice === 'off') return undefined;
      const s = local.apps[app.id];
      if (s && !s.deleted && s.remoteHash && hashOf(app as StoredApp) === s.localHash) return 'in_account';
      return 'waiting';
    },

    /** Deletes every app design and the records backup from the account. Apps on devices stay. */
    async removeFromAccount(): Promise<AccountResult> {
      if (!user || !signedIn()) return { ok: false, problem: 'signed_out' };
      if (!deps.online()) return { ok: false, problem: 'offline' };
      const uid = user.uid;
      try {
        await running;
        for (const doc of await remote.pullApps(uid, 0)) await remote.deleteApp(uid, doc.id);
        const pointer = await remote.getRecordsPointer(uid);
        if (pointer) {
          await remote.deleteRecordsPointer(uid);
          for (let i = 0; i < pointer.parts; i++) await remote.deleteRecordsPart(uid, pointer.set, i).catch(() => undefined);
        }
        local = { ...emptyLocal(), choice: 'off' };
        pendingRestore = undefined;
        restored = undefined;
        phase = 'off';
        problem = undefined;
        await persist();
        emit();
        return { ok: true };
      } catch (e) {
        return { ok: false, problem: problemOf(e) };
      }
    },
  };
  return api;
}

export type AccountSync = ReturnType<typeof createAccountSync>;
