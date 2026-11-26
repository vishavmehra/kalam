/**
 * Content sniffing (docs/06 §7.2, §16.2): the first bytes of a file decide what it is, never its
 * name or the MIME type a picker reports. Also reads sample rate and channels from audio headers
 * (docs/06 §8.2), which Android needs to transcribe a file. Pure TypeScript.
 */
import { MediaError } from './errors';
import { checkLimits, DEFAULT_MEDIA_LIMITS, type MediaLimits } from './limits';
import type { MediaType } from './types';

/** Bytes to read from the start of a file before sniffing. */
export const SNIFF_BYTES = 4096;

export interface Sniffed {
  mime: string;
  type: MediaType;
}

const ascii = (h: Uint8Array, at: number, len: number) => String.fromCharCode(...h.subarray(at, at + len));
const starts = (h: Uint8Array, bytes: number[], at = 0) => bytes.every((b, i) => h[at + i] === b);

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const AUDIO_MP4_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ', 'F4A ']);
const VIDEO_3GP = /^3g[p2]/;

/** MIME of the content, or undefined when it is not a supported picture, recording or video. */
export function sniffMedia(h: Uint8Array): Sniffed | undefined {
  if (h.length < 4) return undefined;
  if (starts(h, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', type: 'image' };
  if (starts(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', type: 'image' };
  const a4 = ascii(h, 0, 4);
  if (a4 === 'GIF8') return { mime: 'image/gif', type: 'image' };
  if (a4 === 'RIFF' && h.length >= 12) {
    const sub = ascii(h, 8, 4);
    if (sub === 'WEBP') return { mime: 'image/webp', type: 'image' };
    if (sub === 'WAVE') return { mime: 'audio/wav', type: 'audio' };
    return undefined; // AVI and others are not accepted
  }
  if (h.length >= 12 && ascii(h, 4, 4) === 'ftyp') {
    const brand = ascii(h, 8, 4);
    if (HEIF_BRANDS.has(brand)) return { mime: brand === 'mif1' || brand === 'msf1' ? 'image/heif' : 'image/heic', type: 'image' };
    if (brand === 'avif' || brand === 'avis') return { mime: 'image/avif', type: 'image' };
    if (AUDIO_MP4_BRANDS.has(brand)) return { mime: 'audio/mp4', type: 'audio' };
    if (brand === 'qt  ') return { mime: 'video/quicktime', type: 'video' };
    if (VIDEO_3GP.test(brand)) return { mime: 'video/3gpp', type: 'video' };
    return { mime: 'video/mp4', type: 'video' };
  }
  if (starts(h, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: 'video/webm', type: 'video' };
  if (a4 === 'OggS') return { mime: 'audio/ogg', type: 'audio' };
  if (a4 === 'fLaC') return { mime: 'audio/flac', type: 'audio' };
  if (ascii(h, 0, 5) === '#!AMR') return { mime: 'audio/amr', type: 'audio' };
  if (ascii(h, 0, 3) === 'ID3') return { mime: 'audio/mpeg', type: 'audio' };
  if (h[0] === 0xff && (h[1]! & 0xf6) === 0xf0) return { mime: 'audio/aac', type: 'audio' }; // ADTS: layer bits 00
  if (h[0] === 0xff && (h[1]! & 0xe0) === 0xe0 && (h[1]! & 0x06) !== 0) return { mime: 'audio/mpeg', type: 'audio' };
  return undefined;
}

/** MP4, WebM and Ogg hold sound only or sound and picture; the container alone cannot tell. */
function fitsType(s: Sniffed, type: MediaType): boolean {
  if (s.type === type) return true;
  if (type === 'audio') return s.mime === 'video/mp4' || s.mime === 'video/webm' || s.mime === 'video/3gpp';
  if (type === 'video') return s.mime === 'audio/ogg' || s.mime === 'audio/mp4';
  return false;
}

export interface ValidateInput {
  type: MediaType;
  head: Uint8Array;
  sizeBytes?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  /** HEIC and HEIF decode on Android and iOS, not in most browsers. */
  platform: 'web' | 'android' | 'ios';
}

export type ValidateResult = { ok: true; mime: string } | { ok: false; error: MediaError };

/** Content, type, size and duration checks before a file joins the session. */
export function validateMedia(input: ValidateInput, limits: MediaLimits = DEFAULT_MEDIA_LIMITS): ValidateResult {
  const { type } = input;
  if (input.sizeBytes === 0 || input.head.length === 0) return { ok: false, error: new MediaError('FILE_CORRUPTED', { type }) };
  const sniffed = sniffMedia(input.head);
  if (!sniffed) return { ok: false, error: new MediaError('FILE_UNSUPPORTED', { type }) };
  if (!fitsType(sniffed, type)) return { ok: false, error: new MediaError('FILE_UNSUPPORTED', { type, sniffed: sniffed.type }) };
  if (input.platform === 'web' && (sniffed.mime === 'image/heic' || sniffed.mime === 'image/heif')) {
    return { ok: false, error: new MediaError('FILE_UNSUPPORTED', { type }) };
  }
  // Dropped and pasted files carry no dimensions: read them from the header before anything decodes it.
  const dims = type === 'image' && !(input.width && input.height) ? displayDimensions(input.head) : undefined;
  const over = checkLimits(type, { ...input, ...dims }, limits);
  if (over) return { ok: false, error: over };
  // A container picked as a recording keeps an audio MIME, so players and recognisers treat it as sound.
  const mime = type === 'audio' && sniffed.type === 'video' ? sniffed.mime.replace('video/', 'audio/') : sniffed.mime;
  return { ok: true, mime };
}

const u24le = (h: Uint8Array, at: number) => h[at]! | (h[at + 1]! << 8) | (h[at + 2]! << 16);
const u32be = (h: Uint8Array, at: number) => ((h[at]! << 24) | (h[at + 1]! << 16) | (h[at + 2]! << 8) | h[at + 3]!) >>> 0;
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Pixel size from a picture's header (PNG, GIF, WebP, JPEG, HEIC/AVIF), without decoding it, or
 * undefined when the head does not show it (docs/06 §7.2, §16.2 safe decoders).
 */
export function imageDimensions(h: Uint8Array): { width: number; height: number } | undefined {
  const s = sniffMedia(h);
  if (!s || s.type !== 'image') return undefined;
  const ok = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : undefined);
  if (s.mime === 'image/png') return h.length >= 24 ? ok(u32be(h, 16), u32be(h, 20)) : undefined;
  if (s.mime === 'image/gif') return h.length >= 10 ? ok(u16le(h, 6), u16le(h, 8)) : undefined;
  if (s.mime === 'image/webp' && h.length >= 30) {
    const chunk = ascii(h, 12, 4);
    if (chunk === 'VP8 ') return ok(u16le(h, 26) & 0x3fff, u16le(h, 28) & 0x3fff);
    if (chunk === 'VP8L') return ok(1 + (((h[22]! & 0x3f) << 8) | h[21]!), 1 + (((h[24]! & 0x0f) << 10) | (h[23]! << 2) | (h[22]! >> 6)));
    if (chunk === 'VP8X') return ok(1 + u24le(h, 24), 1 + u24le(h, 27));
    return undefined;
  }
  if (s.mime === 'image/jpeg') {
    let at = 2;
    while (at + 9 <= h.length) {
      if (h[at] !== 0xff) return undefined;
      const marker = h[at + 1]!;
      if (marker === 0xff) { at++; continue; } // fill byte
      if (marker === 0xd9 || marker === 0xda) return undefined; // end of image, start of scan
      if (JPEG_SOF.has(marker)) return ok(u16be(h, at + 7), u16be(h, at + 5));
      at += 2 + u16be(h, at + 2);
    }
    return undefined;
  }
  // HEIC, HEIF and AVIF: the 'ispe' property holds the image size.
  const ispe = findAscii(h, 'ispe');
  return ispe >= 0 && ispe + 16 <= h.length ? ok(u32be(h, ispe + 8), u32be(h, ispe + 12)) : undefined;
}

/** The orientation tag of the first TIFF directory inside an EXIF block, from `base` (the TIFF header) up to `end`. */
function tiffOrientation(h: Uint8Array, base: number, end: number): number | undefined {
  if (base + 8 > end) return undefined;
  const order = ascii(h, base, 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return undefined;
  const u16 = (at: number) => (little ? u16le(h, at) : u16be(h, at));
  const u32 = (at: number) => (little ? (u16le(h, at) | (u16le(h, at + 2) << 16)) >>> 0 : u32be(h, at));
  if (u16(base + 2) !== 42) return undefined;
  const ifd = base + u32(base + 4);
  if (ifd + 2 > end) return undefined;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return undefined;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : undefined;
    }
  }
  return undefined;
}

/**
 * EXIF orientation of a JPEG (1 to 8), read from the header without decoding, or undefined when the picture
 * has none or the head does not show it. 5 to 8 mean the picture is shown turned a quarter, so its width and
 * height swap (docs/06 §7.3). Browsers and the picture library apply this when they decode; this is for what
 * is known before that.
 */
export function exifOrientation(h: Uint8Array): number | undefined {
  if (!starts(h, [0xff, 0xd8])) return undefined;
  let at = 2;
  while (at + 4 <= h.length) {
    if (h[at] !== 0xff) return undefined;
    const marker = h[at + 1]!;
    if (marker === 0xff) { at++; continue; } // fill byte
    if (marker === 0xd9 || marker === 0xda) return undefined; // end of image, start of scan
    const length = u16be(h, at + 2);
    if (marker === 0xe1 && ascii(h, at + 4, 6) === 'Exif\0\0') return tiffOrientation(h, at + 10, Math.min(h.length, at + 2 + length));
    at += 2 + length;
  }
  return undefined;
}

/** The size the picture is shown at: its stored size, turned when the EXIF orientation says a quarter turn. */
export function displayDimensions(h: Uint8Array): { width: number; height: number } | undefined {
  const stored = imageDimensions(h);
  if (!stored) return undefined;
  const turn = exifOrientation(h);
  return turn !== undefined && turn >= 5 ? { width: stored.height, height: stored.width } : stored;
}

/**
 * File names are shown, never trusted (docs/06 §16.2): no folders, control or direction-override
 * characters, at most 80 characters with the extension kept.
 */
export function sanitizeFileName(name: string | undefined | null, fallback: string): string {
  if (!name) return fallback;
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩<>"]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean || /^\.+$/.test(clean)) return fallback;
  if (clean.length <= 80) return clean;
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 && clean.length - dot <= 6 ? clean.slice(dot) : '';
  return `${clean.slice(0, 80 - ext.length - 1)}…${ext}`;
}

export interface AudioFormatInfo {
  sampleRate: number;
  channels: number;
}

const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function findAscii(h: Uint8Array, tag: string, from = 0): number {
  outer: for (let i = from; i <= h.length - tag.length; i++) {
    for (let j = 0; j < tag.length; j++) if (h[i + j] !== tag.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}
const u16le = (h: Uint8Array, at: number) => h[at]! | (h[at + 1]! << 8);
const u32le = (h: Uint8Array, at: number) => (u16le(h, at) + u16le(h, at + 2) * 0x10000) >>> 0;
const u16be = (h: Uint8Array, at: number) => (h[at]! << 8) | h[at + 1]!;

/** Sample rate and channel count from the header, or undefined when the head does not show them. */
export function audioFormatInfo(h: Uint8Array): AudioFormatInfo | undefined {
  const s = sniffMedia(h);
  if (!s) return undefined;
  if (s.mime === 'audio/wav') {
    const fmt = findAscii(h, 'fmt ', 12);
    if (fmt < 0 || fmt + 16 > h.length) return undefined;
    return { channels: u16le(h, fmt + 10), sampleRate: u32le(h, fmt + 12) };
  }
  if (s.mime === 'audio/aac') {
    const rate = ADTS_RATES[(h[2]! >> 2) & 0x0f];
    const channels = ((h[2]! & 0x01) << 2) | (h[3]! >> 6);
    return rate && channels ? { sampleRate: rate, channels } : undefined;
  }
  if (s.mime === 'audio/mpeg') {
    let at = 0;
    if (ascii(h, 0, 3) === 'ID3' && h.length >= 10) {
      at = 10 + ((h[6]! & 0x7f) << 21 | (h[7]! & 0x7f) << 14 | (h[8]! & 0x7f) << 7 | (h[9]! & 0x7f));
    }
    for (; at + 4 <= h.length; at++) {
      if (h[at] !== 0xff || (h[at + 1]! & 0xe0) !== 0xe0) continue;
      const version = (h[at + 1]! >> 3) & 0x03;
      const rate = MP3_RATES[version]?.[(h[at + 2]! >> 2) & 0x03];
      if (!rate) continue;
      return { sampleRate: rate, channels: (h[at + 3]! >> 6) === 3 ? 1 : 2 };
    }
    return undefined;
  }
  if (s.mime === 'audio/flac' && h.length >= 22) {
    // STREAMINFO: 20-bit sample rate, 3-bit channels - 1.
    const rate = (h[18]! << 12) | (h[19]! << 4) | (h[20]! >> 4);
    return rate ? { sampleRate: rate, channels: ((h[20]! >> 1) & 0x07) + 1 } : undefined;
  }
  // MP4 audio: after the 'mp4a' type, channels sit at +20 and the rate at +28 (16.16 fixed). Often in a
  // trailing 'moov', so a head read can miss it.
  const box = findAscii(h, 'mp4a');
  if (box >= 0 && box + 34 <= h.length) {
    const channels = u16be(h, box + 20);
    const sampleRate = u16be(h, box + 28);
    return channels && sampleRate ? { sampleRate, channels } : undefined;
  }
  return undefined;
}
