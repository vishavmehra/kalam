/**
 * Schema-v2 repositories (docs/09 §9.2, docs/04 §13.3): translation cache, local-only files, AI result
 * cache (LRU) and recoverable creation sessions. Every write is shape-checked: callers are trusted
 * modules, but a bug must not be able to store unbounded or prototype-polluting data.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import type {
  AICacheRepository, BlobRepository, CreationSession, CreationSessionRepository, StoredBlob, TaskType,
  TranslationCacheRepository,
} from '@/core/contracts';
import { base64ByteLength } from '@/core/backup/base64';
import { blobSchema, timestamp } from '@/core/backup/schemas';
import { THEME_PRESETS } from '@/core/spec/schema';
import type { AICacheRow, StorageDriver, StorageTables } from './driver';
import { BlobTooLargeError, MAX_AI_CACHE_ENTRY_BYTES, MAX_BLOB_BYTES, MAX_SESSIONS, SESSION_TTL_MS } from './storage-limits';

export interface RepoContext {
  driver: StorageDriver;
  now: () => number;
  aiCacheCap: number;
  aiCacheTtlMs: number;
}

/** UTF-8 byte length without allocating (sizes shown on the Storage screen). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

// ─── Translations ─────────────────────────────────────────────────────────────
const labelMap = z
  .record(z.string().min(1).max(300), z.string().max(4_000))
  .refine((o) => Object.keys(o).length <= 5_000 && !Object.keys(o).some((k) => UNSAFE_KEYS.has(k)));
const translationSchema = z.object({
  appId: z.string().min(1).max(128),
  version: z.number().int().min(0).max(1_000_000),
  lang: z.string().regex(LANG_RE),
  sourceHash: z.string().min(1).max(128),
  strings: labelMap,
  createdAt: timestamp,
  source: z.enum(['deterministic', 'on_device', 'cloud']),
  reviewed: z.boolean().optional(),
  // Optional, additive (translate-service): which engine/model produced it, and the person's fixes by key.
  engineVersion: z.string().max(64).optional(),
  model: z.string().max(120).optional(),
  corrected: labelMap.optional(),
});

/** Stored entry: the contract fields plus the optional translate-service fields above. */
export type StoredTranslation = z.infer<typeof translationSchema>;

export function createTranslationRepository({ driver }: RepoContext): TranslationCacheRepository {
  const { tables } = driver;
  return {
    get: (appId, lang) => tables.translations.get([appId, lang]),
    async put(entry) {
      const parsed = translationSchema.safeParse(entry);
      if (!parsed.success) throw new Error('Translation could not be saved: it is not in the expected shape');
      await tables.translations.put(parsed.data);
    },
    listForApp: (appId) => tables.translations.where('appId', appId),
    removeForApp: (appId) => tables.translations.deleteWhere('appId', appId),
  };
}

// ─── Local-only files ─────────────────────────────────────────────────────────
const blobInputSchema = blobSchema.omit({ createdAt: true });

export function createBlobRepository({ driver, now }: RepoContext): BlobRepository {
  const { tables } = driver;
  return {
    async put(blob) {
      const bytes = base64ByteLength(typeof blob?.base64 === 'string' ? blob.base64 : '');
      if (bytes > MAX_BLOB_BYTES) throw new BlobTooLargeError(bytes, MAX_BLOB_BYTES);
      const parsed = blobInputSchema.safeParse(blob);
      if (!parsed.success) throw new Error('File could not be saved: it is not a valid image or recording');
      const row: StoredBlob = { ...parsed.data, bytes, createdAt: now() };
      await tables.blobs.put(row);
      return row;
    },
    get: (id) => tables.blobs.get(id),
    remove: (id) => tables.blobs.delete(id),
    removeByOwner: (ownerId) =>
      driver.transaction(async (t) => {
        const n = await t.blobs.countWhere('ownerId', ownerId);
        if (n) await t.blobs.deleteWhere('ownerId', ownerId);
        return n;
      }),
    async usage() {
      const sizes = (await tables.blobs.indexKeys('bytes')) as number[];
      return { count: sizes.length, bytes: sizes.reduce((sum, n) => sum + n, 0) };
    },
  };
}

/** Removes every file owned by `ownerId` inside an open transaction. */
export const removeOwnedBlobs = (t: StorageTables, ownerId: string) => t.blobs.deleteWhere('ownerId', ownerId);

// ─── AI result cache (LRU) ────────────────────────────────────────────────────
/**
 * Cache key from everything that changes the answer (docs/04 §13.8): task, input hash, app version,
 * prompt and output-schema version, language. Order of `parts` does not matter.
 */
