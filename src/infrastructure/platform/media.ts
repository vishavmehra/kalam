/**
 * Type shim: Metro resolves `media.web.ts` / `media.native.ts`; tsc resolves this file and
 * type-checks against the native implementation.
 */
import type { NormalizedImage } from '@/core/contracts';

export interface KeyframeResult {
  durationSec: number;
  frames: NormalizedImage[];
  /** Frames dropped as near-duplicates. */
  dropped: number;
}

export { extractKeyframes, VideoTooLongError } from './media.native';
