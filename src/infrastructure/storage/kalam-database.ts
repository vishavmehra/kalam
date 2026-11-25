/**
 * KalamDatabase implementation shared by web (Dexie) and Android (expo-sqlite). Every data rule lives
 * here once: atomic save + version append, retention, cascade delete (versions, records, state,
 * translations, owned files), record validation and per-collection cap, per-app isolation, change
 * listeners, event cap, settings defaults, validated backup import, the schema-v2 repositories
 * (translations, files, AI cache, sessions) and the storage-manager operations.
 */
import {
  DEFAULT_SETTINGS,
  type AppVersion, type ImportSummary, type KalamBackup, type KalamDatabase, type KalamRecord, type KalamSettings,
  type SpecIssue, type StoredApp,
} from '@/core/contracts';
import { validateImportedSpec } from '@/core/backup/sanitize';
import { recordShape, stateRowSchema, storedAppShape } from '@/core/backup/schemas';
import { LIMITS, type KalamCollection, type KalamSpec } from '@/core/spec/schema';
import { validateSpec } from '@/core/spec/validate';
import { applyRetention, cloneSpec, createVersion, materialize, sameDesign, type VersionChange } from '@/core/versioning';
import { z } from 'zod';
import { createBackupStore, recordCapTracker, removeAppCascade, type LocalBackupStore } from './backup-store';
import type { StateRow, StorageDriver, StorageTables } from './driver';
import { RecordValidationError, validateRecordValues } from './record-validation';
import {
  createAICacheRepository, createBlobRepository, createSessionRepository, createTranslationRepository, removeOwnedBlobs,
  type SessionRepository,
} from './repositories';
import { createShareLinkRepository, type ShareLinkRepository } from './share-links';
import { AI_CACHE_CAP, AI_CACHE_TTL_MS, EVENT_CAP, RECORD_CAP, RecordLimitError } from './storage-limits';
import { computeStorageUsage, type StorageUsage } from './storage-usage';

export { RecordValidationError } from './record-validation';
export { BlobTooLargeError, EVENT_CAP, isRecordLimitError, RECORD_CAP, RecordLimitError } from './storage-limits';
export type { AppStorageUsage, StorageUsage } from './storage-usage';
export type { ImportSummary } from '@/core/contracts';

/** The local database: the KalamDatabase contract with every optional repository present, plus storage tools. */
export interface KalamLocalDatabase
  extends KalamDatabase, LocalBackupStore {
  translations: NonNullable<KalamDatabase['translations']>;
  blobs: NonNullable<KalamDatabase['blobs']>;
  aiCache: NonNullable<KalamDatabase['aiCache']>;
  sessions: SessionRepository;
  /** App-to-app sharing links (docs/14 §16). Deleting an app deletes its links. */
  shareLinks: ShareLinkRepository;
  /** Numbers for the Storage screen. File sizes come from an index, never by loading files. */
  usage(): Promise<StorageUsage>;
  /** Removes every cached translation. Apps keep their own language. */
  clearTranslations(): Promise<void>;
  /** Removes files whose app, drawing or draft no longer exists. Returns how many were removed. */
  removeUnusedFiles(): Promise<number>;
}

export class InvalidSpecError extends Error {
  constructor(readonly issues: SpecIssue[]) {
    super(`App design failed validation: ${issues.slice(0, 5).map((i) => `${i.path} ${i.message}`).join('; ')}`);
    this.name = 'InvalidSpecError';
  }
}

export interface DatabaseOptions {
  newId?: () => string;
  now?: () => number;
  /** Records one collection may hold (default RECORD_CAP). */
  recordCap?: number;
  aiCacheCap?: number;
  aiCacheTtlMs?: number;
}

type Listeners = Map<string, Set<() => void>>;

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function randomId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stored keys; anything else in an old row or a patch is dropped. Optional keys are not in DEFAULT_SETTINGS. */
const SETTINGS_KEYS = new Set<string>([...Object.keys(DEFAULT_SETTINGS), 'speech', 'cloudNoticeSeen', 'newAppLanguage']);