export function aiCacheKey(taskType: TaskType, parts: Record<string, string | number | boolean | undefined>): string {
  const canonical = JSON.stringify(Object.keys(parts).sort().filter((k) => parts[k] !== undefined).map((k) => [k, parts[k]]));
  return `${taskType}:${bytesToHex(sha256(utf8ToBytes(canonical)))}`;
}

export function createAICacheRepository({ driver, now, aiCacheCap, aiCacheTtlMs }: RepoContext): AICacheRepository {
  const { tables } = driver;
  return {
    get<T = unknown>(key: string): Promise<T | undefined> {
      return driver.transaction(async (t) => {
        const row = await t.aiCache.get(key);
        if (!row) return undefined;
        const time = now();
        if (time - row.createdAt > aiCacheTtlMs) {
          await t.aiCache.delete(key);
          return undefined;
        }
        await t.aiCache.put({ ...row, lastUsedAt: time });
        return row.value as T;
      });
    },
    async set(key, value, meta) {
      if (typeof key !== 'string' || !key || key.length > 512) throw new Error('AI cache key must be 1 to 512 characters');
      let json: string | undefined;
      try {
        json = JSON.stringify(value);
      } catch {
        return; // not serialisable: caching is best effort
      }
      if (json === undefined) return;
      const bytes = utf8Length(json);
      if (bytes > MAX_AI_CACHE_ENTRY_BYTES) return;
      await driver.transaction(async (t) => {
        const time = now();
        const row: AICacheRow = {
          key, value: JSON.parse(json) as unknown, taskType: meta.taskType, source: meta.source, createdAt: time, lastUsedAt: time, bytes,
        };
        await t.aiCache.put(row);
        const excess = (await t.aiCache.count()) - aiCacheCap;
        if (excess > 0) for (const old of await t.aiCache.oldestKeys('lastUsedAt', excess)) await t.aiCache.delete(old);
      });
    },
    clear: () => tables.aiCache.clear(),
    size: () => tables.aiCache.count(),
  };
}

// ─── Creation sessions ────────────────────────────────────────────────────────
const sessionSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  state: z.enum(['draft', 'compiling', 'review', 'saved', 'failed']),
  createdAt: timestamp,
  updatedAt: timestamp,
  text: z.string().max(20_000),
  attachmentIds: z.array(z.string().max(200)).max(64),
  drawingId: z.string().max(160).optional(),
  audioTranscript: z.string().max(20_000).optional(),
  preferences: z
    .object({ themePreset: z.enum(THEME_PRESETS).optional(), currency: z.string().max(8).optional() })
    .optional(),
  lastError: z.string().max(500).optional(),
  resultAppId: z.string().max(128).optional(),
  /** Client details for restoring the workspace (image sizes, modality, drawing summary). Opaque, bounded. */
  draft: z.record(z.string(), z.unknown()).optional(),
});
const MAX_DRAFT_JSON = 1024 * 1024;

export type StoredSession = CreationSession & { draft?: Record<string, unknown> };

export interface SessionRepository extends CreationSessionRepository {
  list(): Promise<StoredSession[]>;
}

export function createSessionRepository({ driver, now }: RepoContext): SessionRepository {
  const newestFirst = (a: CreationSession, b: CreationSession) => b.updatedAt - a.updatedAt;
  /** Keeps the newest MAX_SESSIONS drafts touched within SESSION_TTL_MS; the rest go with their files. */
  const prune = (t: StorageTables) => async (): Promise<StoredSession[]> => {
    const all = (await t.sessions.all()).sort(newestFirst);
    const cutoff = now() - SESSION_TTL_MS;
    const keep = all.filter((s, i) => i < MAX_SESSIONS && s.updatedAt >= cutoff);
    for (const old of all.filter((s) => !keep.includes(s))) {
      await t.sessions.delete(old.id);
      await removeOwnedBlobs(t, old.id);
    }
    return keep;
  };
  return {
    async save(session) {
      const parsed = sessionSchema.safeParse(session);
      if (!parsed.success) throw new Error('Creation session could not be saved: it is not in the expected shape');
      if (parsed.data.draft && utf8Length(JSON.stringify(parsed.data.draft)) > MAX_DRAFT_JSON) {
        throw new Error('Creation session is too large to save');
      }
      await driver.transaction(async (t) => {
        await t.sessions.put(parsed.data);
        await prune(t)();
      });
    },
    get: (id) => driver.transaction(async (t) => (await prune(t)()).find((s) => s.id === id)),
    latest: () => driver.transaction(async (t) => (await prune(t)())[0]),
    list: () => driver.transaction((t) => prune(t)()),
    remove: (id) =>
      driver.transaction(async (t) => {
        await t.sessions.delete(id);
        await removeOwnedBlobs(t, id);
      }),
  };
}
