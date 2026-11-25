/**
 * Encrypted backup and restore (docs/11 §12, docs/04 §17, docs/14 §15). Everything runs on this device:
 * the passphrase and key never leave the function that uses them, and only ciphertext is returned.
 *
 * Restore order (docs/11 §12.7): read envelope → derive key → authenticate + decrypt → checksum →
 * validate structure, specs (claims reset, R-09), history, drawings, files, settings → show what will
 * change → write everything in ONE transaction. A wrong passphrase or a changed file writes nothing.
 */
import { strToU8 } from 'fflate';
import { DEFAULT_SETTINGS, DEFAULT_SPEECH, type BackupManifest, type KalamDatabase, type KalamSettings } from '../contracts';
import { bytesToBase64 } from './base64';
import {
  decrypt, defaultRandomBytes, deriveKey, encrypt, KDF_ITERATIONS, MIN_KDF_ITERATIONS, MIN_PASSPHRASE_LENGTH,
  NONCE_BYTES, normalizePassphrase, SALT_BYTES, secureRandom, sha256Hex, wipe, type RandomBytes,
} from './crypto';
import { encodeEnvelope, decodeEnvelope, ENVELOPE_FORMAT, ENVELOPE_VERSION, headerAad, type EnvelopeHeader } from './envelope';
import { BackupConflictError, BackupError, type BackupConflict } from './errors';
import { packPayload, unpackPayload, validatePayload, type ValidatedBackup } from './payload';
import type { ImportedSettings } from './schemas';
import type {
  BackupData, BackupImportSummary, BackupPreview, BackupStore, ExportOptions, ImportOptions, KalamBackupService,
} from './types';

/** Keeps only the chosen apps and everything that belongs to them; drawings and their files stay. */
function onlyApps(data: BackupData, appIds: ReadonlySet<string>, drawingIds: ReadonlySet<string>): BackupData {
  return {
    ...data,
    apps: data.apps.filter((a) => appIds.has(a.id)),
    versions: data.versions.filter((v) => appIds.has(v.appId)),
    records: data.records.filter((r) => appIds.has(r.appId)),
    state: data.state.filter((s) => appIds.has(s.appId)),
    drawings: data.drawings.filter((d) => drawingIds.has(d.id)),
    blobs: data.blobs.filter((b) => !!b.ownerId && (appIds.has(b.ownerId) || drawingIds.has(b.ownerId))),
  };
}

export interface BackupServiceDeps {
  db: KalamDatabase & BackupStore;
  /** Secure random source. Defaults to crypto.getRandomValues; Android passes expo-crypto. */
  randomBytes?: RandomBytes;
  now?: () => number;
  /** PBKDF2 work factor for new backups. Production keeps the default. */
  iterations?: number;
  /** Lowest work factor accepted when opening a file. Production keeps the default. */
  minIterations?: number;
}

/** Decrypted files are kept briefly so preview → restore needs one key derivation, not two. */
const OPENED_CACHE_MS = 10 * 60 * 1000;

export function passphraseLength(passphrase: string): number {
  return Array.from(normalizePassphrase(passphrase)).length;
}

/** Imported preferences merged into the local ones. Speech keeps the local `keepRecordings`. */
export function mergeImportedSettings(local: KalamSettings, imported: ImportedSettings): Partial<KalamSettings> {
  const patch: Partial<KalamSettings> = {};
  if (imported.accessModes) patch.accessModes = { ...local.accessModes, ...imported.accessModes };
  if (imported.language) patch.language = imported.language;
  if (imported.colorScheme) patch.colorScheme = imported.colorScheme;
  if (imported.reducedMotion) patch.reducedMotion = imported.reducedMotion;
  if (imported.newAppLanguage) patch.newAppLanguage = imported.newAppLanguage;
  if (imported.speech) {
    const base = local.speech ?? DEFAULT_SPEECH;
    patch.speech = { ...base, ...imported.speech, keepRecordings: base.keepRecordings };
  }
  return patch;
}

