/**
 * Backup plaintext: `gzip( manifest JSON + "\n" + payload JSON )`. The manifest carries a SHA-256 of
 * the exact payload bytes, checked after decryption (docs/11 §12.7 step 6). Decompression is bounded by
 * the gzip size field, and every item is validated individually so one bad row never sinks a restore.
 */
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { z } from 'zod';
import type { BackupManifest, KalamRecord, StoredApp, StoredBlob } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { base64ByteLength } from './base64';
import { sha256Hex } from './crypto';
import { BackupError } from './errors';
import { rebuildHistory } from './history';
import { validateImportedSpec } from './sanitize';
import {
  blobSchema, drawingSchema, recordShape, settingsImportSchema, stateRowSchema, storedAppShape, type ImportedSettings,
} from './schemas';
import type { BackupData, BackupStateRow } from './types';

export const PAYLOAD_FORMAT = 'kalam-backup-data';
/** Largest decompressed backup Kalam will read into memory. */
export const MAX_PLAINTEXT_BYTES = 160 * 1024 * 1024;

const manifestSchema = z.object({
  format: z.literal('kalam-encrypted-backup'),
  formatVersion: z.literal(1),
  createdAt: z.number().int().nonnegative(),
  appCount: z.number().int().nonnegative(),
  recordCount: z.number().int().nonnegative(),
  includes: z.array(z.enum(['apps', 'versions', 'records', 'state', 'drawings', 'settings'])).max(6),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
});

const payloadSchema = z.object({
  format: z.literal(PAYLOAD_FORMAT),
  formatVersion: z.literal(1),
  apps: z.array(z.unknown()).max(1_000),
  versions: z.array(z.unknown()).max(40_000),
  records: z.array(z.unknown()).max(500_000),
  state: z.array(z.unknown()).max(50_000),
  drawings: z.array(z.unknown()).max(2_000),
  blobs: z.array(z.unknown()).max(10_000),
  settings: z.unknown().optional(),
});

export function buildManifest(data: BackupData, checksum: string, createdAt: number): BackupManifest {
  const includes: BackupManifest['includes'] = ['apps', 'versions', 'records', 'state', 'drawings'];
  if (data.settings) includes.push('settings');
  return {
    format: 'kalam-encrypted-backup', formatVersion: 1, createdAt,
    appCount: data.apps.length, recordCount: data.records.length, includes, checksum,
  };
}

export function packPayload(data: BackupData, createdAt: number): { plaintext: Uint8Array; manifest: BackupManifest } {
  const payload = strToU8(JSON.stringify({ format: PAYLOAD_FORMAT, formatVersion: 1, ...data }));
  const manifest = buildManifest(data, sha256Hex(payload), createdAt);
  const head = strToU8(`${JSON.stringify(manifest)}\n`);
  const joined = new Uint8Array(head.length + payload.length);
  joined.set(head);
  joined.set(payload, head.length);
  return { plaintext: gzipSync(joined, { level: 6 }), manifest };
}

export function unpackPayload(compressed: Uint8Array): { manifest: BackupManifest; payload: unknown } {
  if (compressed.length < 18 || compressed[0] !== 0x1f || compressed[1] !== 0x8b) throw new BackupError('damaged');
  const n = compressed.length;
  // gzip trailer ISIZE: uncompressed length, checked before inflating (decompression-bomb guard).
  const size = (compressed[n - 4] | (compressed[n - 3] << 8) | (compressed[n - 2] << 16) | (compressed[n - 1] << 24)) >>> 0;
  if (size > MAX_PLAINTEXT_BYTES) throw new BackupError('too_large');
  let bytes: Uint8Array;
  try {
    // fflate sizes its output from ISIZE and never grows it; a lying trailer fails the checks below.
    bytes = gunzipSync(compressed);
  } catch {
    throw new BackupError('damaged');
  }
  if (bytes.length !== size) throw new BackupError('damaged');
  const newline = bytes.indexOf(10);
  if (newline <= 0) throw new BackupError('damaged');
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(strFromU8(bytes.subarray(0, newline)));
  } catch {
    throw new BackupError('damaged');
  }
  const manifest = manifestSchema.safeParse(manifestRaw);
  if (!manifest.success) throw new BackupError('damaged');
  const payloadBytes = bytes.subarray(newline + 1);
  if (sha256Hex(payloadBytes) !== manifest.data.checksum) throw new BackupError('damaged');
  try {
    return { manifest: manifest.data, payload: JSON.parse(strFromU8(payloadBytes)) as unknown };
  } catch {
    throw new BackupError('damaged');
  }
}

