/**
 * Invite codes. A code is `<sharedId or teamId>.<secret>`: the id says what it opens, the secret
 * (20 base32 characters, 100 bits) proves the holder was invited. Only the SHA-256 of the secret is
 * stored, so reading the invite list never reveals a working code. kalamCollabJoin repeats this parsing.
 */
import { sha256Hex } from '../bazaar/codec';
import { SHARED_ID_RE, TEAM_ID_RE, type Target } from './model';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const SECRET_LENGTH = 20;
const TOKEN_RE = /^([st][a-z0-9]{19})\.([A-Z2-7]{20})$/;

/** Random base32 text from secure random bytes (one byte per character, 5 bits used). */
export function randomBase32(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => B32[b & 31]).join('');
}

export function makeToken(target: Target, secret: string): string {
  return `${target.id}.${secret}`;
}

/** Accepts the code alone or a whole invite link that carries it, with stray spaces from copying. */
export function parseToken(input: string): { target: Target; secret: string } | undefined {
  const text = input.trim();
  const fromLink = /[?&#]c=([^&#\s]+)/.exec(text)?.[1];
  let candidate = fromLink ? decodeURIComponent(fromLink) : text;
  candidate = candidate.replace(/\s+/g, '');
  const m = TOKEN_RE.exec(candidate);
  if (!m?.[1] || !m[2]) return undefined;
  const id = m[1];
  if (SHARED_ID_RE.test(id)) return { target: { kind: 'app', id }, secret: m[2] };
  if (TEAM_ID_RE.test(id)) return { target: { kind: 'team', id }, secret: m[2] };
  return undefined;
}

export const secretHash = (secret: string): string => sha256Hex(secret);

/** New shared-app or team id from secure random bytes (19 of [a-z0-9]). */
export function newCloudId(prefix: 's' | 't', bytes: Uint8Array): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return prefix + Array.from(bytes.slice(0, 19), (b) => alphabet[b % 36]).join('');
}