export function createBackupService(deps: BackupServiceDeps): KalamBackupService {
  const { db } = deps;
  const random = deps.randomBytes ?? defaultRandomBytes;
  const now = deps.now ?? Date.now;
  const iterations = deps.iterations ?? KDF_ITERATIONS;
  const minIterations = deps.minIterations ?? MIN_KDF_ITERATIONS;
  let digestSalt: Uint8Array | undefined;
  let opened: { bytes: Uint8Array; digest: string; at: number; manifest: BackupManifest; backup: ValidatedBackup } | undefined;

  /** Salted digest, so the cache never holds the passphrase itself. Undefined when random is unavailable. */
  function passDigest(passphrase: string): string | undefined {
    try {
      digestSalt ??= secureRandom(random, 16);
    } catch {
      return undefined;
    }
    const pass = strToU8(normalizePassphrase(passphrase));
    const joined = new Uint8Array(digestSalt.length + pass.length);
    joined.set(digestSalt);
    joined.set(pass, digestSalt.length);
    return sha256Hex(joined);
  }

  async function open(bytes: Uint8Array, passphrase: string) {
    const digest = passDigest(passphrase);
    if (opened && digest && opened.bytes === bytes && opened.digest === digest && now() - opened.at < OPENED_CACHE_MS) {
      return opened;
    }
    opened = undefined;
    const envelope = decodeEnvelope(bytes, { minIterations });
    const key = await deriveKey(passphrase, envelope.salt, envelope.header.iterations);
    let plaintext: Uint8Array;
    try {
      plaintext = decrypt(key, envelope.nonce, envelope.ciphertext, headerAad(envelope.header));
    } finally {
      wipe(key);
    }
    let manifest: BackupManifest;
    let backup: ValidatedBackup;
    try {
      const unpacked = unpackPayload(plaintext);
      manifest = unpacked.manifest;
      backup = validatePayload(unpacked.payload, now());
    } catch (error) {
      // Untrusted content must only ever fail with a clear, typed error.
      throw error instanceof BackupError ? error : new BackupError('damaged');
    }
    const result = { bytes, digest: digest ?? '', at: now(), manifest, backup };
    if (digest) opened = result;
    return result;
  }

  async function conflictsWith(backup: ValidatedBackup) {
    const localApps = new Map((await db.apps.list()).map((a) => [a.id, a]));
    const localDrawings = new Set((await db.drawings.list()).map((d) => d.id));
    const conflicts: BackupConflict[] = [];
    for (const app of backup.data.apps) {
      const local = localApps.get(app.id);
      if (local) conflicts.push({ id: app.id, name: app.spec.name, localName: local.spec.name });
    }
    return { conflicts, localDrawings };
  }

  return {
    async exportEncrypted(passphrase, opts: ExportOptions = {}) {
      if (passphraseLength(passphrase) < MIN_PASSPHRASE_LENGTH) throw new BackupError('weak_passphrase');
      const salt = secureRandom(random, SALT_BYTES);
      const nonce = secureRandom(random, NONCE_BYTES);
      const all = await db.readBackupData();
      let data = opts.appIds ? onlyApps(all, new Set(opts.appIds), new Set(all.drawings.map((d) => d.id))) : all;
      if (opts.includeSettings === false) {
        const { settings: _left, ...rest } = data;
        data = rest;
      }
      const { plaintext, manifest } = packPayload(data, now());
      const header: EnvelopeHeader = {
        format: ENVELOPE_FORMAT, formatVersion: ENVELOPE_VERSION, algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA256',
        iterations, salt: bytesToBase64(salt), iv: bytesToBase64(nonce), compression: 'gzip',
      };
      const key = await deriveKey(passphrase, salt, iterations);
      let ciphertext: Uint8Array;
      try {
        ciphertext = encrypt(key, nonce, plaintext, headerAad(header));
      } finally {
        wipe(key);
      }
      return { bytes: encodeEnvelope({ ...header, ciphertext: bytesToBase64(ciphertext) }), manifest };
    },

    async preview(bytes, passphrase): Promise<BackupPreview> {
      const { manifest, backup } = await open(bytes, passphrase);
      const { conflicts, localDrawings } = await conflictsWith(backup);
      const recordsByApp = new Map<string, number>();
      for (const r of backup.data.records) recordsByApp.set(r.appId, (recordsByApp.get(r.appId) ?? 0) + 1);
      const versionsByApp = new Map<string, number>();
      for (const v of backup.data.versions) versionsByApp.set(v.appId, (versionsByApp.get(v.appId) ?? 0) + 1);
      return {
        ...manifest,
        apps: backup.data.apps.map((a) => ({
          id: a.id, name: a.spec.name, records: recordsByApp.get(a.id) ?? 0, versions: versionsByApp.get(a.id) ?? 0,
        })),
        drawingCount: backup.data.drawings.length,
        settingsIncluded: !!backup.settings,
        conflicts,
        drawingConflicts: backup.data.drawings.filter((d) => localDrawings.has(d.id)).length,
        skipped: {
          apps: backup.skipped.apps, versions: backup.skipped.versions, records: backup.skipped.records,
          drawings: backup.skipped.drawings, files: backup.skipped.files,
        },
      };
    },

    async importEncrypted(bytes, passphrase, opts: ImportOptions = {}): Promise<BackupImportSummary> {
      const file = await open(bytes, passphrase);
      const chosen = opts.appIds ? new Set(opts.appIds) : undefined;
      const backup: ValidatedBackup = chosen
        ? { ...file.backup, data: onlyApps(file.backup.data, chosen, new Set(file.backup.data.drawings.map((d) => d.id))) }
        : file.backup;
      const { conflicts, localDrawings } = await conflictsWith(backup);
      if (conflicts.length && opts.overwrite === undefined) throw new BackupConflictError(conflicts);
      const overwrite = opts.overwrite === true;
      const kept = new Set(overwrite ? [] : conflicts.map((c) => c.id));
      const apps = backup.data.apps.filter((a) => !kept.has(a.id));
      const appIds = new Set(apps.map((a) => a.id));
      const drawings = backup.data.drawings.filter((d) => overwrite || !localDrawings.has(d.id));
      const drawingIds = new Set(drawings.map((d) => d.id));
      const data: BackupData = {
        apps,
        versions: backup.data.versions.filter((v) => appIds.has(v.appId)),
        records: backup.data.records.filter((r) => appIds.has(r.appId)),
        state: backup.data.state.filter((s) => appIds.has(s.appId)),
        drawings,
        blobs: backup.data.blobs.filter((b) => !!b.ownerId && (appIds.has(b.ownerId) || drawingIds.has(b.ownerId))),
      };
      const restoreSettings = (opts.restoreSettings ?? true) && !!backup.settings;
      const settings = restoreSettings && backup.settings
        ? mergeImportedSettings({ ...DEFAULT_SETTINGS, ...(await db.settings.get()) }, backup.settings)
        : undefined;
      const written = await db.writeBackupData(data, {
        replaceAppIds: overwrite ? conflicts.map((c) => c.id) : [],
        replaceDrawingIds: overwrite ? drawings.filter((d) => localDrawings.has(d.id)).map((d) => d.id) : [],
        ...(settings ? { settings } : {}),
      });
      opened = undefined;
      return {
        apps: apps.length,
        records: written.records,
        skippedApps: backup.skipped.apps,
        skippedRecords: backup.skipped.records + written.skippedRecords,
        skippedState: backup.skipped.state + written.skippedState,
        replacedApps: overwrite ? conflicts.length : 0,
        keptLocalApps: kept.size,
        drawings: drawings.length,
        settingsApplied: !!settings,
      };
    },
  };
}
