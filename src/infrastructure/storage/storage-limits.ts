/** Storage limits (docs/11 §6.4, §15.4) and the errors that explain them to the person. */
export { MAX_BLOB_BYTES } from '@/core/backup/schemas';

/** Activity log entries kept (newest first). */
export const EVENT_CAP = 500;
/** Records one collection (one list in an app) can hold. */
export const RECORD_CAP = 5_000;
/** Cached AI results kept, least recently used dropped first (docs/04 §13.8). */
export const AI_CACHE_CAP = 500;
/** Cached AI results older than this are treated as missing (docs/09 §19.4: not indefinitely). */
export const AI_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Larger AI results are simply not cached. */
export const MAX_AI_CACHE_ENTRY_BYTES = 256 * 1024;
/** Unfinished creation sessions kept; older ones and their files are removed. */
export const MAX_SESSIONS = 5;
/** Untouched drafts are removed after this long (docs/11 §6.4: temporary compiler input is not kept). */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
