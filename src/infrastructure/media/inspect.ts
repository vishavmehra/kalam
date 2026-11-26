/**
 * Validation every file goes through before it joins a session (docs/06 §5.1 steps 3-4, §7.2, §16.2):
 * content sniffing, size, duration and dimension limits, and a fingerprint for duplicate detection.
 */
import { Platform } from 'react-native';
import { FINGERPRINT_BYTES, fingerprint } from '@/core/media/hash';
import { DEFAULT_MEDIA_LIMITS, type MediaLimits } from '@/core/media/limits';
import { sanitizeFileName, validateMedia } from '@/core/media/sniff';
import type { MediaType } from '@/core/media/types';
import { MediaError, toMediaError } from '@/core/media/errors';
import { timings } from '@/core/observability';
import { readHead, sizeOf } from './file-bytes';
import { platformName, type MediaSource } from './source';

export interface Inspected {
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  /** First bytes (up to 1 MiB), for audio header details. */
  head: Uint8Array;
  name?: string;
}

/** Throws a MediaError with a plain message when the file cannot be used. Timed as `media_validate` (docs/06 §17.3). */
export const inspectMedia = (...args: Parameters<typeof inspect>): Promise<Inspected> => timings.time('media_validate', () => inspect(...args));

async function inspect(src: MediaSource, type: MediaType, fallbackName: string, limits: MediaLimits = DEFAULT_MEDIA_LIMITS): Promise<Inspected> {
  let head: Uint8Array;
  let sizeBytes: number;
  try {
    sizeBytes = await sizeOf(src);
    // Refuse oversized files before reading anything.
    if (sizeBytes > limits[type].maxBytes) throw new MediaError('FILE_TOO_LARGE', { type, sizeBytes, limitBytes: limits[type].maxBytes });
    head = await readHead(src, FINGERPRINT_BYTES);
  } catch (e) {
    throw toMediaError(e, 'FILE_CORRUPTED');
  }
  const r = validateMedia(
    {
      type, head, sizeBytes, platform: platformName(Platform.OS),
      ...(src.durationSec ? { durationSec: src.durationSec } : {}),
      ...(src.width && src.height ? { width: src.width, height: src.height } : {}),
    },
    limits,
  );
  if (!r.ok) throw r.error;
  const name = sanitizeFileName(src.name, fallbackName);
  return { mimeType: r.mime, sizeBytes, contentHash: fingerprint(head, sizeBytes), head, ...(name ? { name } : {}) };
}