function mergeSettings(base: KalamSettings, patch: Partial<KalamSettings>): KalamSettings {
  const known = Object.fromEntries(
    Object.entries(patch).filter(([k, v]) => SETTINGS_KEYS.has(k) && v !== undefined),
  ) as Partial<KalamSettings>;
  return { ...base, ...known, accessModes: { ...base.accessModes, ...patch.accessModes } };
}

const byCreated = (a: KalamRecord, b: KalamRecord) => a.createdAt - b.createdAt;
const shelfTime = (a: StoredApp) => Math.max(a.lastOpenedAt ?? 0, a.updatedAt);

// ─── Plain JSON backup envelope (untrusted input; items are checked one by one) ─
const backupSchema = z.object({
  format: z.literal('kalam-backup'),
  formatVersion: z.literal(1),
  exportedAt: z.number(),
  apps: z.array(z.unknown()).max(1_000),
  records: z.array(z.unknown()).max(200_000),
  state: z.array(z.unknown()).max(50_000),
});

function collectionOf(spec: KalamSpec | undefined, collectionId: string): KalamCollection | undefined {
  return spec && has(spec.collections, collectionId) ? spec.collections[collectionId] : undefined;
}

function checkedValues(collection: KalamCollection, values: unknown): KalamRecord['values'] {
  const result = validateRecordValues(collection, values);
  if (!result.ok) throw new RecordValidationError(result.issues);
  return result.values;
}

