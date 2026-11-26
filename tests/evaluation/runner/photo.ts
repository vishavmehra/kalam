/** Reads the size and type of a JPEG or PNG from its first bytes. Pure: no file access, no decoding. */
export interface ImageInfo {
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
}

const be16 = (b: Uint8Array, i: number): number => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const be32 = (b: Uint8Array, i: number): number =>
  (b[i] ?? 0) * 0x1000000 + (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0));

export function imageInfo(b: Uint8Array): ImageInfo | undefined {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const width = be32(b, 16);
    const height = be32(b, 20);
    return width > 0 && height > 0 ? { mimeType: 'image/png', width, height } : undefined;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = b[i + 1] ?? 0;
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      // Start-of-frame markers carry the size (C4, C8 and CC are not frames).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = be16(b, i + 5);
        const width = be16(b, i + 7);
        return width > 0 && height > 0 ? { mimeType: 'image/jpeg', width, height } : undefined;
      }
      i += 2 + be16(b, i + 2);
    }
  }
  return undefined;
}
