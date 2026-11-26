/**
 * "My apps in my account" data model (docs/11 §9, §12; docs/14 §15). Pure: no I/O.
 *
 * Opt-in per device. Firestore database `kalam` keeps, under users/{uid}/:
 * - apps/{appId}: the app design (gzip+base64, at most 100 KB of JSON) with name, icon, version,
 *   updatedAt and a `deleted` tombstone. Designs only, never records.
 * - account/records: pointer to the newest complete encrypted records backup (choice "apps and records").
 * - backups/records_{set}_{part}: that backup in chunks under 900 KB, in the N5 envelope format
 *   (AES-256-GCM + PBKDF2), written to B1's encrypted backups area. Never plaintext records.
 */
import { z } from 'zod';

export const SYNC_CHOICES = ['apps', 'apps_records', 'off'] as const;
export type SyncChoice = (typeof SYNC_CHOICES)[number];

export const ACCOUNT_LIMITS = {
  /** Same cap as every KalamSpec (docs/11 §11.1); the gzip+base64 text stays under this. */
  specGzChars: 140_000,
  /** Firestore documents are at most 1 MiB; chunks stay well under 900 KB (docs/11 §12.5). */
  chunkChars: 880_000,
  /** 40 chunks is about 35 MB of encrypted records. Larger backups are refused with a clear message. */
  maxParts: 40,
  /** Apps read per page when pulling changes. */
  pageSize: 200,
} as const;

export const APP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const SET_ID_RE = /^[a-z0-9]{12}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const iconSchema = z.object({
  glyph: z.string().min(1).max(40),
  background: z.string().regex(HEX_COLOR).optional(),
  foreground: z.string().regex(HEX_COLOR).optional(),
});

/** Where a Bazaar install came from, so update checks keep working on the new device. */
export const bazaarSourceSchema = z.object({
  listingId: z.string().regex(/^l[a-z0-9]{19}$/),
  specVersion: z.number().int().min(1),
  specHash: z.string().regex(HASH_RE),
});
export type BazaarSource = z.infer<typeof bazaarSourceSchema>;

/** One app document as read back from the account. Untrusted: parsed, and the spec is validated on unpack. */
export const remoteAppSchema = z
  .object({
    id: z.string().regex(APP_ID_RE),
    name: z.string().max(60),
    icon: iconSchema.nullable(),
    version: z.number().int().min(0),
    specGz: z.string().min(24).max(ACCOUNT_LIMITS.specGzChars).nullable(),
    specHash: z.string().regex(HASH_RE).nullable(),
    /** Device clock of the change, ms. Decides last writer wins. */
    updatedAt: z.number().int().nonnegative(),
    /** Server time of the write, ms. Only used to pull what changed since last time. */
    syncedAt: z.number().int().nonnegative(),
    deleted: z.boolean(),
    route: z.string().max(40),
    bazaar: bazaarSourceSchema.nullable(),
  })
  .refine((d) => (d.deleted ? d.specGz === null && d.specHash === null : d.specGz !== null && d.specHash !== null));
export type RemoteApp = z.infer<typeof remoteAppSchema>;
export type AppDocInput = Omit<RemoteApp, 'id' | 'syncedAt'>;

/** Pointer to the newest complete records backup. Written after every part is stored. */
export const recordsPointerSchema = z.object({
  set: z.string().regex(SET_ID_RE),
  parts: z.number().int().min(1).max(ACCOUNT_LIMITS.maxParts),
  chars: z.number().int().min(1),
  sha256: z.string().regex(HASH_RE),
  /** Key salt of the passphrase in use (base64). Another value means the passphrase changed elsewhere. */
  salt: z.string().min(16).max(64),
  appCount: z.number().int().nonnegative(),
  recordCount: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type RecordsPointer = z.infer<typeof recordsPointerSchema>;
export type RecordsPointerInput = Omit<RecordsPointer, 'updatedAt'>;

/** What this device last agreed with the account about one app. */
export const appSyncStateSchema = z.object({
  /** designHash of the local design at the last agreement. */
  localHash: z.string(),
  /** specHash of the account copy at the last agreement (null for a tombstone). */
  remoteHash: z.string().nullable(),
  remoteUpdatedAt: z.number(),
  deleted: z.boolean(),
});
export type AppSyncState = z.infer<typeof appSyncStateSchema>;

/** Per account, on this device. The key never leaves the device; the passphrase is never stored. */
export const accountLocalSchema = z.object({
  /** Undefined until the person answered the question (nothing is uploaded before that). */
  choice: z.enum(SYNC_CHOICES).optional(),
  cursor: z.number().default(0),
  apps: z.record(z.string(), appSyncStateSchema).default({}),
  lastSyncAt: z.number().optional(),
  records: z
    .object({
      /** AES key derived on this device from the passphrase (base64). Deleted on sign-out and when turned off. */
      key: z.string(),
      salt: z.string(),
      iterations: z.number().int(),
      lastSet: z.string().optional(),
      lastBackupAt: z.number().optional(),
      lastChecksum: z.string().optional(),
    })
    .optional(),
});
export type AccountLocal = z.infer<typeof accountLocalSchema>;
export const emptyLocal = (): AccountLocal => ({ cursor: 0, apps: {} });

/** Local state per account. Rows are validated on the way out; a damaged row reads as empty, never as a delete. */
export interface AccountSyncStore {
  get(uid: string): Promise<AccountLocal>;
  put(uid: string, data: AccountLocal): Promise<void>;
}

/** Firestore, as seen by the engine. Methods throw on failure; `code` carries the Firestore error code. */
export interface AccountRemote {
  /** App documents written at or after `since` (server ms), oldest first. */
  pullApps(uid: string, since: number): Promise<RemoteApp[]>;
  putApp(uid: string, appId: string, doc: AppDocInput): Promise<void>;
  deleteApp(uid: string, appId: string): Promise<void>;
  getRecordsPointer(uid: string): Promise<RecordsPointer | null>;
  putRecordsPointer(uid: string, pointer: RecordsPointerInput): Promise<void>;
  deleteRecordsPointer(uid: string): Promise<void>;
  putRecordsPart(uid: string, set: string, part: number, parts: number, text: string): Promise<void>;
  /** null when the part is missing (an interrupted upload). */
  getRecordsPart(uid: string, set: string, part: number): Promise<string | null>;
  deleteRecordsPart(uid: string, set: string, part: number): Promise<void>;
}

export type SyncPhase = 'signed_out' | 'off' | 'idle' | 'syncing' | 'offline' | 'error';
export type SyncProblem =
  | 'signed_out' | 'offline' | 'denied' | 'not_set_up' | 'unavailable' | 'spec_too_big' | 'needs_passphrase' | 'passphrase_changed'
  | 'records_too_big' | 'wrong_passphrase' | 'weak_passphrase' | 'guest';

export interface AccountSyncStatus {
  phase: SyncPhase;
  choice?: SyncChoice;
  /** True once a non-guest account is signed in and has not answered the question on this device. */
  needsPrompt: boolean;
  lastSyncAt?: number;
  appsInAccount: number;
  /** Local changes not yet in the account (offline queue). */
  pending: number;
  recordsBackupAt?: number;
  /** After records were brought back on this device: apps restored, and apps whose own records were kept. */
  restored?: { apps: number; kept: number };
  problem?: SyncProblem;
}

/** Firestore error code → what the person is told. */
export function problemOf(e: unknown): SyncProblem {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (code === 'permission-denied' || code === 'unauthenticated') return 'denied';
  if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'offline') return 'offline';
  if (code === 'not_set_up') return 'not_set_up';
  return 'unavailable';
}
