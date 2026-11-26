/** Storage limits (docs/11 §6.4, §15.4) and the errors that explain them to the person. */
import { limitsPolicy } from '@/core/limits/policy';

export { MAX_BLOB_BYTES } from '@/core/backup/schemas';

/** Activity log entries kept (newest first). */
export const EVENT_CAP = limitsPolicy.data.eventLogEntries;
/** Records one collection (one list in an app) can hold. */
export const RECORD_CAP = limitsPolicy.data.recordsPerCollection;
/** Cached AI results kept, least recently used dropped first (docs/04 §13.8). */
export const AI_CACHE_CAP = limitsPolicy.data.aiCacheEntries;
/** Cached AI results older than this are treated as missing (docs/09 §19.4: not indefinitely). */
export const AI_CACHE_TTL_MS = limitsPolicy.data.aiCacheTtlMs;
/** Larger AI results are simply not cached. */
export const MAX_AI_CACHE_ENTRY_BYTES = limitsPolicy.data.aiCacheEntryBytes;
/** Unfinished creation sessions kept; older ones and their files are removed. */
export const MAX_SESSIONS = limitsPolicy.data.draftSessions;
/** Untouched drafts are removed after this long (docs/11 §6.4: temporary compiler input is not kept). */
export const SESSION_TTL_MS = limitsPolicy.data.draftTtlMs;

const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export class RecordLimitError extends Error {
  readonly code = 'record_limit';
  constructor(readonly collectionId: string, readonly limit: number = RECORD_CAP) {
    super(`This list is full. It can hold ${thousands(limit)} entries. Delete or export some entries, then add new ones.`);
    this.name = 'RecordLimitError';
  }
}

/** Structural check, so the runtime can recognise it without importing storage code. */
export function isRecordLimitError(error: unknown): error is RecordLimitError {
  return error instanceof Error && error.name === 'RecordLimitError';
}

export class BlobTooLargeError extends Error {
  readonly code = 'blob_too_large';
  constructor(readonly bytes: number, readonly limit: number) {
    super(`This file is too large to keep on this device. The limit is ${Math.round(limit / (1024 * 1024))} MB.`);
    this.name = 'BlobTooLargeError';
  }
}
