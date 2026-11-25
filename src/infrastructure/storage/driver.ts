/**
 * Minimal table store that both backends implement (Dexie/IndexedDB on web, expo-sqlite on Android).
 * All Kalam data rules live once in `kalam-database.ts` on top of this.
 */
import type {
  AppVersion, CreationSession, DrawingDocument, InferenceEvent, InferenceSource, KalamRecord, KalamSettings,
  RecordValue, StoredApp, StoredBlob, TaskType, TranslationCacheEntry,
} from '@/core/contracts';
import type { ShareLink } from '@/core/share/model';

export type StoreKey = string | number | Array<string | number>;

export interface StoreTable<T> {
  get(key: StoreKey): Promise<T | undefined>;
  put(row: T): Promise<void>;
  delete(key: StoreKey): Promise<void>;
  /** Rows whose index (one of TABLES[table].indexes) equals `value`. */
  where(index: string, value: StoreKey): Promise<T[]>;
  deleteWhere(index: string, value: StoreKey): Promise<void>;
  /** Number of rows whose index equals `value`, without loading them. */
  countWhere(index: string, value: StoreKey): Promise<number>;
  /** Index values of every indexed row, without loading the rows (cheap usage totals). */
  indexKeys(index: string): Promise<StoreKey[]>;
  /** Primary keys of the `limit` rows with the smallest value of a NUMERIC index (LRU eviction). */
  oldestKeys(index: string, limit: number): Promise<StoreKey[]>;
  all(): Promise<T[]>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

export interface StateRow { appId: string; key: string; value: RecordValue }
export interface SettingsRow { id: 'me'; settings: Partial<KalamSettings> }
/** One cached, already validated AI result (docs/04 §13.8). `lastUsedAt` drives LRU eviction. */
export interface AICacheRow {
  key: string;
  value: unknown;
  taskType: TaskType;
  source: InferenceSource;
  createdAt: number;
  lastUsedAt: number;
  /** Approximate size of the JSON value, for the Storage screen. */
  bytes: number;
}

export interface StorageTables {
  apps: StoreTable<StoredApp>;
  versions: StoreTable<AppVersion>;
  records: StoreTable<KalamRecord>;
  state: StoreTable<StateRow>;
  events: StoreTable<InferenceEvent>;
  settings: StoreTable<SettingsRow>;
  drawings: StoreTable<DrawingDocument>;
  // Schema v2 (wave 3): docs/09 §9.2, docs/04 §13.3.
  translations: StoreTable<TranslationCacheEntry>;
  blobs: StoreTable<StoredBlob>;
  aiCache: StoreTable<AICacheRow>;
  sessions: StoreTable<CreationSession>;
  // Schema v3 (wave 6): docs/14 §16, §24 `appShares`.
  shareLinks: StoreTable<ShareLink>;
}

export interface StorageDriver {
  tables: StorageTables;
  /** Runs `fn` atomically; only the tables passed to `fn` may be used inside it. */
  transaction<R>(fn: (tables: StorageTables) => Promise<R>): Promise<R>;
}

export type TableName = keyof StorageTables;

/** Primary key and secondary indexes per table, in Dexie notation (`[a+b]` = compound). */
export const TABLES = {
  apps: { key: 'id', indexes: [] },
  versions: { key: '[appId+version]', indexes: ['appId'] },
  records: { key: 'id', indexes: ['appId', '[appId+collectionId]'] },
  state: { key: '[appId+key]', indexes: ['appId'] },
  events: { key: 'id', indexes: [] },
  settings: { key: 'id', indexes: [] },
  drawings: { key: 'id', indexes: [] },
  translations: { key: '[appId+lang]', indexes: ['appId'] },
  blobs: { key: 'id', indexes: ['ownerId', 'bytes', '[ownerId+bytes]'] },
  aiCache: { key: 'key', indexes: ['lastUsedAt', 'bytes'] },
  sessions: { key: 'id', indexes: ['updatedAt'] },
  shareLinks: { key: 'id', indexes: ['sourceAppId', 'destinationAppId'] },
} as const satisfies Record<TableName, { key: string; indexes: readonly string[] }>;

export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

/** Value of a key path for a row: `id` → row.id, `[appId+version]` → [row.appId, row.version]. */
export function keyPathValue(path: string, row: object): StoreKey {
  const r = row as Record<string, string | number>;
  if (!path.startsWith('[')) return r[path];
  return path.slice(1, -1).split('+').map((p) => r[p]);
}
