/** Duplicate attachment detection (docs/06 §18.7, §17.1 "avoid duplicate processing"). */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { MediaAttachment } from './types';

/** Bytes hashed from the start of a file. */
export const FINGERPRINT_BYTES = 1024 * 1024;

/**
 * Fingerprint = SHA-256 of the first MiB plus the size. ponytail: two different files that share their
 * first MiB and exact size would match; for photos, recordings and videos that does not happen in
 * practice. Hash the whole file if that ever matters.
 */
export function fingerprint(head: Uint8Array, sizeBytes: number): string {
  const part = head.length > FINGERPRINT_BYTES ? head.subarray(0, FINGERPRINT_BYTES) : head;
  return `${bytesToHex(sha256(part)).slice(0, 40)}:${sizeBytes}`;
}

/** The attachment already in the session with the same content, if any. */
export function findDuplicate(hash: string, attachments: readonly MediaAttachment[], exceptId?: string): MediaAttachment | undefined {
  return attachments.find((a) => a.id !== exceptId && a.contentHash === hash && a.status !== 'failed');
}
