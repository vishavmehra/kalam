/**
 * Type shim + Node/Vitest default. Metro resolves `database.web.ts` / `database.native.ts` first,
 * so apps never load this file; tsc and Vitest do (Vitest runs on fake-indexeddb).
 * Both platform files export exactly these names.
 */
export {
  getDatabase, secureRandomBytes, InvalidSpecError, RecordLimitError, RecordValidationError, BlobTooLargeError,
  isRecordLimitError,
} from './database.web';
export type { ImportSummary, KalamLocalDatabase, StorageUsage } from './database.web';
