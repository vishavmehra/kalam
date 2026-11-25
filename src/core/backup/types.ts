/** Backup data model and the storage port the backup service needs (docs/11 §12, docs/14 §15). */
import type {
  AppVersion, BackupManifest, BackupService, DrawingDocument, ImportSummary, KalamRecord, KalamSettings, RecordValue,
  StoredApp, StoredBlob,
} from '../contracts';
import type { BackupConflict } from './errors';

export interface BackupStateRow { appId: string; key: string; value: RecordValue }

/** Everything a full backup holds. Temporary data (AI cache, drafts, activity log) is never included. */
export interface BackupData {
  apps: StoredApp[];
  versions: AppVersion[];
  records: KalamRecord[];
  state: BackupStateRow[];
  drawings: DrawingDocument[];
  /** Local-only files owned by an app or a drawing (placed images, attachments). */
  blobs: StoredBlob[];
  settings?: Partial<KalamSettings>;
}

export interface BackupWriteOptions {
  /** Local apps removed first, with their versions, records, state, translations and owned files. */
  replaceAppIds: string[];
  /** Local drawings removed first, with their owned files. */
  replaceDrawingIds: string[];
  /** Settings merged into the local settings (already filtered to safe keys). */
  settings?: Partial<KalamSettings>;
}

export interface BackupWriteResult {
  records: number;
  skippedRecords: number;
  skippedState: number;
}

/**
 * Storage operations the backup service needs beyond the KalamDatabase contract. The local database
 * implements them; `writeBackupData` is ONE transaction, so a failed restore changes nothing.
 */
export interface BackupStore {
  readBackupData(): Promise<BackupData>;
  writeBackupData(data: BackupData, opts: BackupWriteOptions): Promise<BackupWriteResult>;
}

export interface BackupAppSummary {
  id: string;
  name: string;
  records: number;
  versions: number;
}

/** The manifest plus what a restore would do on THIS device. Nothing is written by `preview()`. */
export interface BackupPreview extends BackupManifest {
  apps: BackupAppSummary[];
  drawingCount: number;
  settingsIncluded: boolean;
  /** Apps in the backup that already exist here (same id). Restoring them needs an explicit choice. */
  conflicts: BackupConflict[];
  /** Drawings in the backup that already exist here. */
  drawingConflicts: number;
  /** Items that failed validation and will be skipped. */
  skipped: { apps: number; versions: number; records: number; drawings: number; files: number };
}

export interface BackupImportSummary extends ImportSummary {
  replacedApps: number;
  /** Apps left as they were because the person chose to keep the copy on this device. */
  keptLocalApps: number;
  drawings: number;
  settingsApplied: boolean;
}

export interface ImportOptions {
  /** true: replace local apps that are also in the backup. false: keep the local ones. */
  overwrite?: boolean;
  /** Bring back preferences (access modes, language, theme, voice). Default true when included. */
  restoreSettings?: boolean;
  /** Restore only these apps from the backup (docs/14 §15.5). Default: all. */
  appIds?: string[];
}

export interface ExportOptions {
  /** Back up only these apps (docs/11 §12.2). Default: all. Drawings are always included. */
  appIds?: string[];
  /** Include preferences. Default true. */
  includeSettings?: boolean;
}

export interface KalamBackupService extends BackupService {
  exportEncrypted(passphrase: string, opts?: ExportOptions): Promise<{ bytes: Uint8Array; manifest: BackupManifest }>;
  preview(bytes: Uint8Array, passphrase: string): Promise<BackupPreview>;
  /**
   * `overwrite: true` replaces local apps that are also in the backup, `false` keeps the local ones.
   * When such conflicts exist and `overwrite` is not given, nothing is written and a
   * `BackupConflictError` lists them (docs/14 §15.6: never overwrite silently).
   */
  importEncrypted(bytes: Uint8Array, passphrase: string, opts?: ImportOptions): Promise<BackupImportSummary>;
}
