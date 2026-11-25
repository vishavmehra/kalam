/** Standard base64 (RFC 4648) for Uint8Array. Hermes has no Buffer, so this stays dependency-free. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    chunk +=
      ALPHABET[(n >> 18) & 63] +
      ALPHABET[(n >> 12) & 63] +
      (i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=') +
      (i + 2 < bytes.length ? ALPHABET[n & 63] : '=');
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }
  parts.push(chunk);
  return parts.join('');
}

/** Decodes strict base64. Throws on any character outside the alphabet or bad padding. */
export function base64ToBytes(text: string): Uint8Array {
  if (text.length % 4 !== 0 || !BASE64_RE.test(text)) throw new Error('Invalid base64');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n =
      (LOOKUP[text.charCodeAt(i)] << 18) |
      (LOOKUP[text.charCodeAt(i + 1)] << 12) |
      ((text[i + 2] === '=' ? 0 : LOOKUP[text.charCodeAt(i + 2)]) << 6) |
      (text[i + 3] === '=' ? 0 : LOOKUP[text.charCodeAt(i + 3)]);
    out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** Decoded size of a base64 string without decoding it. */
export function base64ByteLength(text: string): number {
  if (!text) return 0;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return Math.floor((text.length * 3) / 4) - padding;
}
