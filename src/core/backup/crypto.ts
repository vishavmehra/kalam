/**
 * Backup cryptography (docs/11 §12.3-12.4). @noble keeps one implementation for Web and Hermes (which
 * has no WebCrypto); the web's native PBKDF2 is used when present because it gives the same bytes faster.
 * - Key: PBKDF2-HMAC-SHA256, random 16-byte salt per backup, 32-byte key (AES-256).
 * - Cipher: AES-256-GCM (@noble), random 12-byte nonce per encryption, 16-byte tag, header bound as AAD.
 * The passphrase and the derived key are never stored, logged or returned.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { BackupError } from './errors';

/**
 * Default PBKDF2 work factor. 310 000 is the OWASP floor for PBKDF2-HMAC-SHA256; pure-JS PBKDF2 on
 * Hermes is the bottleneck, so this is not higher yet. Stored per backup, so it can be raised later
 * without breaking older files. TODO(benchmark): measure on a mid-range Android device (docs/11 §12.4).
 */
export const KDF_ITERATIONS = 310_000;
/** Files asking for fewer iterations are refused (downgrade), more than this would hang the app. */
export const MIN_KDF_ITERATIONS = 310_000;
export const MAX_KDF_ITERATIONS = 5_000_000;
export const SALT_BYTES = 16;
export const NONCE_BYTES = 12;
export const KEY_BYTES = 32;
export const TAG_BYTES = 16;
export const MIN_PASSPHRASE_LENGTH = 10;

export type RandomBytes = (length: number) => Uint8Array;

/** Web and Node: crypto.getRandomValues. Android passes expo-crypto through the service deps. */
export const defaultRandomBytes: RandomBytes = (length) => {
  const source = (globalThis as { crypto?: { getRandomValues?: <T extends Uint8Array>(a: T) => T } }).crypto;
  if (typeof source?.getRandomValues !== 'function') throw new BackupError('random_unavailable');
  return source.getRandomValues(new Uint8Array(length));
};

/** Checked random source: a broken generator must never produce an all-zero salt or nonce. */
export function secureRandom(random: RandomBytes, length: number): Uint8Array {
  const bytes = random(length);
  if (!(bytes instanceof Uint8Array) || bytes.length !== length || bytes.every((b) => b === 0)) {
    throw new BackupError('random_unavailable');
  }
  return bytes;
}

/** Same passphrase typed with composed or decomposed characters must give the same key. */
export function normalizePassphrase(passphrase: string): string {
  return typeof passphrase.normalize === 'function' ? passphrase.normalize('NFC') : passphrase;
}

interface Pbkdf2Subtle {
  importKey(format: 'raw', key: Uint8Array<ArrayBuffer>, alg: 'PBKDF2', extractable: false, usages: ['deriveBits']): Promise<unknown>;
  deriveBits(alg: { name: 'PBKDF2'; hash: 'SHA-256'; salt: Uint8Array<ArrayBuffer>; iterations: number }, key: unknown, length: number): Promise<ArrayBuffer>;
}

/**
 * PBKDF2-HMAC-SHA256 → 32-byte key. Uses the platform's native PBKDF2 when it exists (web), else
 * @noble's (Hermes). Both give the same bytes, so a backup made on one opens on the other. noble's
 * sync variant is used on purpose: its async variant measured ~4x slower; the UI gets one frame first.
 */
export async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number, opts: { native?: boolean } = {}): Promise<Uint8Array> {
  const password = new Uint8Array(utf8ToBytes(normalizePassphrase(passphrase)));
  const subtle = opts.native === false ? undefined : (globalThis as { crypto?: { subtle?: Pbkdf2Subtle } }).crypto?.subtle;
  try {
    if (typeof subtle?.deriveBits === 'function') {
      try {
        const key = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
        const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations }, key, KEY_BYTES * 8);
        return new Uint8Array(bits);
      } catch {
        // Fall through to the JS implementation (e.g. an insecure context without WebCrypto).
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    return pbkdf2(sha256, password, salt, { c: iterations, dkLen: KEY_BYTES });
  } finally {
    wipe(password);
  }
}

export function encrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
  return gcm(key, nonce, aad).encrypt(plaintext);
}

/** Throws `wrong_passphrase_or_damaged` when the tag does not verify (wrong key, changed bytes or header). */
export function decrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array): Uint8Array {
  try {
    return gcm(key, nonce, aad).decrypt(ciphertext);
  } catch {
    throw new BackupError('wrong_passphrase_or_damaged');
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/** Best effort: overwrite key material once it is no longer needed. */
export function wipe(bytes: Uint8Array | undefined): void {
  bytes?.fill(0);
}