export function createKalamDatabase(driver: StorageDriver, options: DatabaseOptions = {}): KalamLocalDatabase {
  const newId = options.newId ?? randomId;
  const now = options.now ?? Date.now;
  const recordCap = options.recordCap ?? RECORD_CAP;
  const { tables } = driver;
  const recordListeners: Listeners = new Map();
  const stateListeners: Listeners = new Map();
  const repoContext = {
    driver, now, aiCacheCap: options.aiCacheCap ?? AI_CACHE_CAP, aiCacheTtlMs: options.aiCacheTtlMs ?? AI_CACHE_TTL_MS,
  };

  function subscribe(map: Listeners, appId: string, listener: () => void): () => void {
    let set = map.get(appId);
    if (!set) map.set(appId, (set = new Set()));
    set.add(listener);
    return () => void set.delete(listener);
  }
  function emit(map: Listeners, appId: string): void {
    for (const listener of map.get(appId) ?? []) {
      try {
        listener();
      } catch (error) {
        console.warn('[kalam/storage] change listener failed', error);
      }
    }
  }

  /** Atomic within `t`: validate, persist app, append version, apply retention. */
  async function saveApp(t: StorageTables, app: StoredApp, change: VersionChange): Promise<StoredApp> {
    if (app.id !== app.spec.id) throw new Error('App id does not match its design id');
    const existing = await t.apps.get(app.id);
    if (existing && sameDesign(existing.spec, app.spec)) {
      // Metadata-only change (pin, origin, …): no new design version.
      const saved: StoredApp = { ...app, spec: existing.spec, createdAt: existing.createdAt };
      await t.apps.put(saved);
      return saved;
    }
    const history = await t.versions.where('appId', app.id);
    if (!existing && history.length) await t.versions.deleteWhere('appId', app.id); // orphaned history
    const latest = existing
      ? history.reduce<AppVersion | undefined>((m, v) => (!m || v.version > m.version ? v : m), undefined)
      : undefined;
    const previous = existing && latest ? { version: latest.version, spec: existing.spec } : undefined;
    const time = now();
    const candidate = { ...app.spec, version: (previous?.version ?? 0) + 1, meta: { ...app.spec.meta, updatedAt: time } };
    const result = validateSpec(candidate);
    if (!result.ok || !result.spec) throw new InvalidSpecError(result.errors);
    const stored: StoredApp = { ...app, spec: result.spec, createdAt: existing?.createdAt ?? app.createdAt, updatedAt: time };
    const entry = createVersion(app.id, previous, result.spec, change, time);
    await t.apps.put(stored);
    await t.versions.put(entry);
    const { remove, rebased } = applyRetention(previous ? [...history, entry] : [entry]);
    for (const version of remove) await t.versions.delete([app.id, version]);
    if (rebased) await t.versions.put(rebased);
    return stored;
  }

  async function requireCollection(t: StorageTables, appId: string, collectionId: string): Promise<KalamCollection> {
    const app = await t.apps.get(appId);
    if (!app) throw new Error(`App ${appId} not found`);
    const collection = collectionOf(app.spec, collectionId);
    if (!collection) throw new Error(`Collection ${collectionId} does not exist in this app`);
    return collection;
  }

  /** Isolation: a record is only reachable through its own app + collection. */
  async function requireOwnRecord(t: StorageTables, appId: string, collectionId: string, id: string): Promise<KalamRecord> {
    const record = await t.records.get(id);
    if (!record || record.appId !== appId || record.collectionId !== collectionId) throw new Error('Record not found');
    return record;
  }

  const shareLinks = createShareLinkRepository(driver);

  const backupStore = createBackupStore(driver, {
    newId,
    now,
    recordCap,
    mergeSettings: (base, patch) => mergeSettings(mergeSettings(DEFAULT_SETTINGS, base), patch),
  });

  const db: KalamLocalDatabase = {
    apps: {
      async list() {
        const all = await tables.apps.all();
        return all.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || shelfTime(b) - shelfTime(a));
      },
      get: (id) => tables.apps.get(id),
      save: (app, change) => driver.transaction((t) => saveApp(t, app, change)),
      async remove(id) {
        await driver.transaction((t) => removeAppCascade(t, id));
        emit(recordListeners, id);
        emit(stateListeners, id);
        shareLinks.notifyChanged();
      },
      async touch(id) {
        await driver.transaction(async (t) => {
          const app = await t.apps.get(id);
          if (app) await t.apps.put({ ...app, lastOpenedAt: now() });
        });
      },
    },

    versions: {
      /** Newest first. */
      async list(appId) {
        return (await tables.versions.where('appId', appId)).sort((a, b) => b.version - a.version);
      },
      async materialize(appId, version) {
        return materialize(await tables.versions.where('appId', appId), version);
      },
    },

    records: {
      async list(appId, collectionId) {
        return (await tables.records.where('[appId+collectionId]', [appId, collectionId])).sort(byCreated);
      },
      async listAll(appId) {
        const app = await tables.apps.get(appId);
        const rows = await tables.records.where('appId', appId);
        const out: Record<string, KalamRecord[]> = {};
        for (const id of Object.keys(app?.spec.collections ?? {})) out[id] = [];
        for (const row of rows.sort(byCreated)) (out[row.collectionId] ??= []).push(row);
        return out;
      },
      async insert(appId, collectionId, values) {
        const record = await driver.transaction(async (t) => {
          const collection = await requireCollection(t, appId, collectionId);
          if ((await t.records.countWhere('[appId+collectionId]', [appId, collectionId])) >= recordCap) {
            throw new RecordLimitError(collectionId, recordCap);
          }
          const time = now();
          const row: KalamRecord = {
            id: newId(), appId, collectionId, createdAt: time, updatedAt: time, values: checkedValues(collection, values),
          };
          await t.records.put(row);
          return row;
        });
        emit(recordListeners, appId);
        return record;
      },
      async update(appId, collectionId, id, values) {
        const record = await driver.transaction(async (t) => {
          const existing = await requireOwnRecord(t, appId, collectionId, id);
          const collection = await requireCollection(t, appId, collectionId);
          // Fields removed from the design since this record was written are dropped, not rejected.
          const kept = Object.fromEntries(Object.entries(existing.values).filter(([k]) => has(collection.fields, k)));
          const row: KalamRecord = { ...existing, updatedAt: now(), values: checkedValues(collection, { ...kept, ...values }) };
          await t.records.put(row);
          return row;
        });
        emit(recordListeners, appId);
        return record;
      },
      async remove(appId, collectionId, id) {
        await driver.transaction(async (t) => {
          await requireOwnRecord(t, appId, collectionId, id);
          await t.records.delete(id);
        });
        emit(recordListeners, appId);
      },
      subscribe: (appId, listener) => subscribe(recordListeners, appId, listener),
    },

    state: {
      async all(appId) {
        const rows = await tables.state.where('appId', appId);
        return Object.fromEntries(rows.map((r) => [r.key, r.value]));
      },
      async set(appId, key, value) {
        const row = stateRowSchema.safeParse({ appId, key, value });
        if (!row.success) throw new Error(`Invalid state value for ${String(key)}`);
        await driver.transaction(async (t) => {
          if (!(await t.apps.get(appId))) throw new Error(`App ${appId} not found`);
          await t.state.put(row.data);
        });
        emit(stateListeners, appId);
      },
      subscribe: (appId, listener) => subscribe(stateListeners, appId, listener),
    },

    events: {
      async add(event) {
        await driver.transaction(async (t) => {
          await t.events.put(event);
          if ((await t.events.count()) <= EVENT_CAP) return;
          const all = (await t.events.all()).sort((a, b) => b.at - a.at);
          for (const old of all.slice(EVENT_CAP)) await t.events.delete(old.id);
        });
      },
      async list(limit = EVENT_CAP) {
        return (await tables.events.all()).sort((a, b) => b.at - a.at).slice(0, limit);
      },
      clear: () => tables.events.clear(),
    },

    settings: {
      async get() {
        const row = await tables.settings.get('me');
        return mergeSettings(DEFAULT_SETTINGS, row?.settings ?? {});
      },
      update: (patch) =>
        driver.transaction(async (t) => {
          const row = await t.settings.get('me');
          const next = mergeSettings(mergeSettings(DEFAULT_SETTINGS, row?.settings ?? {}), patch);
          await t.settings.put({ id: 'me', settings: next });
          return next;
        }),
    },

    drawings: {
      save: (doc) => tables.drawings.put(doc),
      get: (id) => tables.drawings.get(id),
      async list() {
        return (await tables.drawings.all()).sort((a, b) => b.updatedAt - a.updatedAt);
      },
      /** The drawing and every file it owns (placed images, page exports). */
      remove: (id) =>
        driver.transaction(async (t) => {
          await t.drawings.delete(id);
          await removeOwnedBlobs(t, id);
        }),
    },

    translations: createTranslationRepository(repoContext),
    blobs: createBlobRepository(repoContext),
    aiCache: createAICacheRepository(repoContext),
    sessions: createSessionRepository(repoContext),
    shareLinks,

    exportAll: () =>
      driver.transaction(
        async (t): Promise<KalamBackup> => ({
          format: 'kalam-backup',
          formatVersion: 1,
          exportedAt: now(),
          apps: await t.apps.all(),
          records: await t.records.all(),
          state: (await t.state.all()).map(({ appId, key, value }) => ({ appId, key, value })),
        }),
      ),

    async importAll(input) {
      const envelope = backupSchema.safeParse(input);
      if (!envelope.success) throw new Error('This file is not a valid Kalam backup');
      const backup = envelope.data;
      const summary: ImportSummary = { apps: 0, records: 0, skippedApps: 0, skippedRecords: 0, skippedState: 0 };
      const time = now();

      // Validate everything first; nothing invalid reaches storage and invalid files change nothing.
      // Imported designs lose any claimed AI-block verification and provenance (SECURITY_REVIEW R-09).
      const specs = new Map<string, KalamSpec>();
      const apps: StoredApp[] = [];
      for (const raw of backup.apps) {
        const shape = storedAppShape.safeParse(raw);
        const spec = shape.success ? validateImportedSpec(shape.data.spec) : undefined;
        if (!shape.success || !spec || specs.has(spec.id)) {
          summary.skippedApps++;
          continue;
        }
        specs.set(spec.id, spec);
        apps.push({
          ...shape.data,
          id: spec.id,
          spec,
          createdAt: shape.data.createdAt ?? time,
          updatedAt: shape.data.updatedAt ?? time,
          origin: shape.data.origin ?? { route: 'import' },
        });
      }
      const records: KalamRecord[] = [];
      for (const raw of backup.records) {
        const shape = recordShape.safeParse(raw);
        const collection = shape.success ? collectionOf(specs.get(shape.data.appId), shape.data.collectionId) : undefined;
        const values = shape.success && collection ? validateRecordValues(collection, shape.data.values) : undefined;
        if (!shape.success || !values?.ok) {
          summary.skippedRecords++;
          continue;
        }
        const { id, appId, collectionId, createdAt = time, updatedAt = time } = shape.data;
        records.push({ id, appId, collectionId, createdAt, updatedAt, values: values.values });
      }
      const state: StateRow[] = [];
      for (const raw of backup.state) {
        const shape = stateRowSchema.safeParse(raw);
        if (shape.success && specs.has(shape.data.appId)) state.push(shape.data);
        else summary.skippedState++;
      }

      await driver.transaction(async (t) => {
        for (const app of apps) {
          await saveApp(t, app, { summary: 'Imported from backup', source: 'import' });
          summary.apps++;
        }
        const allow = recordCapTracker(t, recordCap);
        for (const record of records) {
          // Never let an imported row overwrite a record that belongs to another app/collection.
          const clash = await t.records.get(record.id);
          const foreign = clash && (clash.appId !== record.appId || clash.collectionId !== record.collectionId);
          if (!clash && !(await allow(record.appId, record.collectionId))) {
            summary.skippedRecords++;
            continue;
          }
          await t.records.put(foreign ? { ...record, id: newId() } : record);
          summary.records++;
        }
        for (const row of state) await t.state.put(row);
      });
      for (const appId of specs.keys()) {
        emit(recordListeners, appId);
        emit(stateListeners, appId);
      }
      return summary;
    },

    restore: (appId, version) =>
      driver.transaction(async (t) => {
        const app = await t.apps.get(appId);
        if (!app) throw new Error(`App ${appId} not found`);
        const spec = materialize(await t.versions.where('appId', appId), version);
        if (!spec) throw new Error(`Version ${version} is no longer available`);
        return saveApp(t, { ...app, spec }, { summary: `Restored version ${version}`, source: 'restore' });
      }),

    async duplicate(appId) {
      const source = await tables.apps.get(appId);
      if (!source) throw new Error(`App ${appId} not found`);
      const id = `app_${newId().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 16)}`;
      const time = now();
      const spec: KalamSpec = {
        ...cloneSpec(source.spec),
        id,
        version: 1,
        name: `${source.spec.name.slice(0, LIMITS.nameLength - 7)} (copy)`,
        meta: { ...source.spec.meta, createdAt: time, updatedAt: time, basedOn: source.id, source: 'remix' },
      };
      // The copy is an independent app: the original's creation prompt stays with the original
      // (docs/12 §11.2; a remix must not carry the maker's private description along).
      const copy: StoredApp = { id, spec, createdAt: time, updatedAt: time, origin: source.origin };
      return db.apps.save(copy, { summary: `Remixed from ${source.spec.name}`, source: 'create' });
    },

    ...backupStore,
    async writeBackupData(data, opts) {
      const result = await backupStore.writeBackupData(data, opts);
      for (const appId of new Set([...opts.replaceAppIds, ...data.apps.map((a) => a.id)])) {
        emit(recordListeners, appId);
        emit(stateListeners, appId);
      }
      shareLinks.notifyChanged();
      return result;
    },
    usage: () => computeStorageUsage(driver),
    clearTranslations: () => tables.translations.clear(),
    async removeUnusedFiles() {
      const { unusedFiles } = await computeStorageUsage(driver);
      // Owners are re-checked inside the write transaction, so a file adopted meanwhile is kept.
      return driver.transaction(async (t) => {
        let removed = 0;
        for (const owner of unusedFiles.owners) {
          if ((await t.apps.get(owner)) || (await t.drawings.get(owner)) || (await t.sessions.get(owner))) continue;
          removed += await t.blobs.countWhere('ownerId', owner);
          await removeOwnedBlobs(t, owner);
        }
        return removed;
      });
    },
  };
  return db;
}
