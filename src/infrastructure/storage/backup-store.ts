/**
 * Storage side of backup/restore (docs/11 §12.7 step 10, docs/04 §17.4): one consistent read for
 * export, one transaction for restore. Record values and saved app values are validated here again,
 * against the app being written, because the store owns that rule for every write (docs/09 §10.5).
 */
import type { AppVersion, KalamRecord, KalamSettings, StoredApp, StoredBlob } from '@/core/contracts';
import type { BackupData, BackupStore, BackupWriteOptions, BackupWriteResult } from '@/core/backup/types';
import { stateRowSchema } from '@/core/backup/schemas';
import type { KalamCollection, KalamSpec } from '@/core/spec/schema';
import { cloneSpec } from '@/core/versioning';
import type { StorageDriver, StorageTables } from './driver';
import { validateRecordValues } from './record-validation';
import { removeOwnedBlobs } from './repositories';
import { removeLinksOfApp } from './share-links';

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export interface LocalStoreDeps {
  newId: () => string;
  now: () => number;
  recordCap: number;
  mergeSettings: (base: Partial<KalamSettings>, patch: Partial<KalamSettings>) => KalamSettings;
}

/** Deletes an app with everything that belongs to it, inside an open transaction. */
export async function removeAppCascade(t: StorageTables, appId: string): Promise<void> {
  await t.apps.delete(appId);
  await t.versions.deleteWhere('appId', appId);
  await t.records.deleteWhere('appId', appId);
  await t.state.deleteWhere('appId', appId);
  await t.translations.deleteWhere('appId', appId);
  await removeLinksOfApp(t, appId); // links with another app go too (docs/14 §16)
  await removeOwnedBlobs(t, appId);
}

/** Per-collection record counts for one transaction, so bulk writes respect the cap. */
export function recordCapTracker(t: StorageTables, cap: number) {
  const counts = new Map<string, number>();
  return async (appId: string, collectionId: string): Promise<boolean> => {
    const key = JSON.stringify([appId, collectionId]);
    let n = counts.get(key);
    if (n === undefined) n = await t.records.countWhere('[appId+collectionId]', [appId, collectionId]);
    if (n >= cap) {
      counts.set(key, n);
      return false;
    }
    counts.set(key, n + 1);
    return true;
  };
}

export interface LocalBackupStore extends BackupStore {
  /** Deletes every older design version of an app. The current design, records and saved values stay. */
  clearHistory(appId: string): Promise<number>;
}

export function createBackupStore(driver: StorageDriver, deps: LocalStoreDeps): LocalBackupStore {
  return {
    readBackupData: () =>
      driver.transaction(async (t): Promise<BackupData> => {
        const apps = await t.apps.all();
        const drawings = await t.drawings.all();
        const blobs: StoredBlob[] = [];
        for (const owner of [...apps.map((a) => a.id), ...drawings.map((d) => d.id)]) blobs.push(...(await t.blobs.where('ownerId', owner)));
        const settingsRow = await t.settings.get('me');
        return {
          apps,
          versions: await t.versions.all(),
          records: await t.records.all(),
          state: (await t.state.all()).map(({ appId, key, value }) => ({ appId, key, value })),
          drawings,
          blobs,
          ...(settingsRow ? { settings: settingsRow.settings } : {}),
        };
      }),

    writeBackupData: (data: BackupData, opts: BackupWriteOptions) =>
      driver.transaction(async (t): Promise<BackupWriteResult> => {
        const result: BackupWriteResult = { records: 0, skippedRecords: 0, skippedState: 0 };
        const replace = new Set(opts.replaceAppIds);
        for (const id of opts.replaceAppIds) await removeAppCascade(t, id);
        for (const id of opts.replaceDrawingIds) {
          await t.drawings.delete(id);
          await removeOwnedBlobs(t, id);
        }

        const specs = new Map<string, KalamSpec>();
        for (const app of data.apps) {
          // Never replace a local app the caller did not name: that choice belongs to the person.
          if (!replace.has(app.id) && (await t.apps.get(app.id))) throw new Error(`App ${app.id} is already on this device`);
          await t.versions.deleteWhere('appId', app.id); // orphaned history from an earlier delete
          await t.apps.put(app satisfies StoredApp);
          specs.set(app.id, app.spec);
        }
        for (const version of data.versions) {
          if (specs.has(version.appId)) await t.versions.put(version satisfies AppVersion);
        }

        const allow = recordCapTracker(t, deps.recordCap);
        for (const record of data.records) {
          const spec = specs.get(record.appId);
          const collection: KalamCollection | undefined =
            spec && has(spec.collections, record.collectionId) ? spec.collections[record.collectionId] : undefined;
          const values = collection ? validateRecordValues(collection, record.values) : undefined;
          if (!values?.ok || !(await allow(record.appId, record.collectionId))) {
            result.skippedRecords++;
            continue;
          }
          const clash = await t.records.get(record.id);
          const foreign = clash && (clash.appId !== record.appId || clash.collectionId !== record.collectionId);
          const row: KalamRecord = { ...record, values: values.values, ...(foreign ? { id: deps.newId() } : {}) };
          await t.records.put(row);
          result.records++;
        }

        for (const raw of data.state) {
          const row = stateRowSchema.safeParse(raw);
          if (row.success && specs.has(row.data.appId)) await t.state.put(row.data);
          else result.skippedState++;
        }
        for (const doc of data.drawings) await t.drawings.put(doc);
        for (const blob of data.blobs) await t.blobs.put(blob);
        if (opts.settings) {
          const current = (await t.settings.get('me'))?.settings ?? {};
          await t.settings.put({ id: 'me', settings: deps.mergeSettings(current, opts.settings) });
        }
        return result;
      }),

    clearHistory: (appId) =>
      driver.transaction(async (t) => {
        const app = await t.apps.get(appId);
        if (!app) throw new Error(`App ${appId} not found`);
        const versions = await t.versions.where('appId', appId);
        const current = versions.find((v) => v.version === app.spec.version);
        const older = versions.filter((v) => v.version !== app.spec.version);
        if (!older.length && current?.kind === 'snapshot') return 0;
        for (const v of older) await t.versions.delete([appId, v.version]);
        // The kept version must stand alone: a patch would point at a version that no longer exists.
        await t.versions.put({
          appId,
          version: app.spec.version,
          createdAt: current?.createdAt ?? deps.now(),
          kind: 'snapshot',
          snapshot: cloneSpec(app.spec),
          summary: current?.summary ?? 'Current design',
          source: current?.source ?? 'edit',
        });
        return older.length;
      }),
  };
}
