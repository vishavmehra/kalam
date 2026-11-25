/**
 * Minimal PNG encoder and decoder for the brand rasters (8-bit, non-interlaced, RGB or RGBA).
 * Used by render.mjs to write the files and by the brand-assets test to read them back.
 * No dependencies beyond node:zlib; output is deterministic (no timestamps, no text chunks).
 */
import { Buffer } from 'node:buffer';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** Sum of absolute values of a filtered row read as signed bytes; the lowest sum compresses best. */
function cost(row) {
  let sum = 0;
  for (let i = 0; i < row.length; i += 1) sum += row[i] < 128 ? row[i] : 256 - row[i];
  return sum;
}

/**
 * @param {{ width: number, height: number, rgba: Uint8Array, alpha: boolean }} image
 *   `rgba` holds 4 bytes per pixel, unpremultiplied. With `alpha: false` the alpha byte is dropped and
 *   every pixel must be fully opaque (App Store icons may not carry an alpha channel).
 */
export function encodePng({ width, height, rgba, alpha }) {
  if (rgba.length !== width * height * 4) throw new Error('encodePng: pixel buffer does not match the size');
  const channels = alpha ? 4 : 3;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      if (!alpha && rgba[from + 3] !== 255) throw new Error(`encodePng: pixel ${x},${y} is not opaque`);
      for (let c = 0; c < channels; c += 1) row[x * channels + c] = rgba[from + c];
    }
    const candidates = [
      [0, row],
      [1, Buffer.from(row.map((v, i) => (v - (i >= channels ? row[i - channels] : 0)) & 255))],
      [2, Buffer.from(row.map((v, i) => (v - previous[i]) & 255))],
    ];
    candidates.sort((a, b) => cost(a[1]) - cost(b[1]));
    raw[y * (stride + 1)] = candidates[0][0];
    candidates[0][1].copy(raw, y * (stride + 1) + 1);
    previous = row;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = alpha ? 6 : 2; // colour type: RGBA or RGB
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('sRGB', Buffer.from([0])), // perceptual intent: tells viewers the pixels are sRGB
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Reads width and height from the IHDR without decoding the pixels. */
export function pngSize(data) {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Decodes an 8-bit non-interlaced RGB or RGBA PNG into RGBA bytes. */
export function decodePng(data) {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const chunks = [];
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    chunks.push(type);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error('decodePng: only 8-bit non-interlaced PNGs are supported');
      colorType = body[9];
    } else if (type === 'IDAT') {
      idat.push(body);
    }
    offset += 12 + length;
  }
  if (colorType !== 2 && colorType !== 6) throw new Error(`decodePng: unsupported colour type ${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i += 1) {
      const value = raw[y * (stride + 1) + 1 + i];
      const left = i >= channels ? out[y * stride + i - channels] : 0;
      const up = y > 0 ? out[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= channels ? out[(y - 1) * stride + i - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) throw new Error(`decodePng: bad filter ${filter}`);
      out[y * stride + i] = (value + predicted) & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    rgba[p * 4] = out[p * channels];
    rgba[p * 4 + 1] = out[p * channels + 1];
    rgba[p * 4 + 2] = out[p * channels + 2];
    rgba[p * 4 + 3] = channels === 4 ? out[p * channels + 3] : 255;
  }
  return { width, height, colorType, hasAlpha: colorType === 6, rgba, chunks };
}
