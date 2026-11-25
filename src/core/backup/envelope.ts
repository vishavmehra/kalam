/**
 * Encrypted backup file format v1 (docs/11 §12.3). A small JSON envelope, UTF-8 encoded:
 *
 *   { format: 'kalam-encrypted-backup', formatVersion: 1, algorithm: 'AES-256-GCM',
 *     kdf: 'PBKDF2-SHA256', iterations, salt, iv, compression: 'gzip', ciphertext }
 *
 * Binary fields are base64. Every header field is bound into the GCM tag as associated data, so
 * changing the version, work factor, salt or nonce makes the file fail to open instead of
 * silently decrypting differently. The ciphertext holds `gzip(manifest JSON + "\n" + payload JSON)`.
 */
import { strFromU8, strToU8 } from 'fflate';
import { z } from 'zod';
import { base64ByteLength, base64ToBytes, BASE64_RE } from './base64';
import { MAX_KDF_ITERATIONS, MIN_KDF_ITERATIONS, NONCE_BYTES, SALT_BYTES, TAG_BYTES } from './crypto';
import { BackupError } from './errors';

export const ENVELOPE_FORMAT = 'kalam-encrypted-backup';
export const ENVELOPE_VERSION = 1;
/** Largest backup file Kalam will try to open (base64 text of the ciphertext). */
export const MAX_BACKUP_FILE_BYTES = 96 * 1024 * 1024;

export interface EnvelopeHeader {
  format: typeof ENVELOPE_FORMAT;
  formatVersion: typeof ENVELOPE_VERSION;
  algorithm: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  compression: 'gzip';
}
export interface Envelope extends EnvelopeHeader {
  ciphertext: string;
}
export interface DecodedEnvelope {
  header: EnvelopeHeader;
  salt: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/** Associated data: the header fields in a fixed order (JSON key order is not part of the format). */
export function headerAad(h: EnvelopeHeader): Uint8Array {
  return strToU8(JSON.stringify([h.format, h.formatVersion, h.algorithm, h.kdf, h.iterations, h.salt, h.iv, h.compression]));
}

export function encodeEnvelope(envelope: Envelope): Uint8Array {
  return strToU8(JSON.stringify(envelope));
}

// One refine that never throws: Zod 4 keeps running refinements after a failed check.
const isBase64 = (s: string) => s.length % 4 === 0 && BASE64_RE.test(s);
const b64 = (exactBytes?: number, minBytes = 0) =>
  z.string().refine((s) => isBase64(s) && (exactBytes === undefined ? base64ByteLength(s) >= minBytes : base64ByteLength(s) === exactBytes));

const headerSchema = z.object({
  format: z.literal(ENVELOPE_FORMAT),
  formatVersion: z.literal(ENVELOPE_VERSION),
  algorithm: z.literal('AES-256-GCM'),
  kdf: z.literal('PBKDF2-SHA256'),
  iterations: z.number().int(),
  salt: b64(SALT_BYTES),
  iv: b64(NONCE_BYTES),
  compression: z.literal('gzip'),
  ciphertext: b64(undefined, TAG_BYTES + 1),
});

/** Parses and checks an encrypted backup file. Throws BackupError with a user-facing message. */
export function decodeEnvelope(
  bytes: Uint8Array,
  limits: { minIterations?: number; maxIterations?: number } = {},
): DecodedEnvelope {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new BackupError('not_a_backup');
  if (bytes.length > MAX_BACKUP_FILE_BYTES) throw new BackupError('too_large');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(bytes));
  } catch {
    throw new BackupError('not_a_backup');
  }
  if (!raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== ENVELOPE_FORMAT) {
    throw new BackupError('not_a_backup');
  }
  const version = (raw as { formatVersion?: unknown }).formatVersion;
  if (typeof version === 'number' && version > ENVELOPE_VERSION) throw new BackupError('unsupported_version');
  const parsed = headerSchema.safeParse(raw);
  if (!parsed.success) {
    // A known format with an unknown cipher or compression is a newer file, not a broken one.
    const alg = (raw as { algorithm?: unknown }).algorithm;
    const kdf = (raw as { kdf?: unknown }).kdf;
    if ((typeof alg === 'string' && alg !== 'AES-256-GCM') || (typeof kdf === 'string' && kdf !== 'PBKDF2-SHA256')) {
      throw new BackupError('unsupported_version');
    }
    throw new BackupError('not_a_backup');
  }
  const { ciphertext, ...header } = parsed.data;
  const min = limits.minIterations ?? MIN_KDF_ITERATIONS;
  const max = limits.maxIterations ?? MAX_KDF_ITERATIONS;
  if (header.iterations < min || header.iterations > max) throw new BackupError('not_a_backup');
  try {
    return { header, salt: base64ToBytes(header.salt), nonce: base64ToBytes(header.iv), ciphertext: base64ToBytes(ciphertext) };
  } catch {
    throw new BackupError('not_a_backup');
  }
}
