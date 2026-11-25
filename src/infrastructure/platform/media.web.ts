/**
 * Web keyframe extraction (docs/06 §2.4): a detached <video> is seeked to evenly spaced times,
 * each frame is drawn to a canvas (≤1280px JPEG q0.8) and hashed from a 32×24 thumbnail so
 * near-duplicate frames are dropped. The video itself never leaves the browser.
 */
import type { NormalizedImage } from '@/core/contracts';
import {
  dedupeFrames, fitWithin, frameTimestamps, JPEG_QUALITY, luminanceHash, MAX_VIDEO_SECONDS, stripDataUrl,
} from '@/features/input/media-math';
import type { KeyframeResult } from './media';

export class VideoTooLongError extends Error {
  constructor(public readonly durationSec: number) {
    super(`This video is ${Math.round(durationSec)} seconds long. Choose one that is ${MAX_VIDEO_SECONDS} seconds or shorter.`);
  }
}

function waitFor(el: HTMLVideoElement, event: 'loadedmetadata' | 'seeked' | 'loadeddata', timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (err?: Error) => {
      clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener('error', fail);
      if (err) reject(err); else resolve();
    };
    const ok = () => done();
    const fail = () => done(new Error('This video format is not supported by your browser.'));
    const timer = setTimeout(() => done(new Error('Reading the video took too long.')), timeoutMs);
    el.addEventListener(event, ok, { once: true });
    el.addEventListener('error', fail, { once: true });
  });
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** `durationSec` is accepted for parity with Android; the browser reads the real duration. */
export async function extractKeyframes(
  uri: string, opts: { durationSec?: number; signal?: AbortSignal } = {},
): Promise<KeyframeResult> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = uri;
  try {
    await waitFor(video, 'loadedmetadata');
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration > MAX_VIDEO_SECONDS + 0.5) throw new VideoTooLongError(duration);
    if (video.readyState < 2) await waitFor(video, 'loadeddata');

    const size = fitWithin(video.videoWidth, video.videoHeight);
    if (!size.width) throw new Error('This video has no picture to read.');
    const canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    const tiny = document.createElement('canvas');
    tiny.width = 32; tiny.height = 24;
    const tctx = tiny.getContext('2d', { willReadFrequently: true });
    if (!ctx || !tctx) throw new Error('Canvas is unavailable in this browser.');

    const frames: Array<NormalizedImage & { hash: string }> = [];
    for (const t of frameTimestamps(duration)) {
      if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      video.currentTime = Math.min(t, Math.max(0, duration - 0.05));
      await waitFor(video, 'seeked');
      ctx.drawImage(video, 0, 0, size.width, size.height);
      tctx.drawImage(video, 0, 0, 32, 24);
      frames.push({
        id: `vf_${Date.now().toString(36)}_${frames.length}`,
        mimeType: 'image/jpeg',
        base64: stripDataUrl(canvas.toDataURL('image/jpeg', JPEG_QUALITY)),
        width: size.width,
        height: size.height,
        source: 'video_frame',
        label: `Frame at ${fmt(t)}`,
        hash: luminanceHash(tctx.getImageData(0, 0, 32, 24).data, 32, 24),
      });
    }
    const kept = dedupeFrames(frames);
    return {
      durationSec: Math.round(duration * 10) / 10,
      frames: kept.map(({ hash: _hash, ...f }) => f),
      dropped: frames.length - kept.length,
    };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
