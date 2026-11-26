/**
 * Encrypted records backup for the account (choice "apps and records"). Reuses N5's backup format
 * as is (src/core/backup): the plaintext is `packPayload`, the file is the v1 envelope with
 * AES-256-GCM and PBKDF2-SHA256, so any Kalam restore code can open it with the passphrase.
 *
 * One difference: the key is derived once per passphrase and kept on this device, so a backup after
 * each change does not re-run PBKDF2. Every backup still gets a fresh random nonce; the salt is per
 * key version (docs/11 §12.4 allows either). The passphrase itself is never stored or uploaded.
 */
import { strFromU8, strToU8 } from 'fflate';
import { base64ToBytes, bytesToBase64 } from '../backup/base64';
import {
  decrypt, deriveKey, encrypt, KDF_ITERATIONS, MIN_KDF_ITERATIONS, NONCE_BYTES, SALT_BYTES, secureRandom, sha256Hex, wipe,
  type RandomBytes,
} from '../backup/crypto';
import { decodeEnvelope, encodeEnvelope, ENVELOPE_FORMAT, ENVELOPE_VERSION, headerAad, type EnvelopeHeader } from '../backup/envelope';
import { packPayload, unpackPayload, validatePayload, type ValidatedBackup } from '../backup/payload';
import type { BackupData } from '../backup/types';
import { ACCOUNT_LIMITS } from './model';

export interface RecordsKey {
  key: Uint8Array;
  /** base64, as written in the envelope header. */
  salt: string;
  iterations: number;
}

export async function newRecordsKey(passphrase: string, random: RandomBytes, iterations = KDF_ITERATIONS): Promise<RecordsKey> {
  const salt = secureRandom(random, SALT_BYTES);
  return { key: await deriveKey(passphrase, salt, iterations), salt: bytesToBase64(salt), iterations };
}

export interface SealedRecords {
  /** The envelope as ASCII text (JSON with base64 fields), ready to split into chunks. */
  text: string;
  /** SHA-256 of the plaintext payload: equal checksums mean nothing changed since the last backup. */
  checksum: string;
  appCount: number;
  recordCount: number;
}

export function sealRecords(data: BackupData, k: RecordsKey, random: RandomBytes, now: number): SealedRecords {
  const { plaintext, manifest } = packPayload(data, now);
  const nonce = secureRandom(random, NONCE_BYTES);
  const header: EnvelopeHeader = {
    format: ENVELOPE_FORMAT, formatVersion: ENVELOPE_VERSION, algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA256',
    iterations: k.iterations, salt: k.salt, iv: bytesToBase64(nonce), compression: 'gzip',
  };
  const ciphertext = encrypt(k.key, nonce, plaintext, headerAad(header));
  return {
    text: strFromU8(encodeEnvelope({ ...header, ciphertext: bytesToBase64(ciphertext) })),
    checksum: manifest.checksum,
    appCount: manifest.appCount,
    recordCount: manifest.recordCount,
  };
}

/**
 * Opens a records backup. Uses the kept key when it matches the file's salt, else derives one from
 * `passphrase`. Throws BackupError('wrong_passphrase_or_damaged') when neither opens it.
 */
export async function openRecords(
  text: string,
  secret: { passphrase?: string; key?: RecordsKey },
  now: number,
  minIterations = MIN_KDF_ITERATIONS,
): Promise<{ backup: ValidatedBackup; key: RecordsKey }> {
  const envelope = decodeEnvelope(strToU8(text), { minIterations });
  const { salt, iterations } = envelope.header;
  const kept = secret.key && secret.key.salt === salt && secret.key.iterations === iterations ? secret.key : undefined;
  if (!kept && secret.passphrase === undefined) throw new Error('needs_passphrase');
  const key = kept ?? { key: await deriveKey(secret.passphrase ?? '', envelope.salt, iterations), salt, iterations };
  let plaintext: Uint8Array;
  try {
    plaintext = decrypt(key.key, envelope.nonce, envelope.ciphertext, headerAad(envelope.header));
  } catch (e) {
    if (!kept) wipe(key.key);
    throw e;
  }
  const { payload } = unpackPayload(plaintext);
  return { backup: validatePayload(payload, now), key };
}

export function splitChunks(text: string, size: number = ACCOUNT_LIMITS.chunkChars): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [''];
}

export const textHash = (text: string): string => sha256Hex(strToU8(text));

export const keyToBase64 = (k: RecordsKey): string => bytesToBase64(k.key);
export const keyFromBase64 = (b64: string, salt: string, iterations: number): RecordsKey => ({ key: base64ToBytes(b64), salt, iterations });
