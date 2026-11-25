/**
 * Pure media helpers shared by the web and Android input pipelines (docs/06 §5). No platform
 * imports, so they run in Vitest.
 */

export const MAX_IMAGE_SIDE = 1280;
export const JPEG_QUALITY = 0.8;
export const MAX_VIDEO_SECONDS = 60;
export const MAX_VIDEO_FRAMES = 6;
/** Two frames whose 64-bit luminance hashes differ by fewer bits than this are near-duplicates. */
export const DUPLICATE_THRESHOLD = 6;

/** Scales (width, height) to fit inside a `max`-sided square, never upscaling. */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number; scaled: boolean } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0, scaled: false };
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height), scaled: false };
  const k = max / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), scaled: true };
}

/** Evenly spaced sample times (seconds), centred in each slot so we skip black first/last frames. */
export function frameTimestamps(durationSec: number, count = MAX_VIDEO_FRAMES): number[] {
  if (!(durationSec > 0)) return [0];
  const n = Math.max(1, Math.min(count, Math.ceil(durationSec)));
  return Array.from({ length: n }, (_, i) => Math.round(((durationSec * (i + 0.5)) / n) * 100) / 100);
}

/**
 * Difference hash: box-sample RGBA pixels into a 9×8 luminance grid, then emit one bit per
 * horizontal neighbour comparison → 64 bits as 16 hex chars. Robust to scaling and compression.
 */
export function luminanceHash(rgba: ArrayLike<number>, width: number, height: number): string {
  const GW = 9; const GH = 8;
  const grid = new Float64Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    const y0 = Math.floor((gy * height) / GH);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / GH));
    for (let gx = 0; gx < GW; gx++) {
      const x0 = Math.floor((gx * width) / GW);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / GW));
      let sum = 0; let n = 0;
      for (let y = y0; y < Math.min(y1, height); y++) {
        for (let x = x0; x < Math.min(x1, width); x++) {
          const i = (y * width + x) * 4;
          sum += 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
          n++;
        }
      }
      grid[gy * GW + gx] = n ? sum / n : 0;
    }
  }
  let hex = '';
  for (let gy = 0; gy < GH; gy++) {
    let byte = 0;
    for (let gx = 0; gx < GW - 1; gx++) {
      byte = (byte << 1) | (grid[gy * GW + gx]! > grid[gy * GW + gx + 1]! ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length) * 4;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/** Drops frames that look like an already-kept frame (static camera, paused demo). */
export function dedupeFrames<T extends { hash: string }>(frames: T[], threshold = DUPLICATE_THRESHOLD): T[] {
  const kept: T[] = [];
  for (const f of frames) {
    if (kept.every((k) => hammingDistance(k.hash, f.hash) >= threshold)) kept.push(f);
  }
  return kept;
}

/** Strips a `data:*;base64,` prefix if present. */
export function stripDataUrl(dataUrl: string): string {
  const i = dataUrl.indexOf('base64,');
  return i >= 0 ? dataUrl.slice(i + 7) : dataUrl;
}

/** Approximate decoded byte size of a base64 payload (for user-facing size hints). */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}
