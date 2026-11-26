/**
 * Configurable media limits (docs/06 §9.2, §9.9, §16.2), validated before any processing.
 * Video seconds and frames match features/input/media-math.ts (60 s, 6 frames).
 */
import { z } from 'zod';
import { MediaError } from './errors';
import type { MediaType } from './types';

const MB = 1024 * 1024;

export interface MediaLimits {
  image: { maxBytes: number; maxSide: number; minSide: number };
  audio: { maxBytes: number; maxDurationSec: number };
  video: { maxBytes: number; maxDurationSec: number; maxFrames: number };
}

export const DEFAULT_MEDIA_LIMITS: MediaLimits = {
  image: { maxBytes: 20 * MB, maxSide: 12_000, minSide: 16 },
  audio: { maxBytes: 25 * MB, maxDurationSec: 10 * 60 },
  video: { maxBytes: 100 * MB, maxDurationSec: 60, maxFrames: 6 },
};

const pos = z.number().finite().positive();
const overridesSchema = z
  .object({
    image: z.object({ maxBytes: pos, maxSide: pos, minSide: pos }).partial(),
    audio: z.object({ maxBytes: pos, maxDurationSec: pos }).partial(),
    video: z.object({ maxBytes: pos, maxDurationSec: pos, maxFrames: z.number().int().min(1).max(12) }).partial(),
  })
  .partial()
  .strict();

export type MediaLimitOverrides = z.infer<typeof overridesSchema>;

/** Merges overrides over the defaults. Invalid overrides are rejected, never half applied. */
export function resolveLimits(overrides?: unknown): MediaLimits {
  if (overrides === undefined) return DEFAULT_MEDIA_LIMITS;
  const o = overridesSchema.parse(overrides);
  return {
    image: { ...DEFAULT_MEDIA_LIMITS.image, ...o.image },
    audio: { ...DEFAULT_MEDIA_LIMITS.audio, ...o.audio },
    video: { ...DEFAULT_MEDIA_LIMITS.video, ...o.video },
  };
}

export interface MediaFacts {
  sizeBytes?: number;
  durationSec?: number;
  width?: number;
  height?: number;
}

/** The first limit `facts` breaks, or undefined. Unknown facts are not held against the file. */
export function checkLimits(type: MediaType, facts: MediaFacts, limits: MediaLimits = DEFAULT_MEDIA_LIMITS): MediaError | undefined {
  const l = limits[type] as { maxBytes: number; maxDurationSec?: number; maxSide?: number; minSide?: number };
  if (facts.sizeBytes !== undefined) {
    if (facts.sizeBytes <= 0) return new MediaError('FILE_CORRUPTED', { type });
    if (facts.sizeBytes > l.maxBytes) return new MediaError('FILE_TOO_LARGE', { type, sizeBytes: facts.sizeBytes, limitBytes: l.maxBytes });
  }
  // Half a second of slack: containers round durations up.
  if (l.maxDurationSec !== undefined && facts.durationSec !== undefined && facts.durationSec > l.maxDurationSec + 0.5) {
    return new MediaError('FILE_TOO_LARGE', { type, durationSec: facts.durationSec, limitSec: l.maxDurationSec });
  }
  if (l.maxSide !== undefined && facts.width !== undefined && facts.height !== undefined) {
    if (Math.max(facts.width, facts.height) > l.maxSide) return new MediaError('FILE_TOO_LARGE', { type });
    if (Math.min(facts.width, facts.height) < (l.minSide ?? 1)) return new MediaError('FILE_CORRUPTED', { type });
  }
  return undefined;
}
