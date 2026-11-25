/**
 * Published-spec encoding (docs/12 §16.2): the exact JSON text is hashed (SHA-256, hex) and stored
 * gzip-compressed as base64 (`specGz`). Pure TypeScript: fflate + @noble/hashes run the same on
 * web, Android (Hermes has no CompressionStream) and Node.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { base64ToBytes, bytesToBase64 } from '../backup/base64';

/** Lowercase hex SHA-256 of the UTF-8 text. */
export function sha256Hex(text: string): string {
  return bytesToHex(sha256(strToU8(text)));
}

/** gzip (deterministic: mtime 0) → base64. */
export function gzipToBase64(text: string): string {
  return bytesToBase64(gzipSync(strToU8(text), { level: 9, mtime: 0 }));
}

/**
 * base64 → gunzip → text, never inflating more than `maxBytes` (zip-bomb safe): the gzip size
 * trailer is checked first and the output buffer is fixed, so a lying trailer only truncates,
 * which the caller's hash check then rejects.
 */
export function gunzipFromBase64(b64: string, maxBytes: number): string {
  const bytes = base64ToBytes(b64);
  if (bytes.length < 18) throw new Error('Not gzip data');
  const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 4, true);
  if (declared > maxBytes) throw new Error('Compressed spec is too large');
  const out = gunzipSync(bytes, { out: new Uint8Array(maxBytes + 1) });
  if (out.length > maxBytes) throw new Error('Compressed spec is too large');
  return strFromU8(out);
}