export interface ValidatedBackup {
  /** Sanitised data ready to write. Record values are checked against their collection by the store. */
  data: BackupData;
  settings?: ImportedSettings;
  skipped: { apps: number; versions: number; records: number; state: number; drawings: number; files: number };
}

/** Turns an untrusted payload into data that is safe to write. Invalid items are counted, not written. */
export function validatePayload(raw: unknown, now: number): ValidatedBackup {
  const version = (raw as { formatVersion?: unknown } | null)?.formatVersion;
  if (typeof version === 'number' && version > 1) throw new BackupError('unsupported_version');
  const envelope = payloadSchema.safeParse(raw);
  if (!envelope.success) throw new BackupError('damaged');
  const p = envelope.data;
  const skipped = { apps: 0, versions: 0, records: 0, state: 0, drawings: 0, files: 0 };

  const apps = new Map<string, StoredApp>();
  for (const item of p.apps) {
    const shape = storedAppShape.safeParse(item);
    const spec: KalamSpec | undefined = shape.success ? validateImportedSpec(shape.data.spec) : undefined;
    if (!shape.success || !spec || apps.has(spec.id)) {
      skipped.apps++;
      continue;
    }
    const { spec: _raw, ...meta } = shape.data;
    apps.set(spec.id, {
      ...meta,
      id: spec.id,
      spec,
      createdAt: meta.createdAt ?? now,
      updatedAt: meta.updatedAt ?? now,
      origin: meta.origin ?? { route: 'import' },
    });
  }

  const rowsByApp = new Map<string, unknown[]>();
  for (const row of p.versions) {
    const appId = (row as { appId?: unknown } | null)?.appId;
    if (typeof appId !== 'string' || !apps.has(appId)) {
      skipped.versions++;
      continue;
    }
    let list = rowsByApp.get(appId);
    if (!list) rowsByApp.set(appId, (list = []));
    list.push(row);
  }
  const versions = [...apps.values()].flatMap((app) => {
    const rebuilt = rebuildHistory(app.id, rowsByApp.get(app.id) ?? [], app.spec, now);
    skipped.versions += rebuilt.skipped;
    return rebuilt.versions;
  });

  const records: KalamRecord[] = [];
  for (const item of p.records) {
    const shape = recordShape.safeParse(item);
    const app = shape.success ? apps.get(shape.data.appId) : undefined;
    if (!shape.success || !app || !Object.prototype.hasOwnProperty.call(app.spec.collections, shape.data.collectionId)) {
      skipped.records++;
      continue;
    }
    const { id, appId, collectionId, createdAt = now, updatedAt = now, values } = shape.data;
    // Values stay untyped until the store validates them against the collection on write.
    records.push({ id, appId, collectionId, createdAt, updatedAt, values: values as KalamRecord['values'] });
  }

  const state: BackupStateRow[] = [];
  for (const item of p.state) {
    const shape = stateRowSchema.safeParse(item);
    if (shape.success && apps.has(shape.data.appId)) state.push(shape.data);
    else skipped.state++;
  }

  const drawings = new Map<string, BackupData['drawings'][number]>();
  for (const item of p.drawings) {
    const shape = drawingSchema.safeParse(item);
    if (shape.success && !drawings.has(shape.data.id)) drawings.set(shape.data.id, shape.data);
    else skipped.drawings++;
  }

  const blobs: StoredBlob[] = [];
  for (const item of p.blobs) {
    const shape = blobSchema.safeParse(item);
    const owner = shape.success ? shape.data.ownerId : undefined;
    if (!shape.success || !owner || !(apps.has(owner) || drawings.has(owner))) {
      skipped.files++;
      continue;
    }
    blobs.push({ ...shape.data, bytes: base64ByteLength(shape.data.base64), createdAt: shape.data.createdAt ?? now });
  }

  const parsedSettings = p.settings === undefined ? undefined : settingsImportSchema.safeParse(p.settings);
  const settings = parsedSettings?.success
    ? (Object.fromEntries(Object.entries(parsedSettings.data).filter(([, v]) => v !== undefined)) as ImportedSettings)
    : undefined;

  return {
    data: { apps: [...apps.values()], versions, records, state, drawings: [...drawings.values()], blobs },
    ...(settings && Object.keys(settings).length ? { settings } : {}),
    skipped,
  };
}
