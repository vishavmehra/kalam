import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_PNG } from './evaluate';
import { imageInfo } from './photo';

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'));

describe('imageInfo', () => {
  it('reads a PNG size from the header', () => {
    expect(imageInfo(bytes(PLACEHOLDER_PNG))).toEqual({ mimeType: 'image/png', width: 1, height: 1 });
  });

  it('reads a JPEG size from its start-of-frame marker, skipping other segments', () => {
    const jpeg = Uint8Array.from([
      0xff,
      0xd8, // start of image
      0xff,
      0xe1,
      0x00,
      0x06,
      0x45,
      0x78,
      0x69,
      0x66, // a small APP1 segment (its length counts its own 2 bytes)
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      0x0b,
      0xb8,
      0x07,
      0xd0,
      0x03, // frame: height 3000, width 2000
      0x01,
      0x22,
      0x00,
      0x02,
      0x11,
      0x01,
      0x03,
      0x11,
      0x01,
    ]);
    expect(imageInfo(jpeg)).toEqual({ mimeType: 'image/jpeg', width: 2000, height: 3000 });
  });

  it('returns nothing for other files', () => {
    expect(imageInfo(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeUndefined();
    expect(imageInfo(new Uint8Array())).toBeUndefined();
    // HEIC, the iPhone default, is not supported
    expect(imageInfo(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))).toBeUndefined();
  });
});
