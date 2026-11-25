/**
 * Backup, restore and portable exports (docs/11 §12-13, docs/04 §17, docs/14 §15). Pure TypeScript:
 * AES-256-GCM + PBKDF2-SHA256 via @noble, gzip via fflate, so Web and Android (Hermes) share it.
 */
export { createBackupService, mergeImportedSettings, passphraseLength, type BackupServiceDeps } from './service';
export { BackupConflictError, BackupError, isBackupError, type BackupConflict, type BackupErrorCode } from './errors';
export {
  collectionToCsv, exportAppJson, exportFileName, exportRecordsJson, localStamp, type AppExportOptions, type RecordsExport,
} from './exports';
export { stripImportedClaims, validateImportedSpec } from './sanitize';
export { KDF_ITERATIONS, MIN_PASSPHRASE_LENGTH, type RandomBytes } from './crypto';
export { MAX_BACKUP_FILE_BYTES } from './envelope';
export { MAX_BLOB_BYTES } from './schemas';
export type {
  BackupAppSummary, BackupData, BackupImportSummary, BackupPreview, BackupStateRow, BackupStore, BackupWriteOptions,
  BackupWriteResult, ExportOptions, ImportOptions, KalamBackupService,
} from './types';
