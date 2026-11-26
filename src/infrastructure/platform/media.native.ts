/**
 * Android keyframe extraction (docs/06 §2.4): expo-video-thumbnails grabs evenly spaced frames,
 * each is normalised to a ≤1280px JPEG, and a 32×24 copy is decoded with Skia to compute the
 * luminance hash that drops near-duplicates. The video file stays on the device.
 */
import * as VideoThumbnails from 'expo-video-thumbnails';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import type { NormalizedImage } from '@/core/contracts';
import { dedupeFrames, frameTimestamps, luminanceHash, MAX_VIDEO_SECONDS } from '@/features/input/media-math';
import { normalizeImageUri } from './image';
import type { KeyframeResult } from './media';

export class VideoTooLongError extends Error {
  readonly code = 'video_too_long';
  constructor(public readonly durationSec: number) {
    super(`This video is ${Math.round(durationSec)} seconds long. Choose one that is ${MAX_VIDEO_SECONDS} seconds or shorter.`);
  }
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

async function frameHash(uri: string): Promise<string> {
  const ref = await ImageManipulator.manipulate(uri).resize({ width: 32, height: 24 }).renderAsync();
  const png = await ref.saveAsync({ format: SaveFormat.PNG, base64: true });
  const img = png.base64 ? Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(png.base64)) : null;
  const pixels = img?.readPixels(0, 0, { width: 32, height: 24, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  // Unknown pixels hash uniquely, so such frames are simply never treated as duplicates.
  return pixels ? luminanceHash(pixels, 32, 24) : Math.random().toString(16).slice(2, 18).padEnd(16, '0');
}

export async function extractKeyframes(
  uri: string, opts: { durationSec?: number; signal?: AbortSignal } = {},
): Promise<KeyframeResult> {
  const duration = opts.durationSec ?? 0;
  if (duration > MAX_VIDEO_SECONDS + 0.5) throw new VideoTooLongError(duration);
  // Without a reported duration, probe early timestamps and stop at the first one past the end.
  const times = duration > 0 ? frameTimestamps(duration) : [0.5, 2, 5, 10, 20, 40];
  const frames: Array<NormalizedImage & { hash: string }> = [];
  for (const t of times) {
    if (opts.signal?.aborted) throw new Error('Cancelled');
    let thumb: VideoThumbnails.VideoThumbnailsResult;
    try {
      thumb = await VideoThumbnails.getThumbnailAsync(uri, { time: Math.round(t * 1000), quality: 0.9 });
    } catch (e) {
      if (frames.length) break;
      throw e instanceof Error ? e : new Error('This video could not be read.');
    }
    const image = await normalizeImageUri(thumb.uri, 'video_frame', `Frame at ${fmt(t)}`);
    frames.push({ ...image, hash: await frameHash(thumb.uri) });
  }
  const kept = dedupeFrames(frames);
  return {
    durationSec: duration,
    frames: kept.map(({ hash: _hash, ...f }) => f),
    dropped: frames.length - kept.length,
  };
}
