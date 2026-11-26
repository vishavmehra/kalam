import { describe, expect, it } from 'vitest';
import { displayDimensions, exifOrientation, imageDimensions, sniffMedia, validateMedia } from './sniff';

const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** A JPEG head: an EXIF block holding one Orientation tag, then the frame header with the stored size. */
function jpeg(orientation: number | undefined, opts: { little?: boolean; width?: number; height?: number } = {}): Uint8Array {
  const { little = false, width = 4000, height = 3000 } = opts;
  const u16 = little ? le16 : be16;
  const u32 = (n: number) => (little ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255] : [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const tiff = [...ascii(little ? 'II' : 'MM'), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation ?? 1), 0, 0, ...u32(0)];
  const body = [...ascii('Exif'), 0, 0, ...tiff];
  const exif = orientation === undefined ? [] : [0xff, 0xe1, ...be16(body.length + 2), ...body];
  const frame = [0xff, 0xc0, ...be16(17), 8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const bytes = [0xff, 0xd8, 0xff, 0xe0, ...be16(16), ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, ...exif, ...frame];
  return Uint8Array.from([...bytes, ...new Array<number>(64).fill(0)]);
}

describe('EXIF orientation (docs/06 §7.3)', () => {
  it.each([false, true])('reads all eight orientations (little endian: %s)', (little) => {
    for (let o = 1; o <= 8; o++) expect(exifOrientation(jpeg(o, { little })), `orientation ${o}`).toBe(o);
  });

  it('swaps the shown size for the four quarter-turn orientations only', () => {
    for (const little of [false, true]) {
      for (let o = 1; o <= 8; o++) {
        const shown = displayDimensions(jpeg(o, { little, width: 4000, height: 3000 }));
        // Stored 4000 x 3000: upright and mirrored pictures keep it, 90 degree ones are shown 3000 x 4000.
        expect(shown, `orientation ${o}`).toEqual(o >= 5 ? { width: 3000, height: 4000 } : { width: 4000, height: 3000 });
      }
    }
  });

  it('keeps the stored size readable and the picture a JPEG whatever its orientation', () => {
    const phone = jpeg(6, { width: 4032, height: 3024 });
    expect(sniffMedia(phone)).toEqual({ mime: 'image/jpeg', type: 'image' });
    expect(imageDimensions(phone)).toEqual({ width: 4032, height: 3024 });
    expect(displayDimensions(phone)).toEqual({ width: 3024, height: 4032 });
  });

  it('says nothing when there is no orientation, or it is not a JPEG', () => {
    expect(exifOrientation(jpeg(undefined))).toBeUndefined();
    expect(displayDimensions(jpeg(undefined))).toEqual({ width: 4000, height: 3000 });
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii('IHDR'), 0, 0, 2, 0x80, 0, 0, 1, 0xe0, ...new Array<number>(20).fill(0)]);
    expect(exifOrientation(png)).toBeUndefined();
    expect(displayDimensions(png)).toEqual({ width: 640, height: 480 });
    expect(exifOrientation(new Uint8Array())).toBeUndefined();
  });

  it('ignores a value that is not one of the eight, and a damaged block', () => {
    expect(exifOrientation(jpeg(0))).toBeUndefined();
    expect(exifOrientation(jpeg(9))).toBeUndefined();
    const broken = jpeg(6);
    broken[broken.indexOf(0x4d)] = 0x58; // the TIFF byte-order mark (MM) is now neither II nor MM
    expect(exifOrientation(broken)).toBeUndefined();
  });

  it('never throws on a head cut short anywhere', () => {
    for (const little of [false, true]) {
      const whole = jpeg(8, { little });
      for (let n = 0; n <= whole.length; n++) {
        expect(() => exifOrientation(whole.slice(0, n))).not.toThrow();
        expect(() => displayDimensions(whole.slice(0, n))).not.toThrow();
      }
    }
  });

  it('judges the size limit by the shown picture, which is the same either way round', () => {
    const tall = jpeg(6, { width: 8000, height: 4000 });
    const wide = jpeg(1, { width: 8000, height: 4000 });
    for (const head of [tall, wide]) {
      expect(validateMedia({ type: 'image', head, sizeBytes: 5_000, platform: 'web' }).ok).toBe(true);
    }
    const huge = jpeg(6, { width: 30_000, height: 100 });
    const r = validateMedia({ type: 'image', head: huge, sizeBytes: 5_000, platform: 'web' });
    expect(!r.ok && r.error.code).toBe('FILE_TOO_LARGE');
  });
});
