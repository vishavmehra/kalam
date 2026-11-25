/**
 * Numbers for the Storage screen (docs/11 §6.5, docs/09 §19.5, docs/04 §13.9). Sizes are UTF-8 JSON
 * estimates; file sizes come from an index, so photo bytes are never loaded just to be counted.
 */
import type { KalamCollection } from '@/core/spec/schema';
import type { StorageDriver } from './driver';
import { utf8Length } from './repositories';

export interface AppStorageUsage {
  appId: string;
  name: string;
  /** Current design (spec + app metadata). */
  designBytes: number;
  /** Older design versions. */
  historyBytes: number;
  versions: number;
  records: number;
  recordBytes: number;
  /** Local files owned by the app. */
  fileBytes: number;
  translationBytes: number;
  collections: Array<{ id: string; label: string; records: number }>;
  totalBytes: number;
}

export interface StorageUsage {
  apps: AppStorageUsage[];
  drawings: { count: number; bytes: number; fileBytes: number };
  /** Every local file (photos, frames, page images), including unfinished drafts. */
  files: { count: number; bytes: number };
  drafts: { sessions: number; fileBytes: number };
  aiCache: { entries: number; bytes: number };
  translations: { entries: number; bytes: number };
  /** Files whose app, drawing or draft no longer exists (docs/11 §6.5 "unused thumbnails"). */
  unusedFiles: { count: number; bytes: number; owners: string[] };
  totalBytes: number;
}

const jsonBytes = (value: unknown) => utf8Length(JSON.stringify(value) ?? '');

export async function computeStorageUsage(driver: StorageDriver): Promise<StorageUsage> {
  return driver.transaction(async (t) => {
    // Sequential on purpose: one SQLite connection runs one statement at a time.
    const apps = await t.apps.all();
    const versions = await t.versions.all();
    const records = await t.records.all();
    const translations = await t.translations.all();
    const drawings = await t.drawings.all();
    const sessions = await t.sessions.all();
    const ownerBytes = new Map<string, number>();
    const ownerCount = new Map<string, number>();
    for (const key of await t.blobs.indexKeys('[ownerId+bytes]')) {
      if (!Array.isArray(key) || typeof key[0] !== 'string' || typeof key[1] !== 'number') continue;
      ownerBytes.set(key[0], (ownerBytes.get(key[0]) ?? 0) + key[1]);
      ownerCount.set(key[0], (ownerCount.get(key[0]) ?? 0) + 1);
    }
    const live = new Set([...apps.map((a) => a.id), ...drawings.map((d) => d.id), ...sessions.map((s) => s.id)]);
    const orphanOwners = [...ownerBytes.keys()].filter((owner) => !live.has(owner));
    const fileSizes = (await t.blobs.indexKeys('bytes')).filter((n): n is number => typeof n === 'number');
    const cacheSizes = (await t.aiCache.indexKeys('bytes')).filter((n): n is number => typeof n === 'number');

    const byApp = new Map<string, { history: number; versions: number; records: number; recordBytes: number; translations: number; perCollection: Map<string, number> }>();
    const slot = (appId: string) => {
      let s = byApp.get(appId);
      if (!s) byApp.set(appId, (s = { history: 0, versions: 0, records: 0, recordBytes: 0, translations: 0, perCollection: new Map() }));
      return s;
    };
    const currentVersion = new Map(apps.map((a) => [a.id, a.spec.version]));
    for (const v of versions) {
      if (v.version === currentVersion.get(v.appId)) continue;
      const s = slot(v.appId);
      s.history += jsonBytes(v);
      s.versions++;
    }
    for (const r of records) {
      const s = slot(r.appId);
      s.records++;
      s.recordBytes += jsonBytes(r);
      s.perCollection.set(r.collectionId, (s.perCollection.get(r.collectionId) ?? 0) + 1);
    }
    for (const tr of translations) slot(tr.appId).translations += jsonBytes(tr);

    const appUsage: AppStorageUsage[] = apps.map((app) => {
      const s = slot(app.id);
      const designBytes = jsonBytes(app);
      const fileBytes = ownerBytes.get(app.id) ?? 0;
      const collections = Object.entries(app.spec.collections as Record<string, KalamCollection>).map(([id, c]) => ({
        id, label: c.label ?? id, records: s.perCollection.get(id) ?? 0,
      }));
      return {
        appId: app.id, name: app.spec.name, designBytes, historyBytes: s.history, versions: s.versions, records: s.records,
        recordBytes: s.recordBytes, fileBytes, translationBytes: s.translations, collections,
        totalBytes: designBytes + s.history + s.recordBytes + fileBytes + s.translations,
      };
    }).sort((a, b) => b.totalBytes - a.totalBytes);

    const drawingBytes = drawings.reduce((sum, d) => sum + jsonBytes(d), 0);
    const drawingFiles = drawings.reduce((sum, d) => sum + (ownerBytes.get(d.id) ?? 0), 0);
    const draftFiles = sessions.reduce((sum, s) => sum + (ownerBytes.get(s.id) ?? 0), 0);
    const files = { count: fileSizes.length, bytes: fileSizes.reduce((a, b) => a + b, 0) };
    const aiCache = { entries: cacheSizes.length, bytes: cacheSizes.reduce((a, b) => a + b, 0) };
    const translationBytes = translations.reduce((sum, tr) => sum + jsonBytes(tr), 0);
    const appsWithoutFiles = appUsage.reduce((sum, a) => sum + a.totalBytes - a.fileBytes - a.translationBytes, 0);
    return {
      apps: appUsage,
      drawings: { count: drawings.length, bytes: drawingBytes, fileBytes: drawingFiles },
      files,
      drafts: { sessions: sessions.length, fileBytes: draftFiles },
      aiCache,
      translations: { entries: translations.length, bytes: translationBytes },
      unusedFiles: {
        count: orphanOwners.reduce((sum, o) => sum + (ownerCount.get(o) ?? 0), 0),
        bytes: orphanOwners.reduce((sum, o) => sum + (ownerBytes.get(o) ?? 0), 0),
        owners: orphanOwners,
      },
      totalBytes: appsWithoutFiles + drawingBytes + files.bytes + aiCache.bytes + translationBytes,
    };
  });
}
