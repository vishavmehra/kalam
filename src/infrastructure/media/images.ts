/**
 * Picture variants (docs/06 §7.3-7.4): the compiler-ready copy (≤1280 px JPEG, EXIF and location
 * removed, made by platform/image.normalizeImageUri), a 256 px display thumbnail, and a rotated copy
 * made from the original so the original itself is never overwritten. Shared by web, Android and iOS.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { NormalizedImage } from '@/core/contracts';
import { MediaError } from '@/core/media/errors';
import { timings } from '@/core/observability';
import { normalizeImageUri } from '@/infrastructure/platform/image';

export const THUMB_SIDE = 256;

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'AbortError';
  }
}
export const isCancelled = (e: unknown) => e instanceof Error && e.name === 'AbortError';
const check = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new CancelledError();
};

export interface PreparedImage {
  image: NormalizedImage;
  thumbnail: { base64: string; width: number; height: number };
}

/** Compiler copy plus thumbnail. Decoding failures become IMAGE_DECODE_FAILED. */
export async function prepareImage(uri: string, source: NormalizedImage['source'], opts: { label?: string; signal?: AbortSignal } = {}): Promise<PreparedImage> {
  check(opts.signal);
  let image: NormalizedImage;
  try {
    image = await timings.time('media_preprocess', () => normalizeImageUri(uri, source, opts.label));
  } catch {
    throw new MediaError('IMAGE_DECODE_FAILED');
  }
  check(opts.signal);
  return { image, thumbnail: await timings.time('thumbnail', () => makeThumbnail(`data:image/jpeg;base64,${image.base64}`, uri)) };
}

/** 256 px JPEG; tries the data copy first, then the original uri (native loaders differ). */
export async function makeThumbnail(...uris: string[]): Promise<PreparedImage['thumbnail']> {
  for (const uri of uris) {
    try {
      const loaded = await ImageManipulator.manipulate(uri).renderAsync();
      const k = THUMB_SIDE / Math.max(loaded.width, loaded.height, 1);
      const ref = k < 1
        ? await ImageManipulator.manipulate(uri).resize({ width: Math.max(1, Math.round(loaded.width * k)), height: Math.max(1, Math.round(loaded.height * k)) }).renderAsync()
        : loaded;
      const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
      if (saved.base64) return { base64: saved.base64, width: saved.width, height: saved.height };
    } catch {
      // try the next source
    }
  }
  throw new MediaError('IMAGE_DECODE_FAILED');
}

/**
 * A new compiler copy turned by `degrees`, made from `uri` (the original where available). It gets a
 * new id, so the creation draft stores the turned picture instead of reusing the old file.
 */
export async function rotatedImage(uri: string, degrees: number, label?: string): Promise<PreparedImage> {
  try {
    const ref = await ImageManipulator.manipulate(uri).rotate(degrees).renderAsync();
    const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
    return await prepareImage(saved.uri, 'photo', label ? { label } : {});
  } catch (e) {
    throw e instanceof MediaError ? e : new MediaError('IMAGE_DECODE_FAILED');
  }
}
