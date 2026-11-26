/**
 * PDF input for Document Intelligence (docs/14 §9.2-9.3), with no PDF library.
 *
 * Scope, stated plainly: this reads SCANNED PDFs, where each page is one JPEG picture (what phone
 * scanner apps and office scanners write). It pulls those pictures out of the file, in file order.
 * It does not draw text or vector PDFs, and it skips pictures stored in other encodings (Flate,
 * JBIG2, CCITT, JPEG 2000). Those PDFs report `no_pages`; the person saves them as photos instead.
 * Pure bytes in, bytes out, so it behaves the same on web, Android and iOS, offline, with nothing sent.
 *
 * ponytail: pdf.js would draw any PDF but is not installed and is heavy on a phone. Add it, web only,
 * if text-only PDFs matter. Known gaps (the page tree is never read): a PDF that stores its
 * pictures out of order is read in stored order; a page rotated with /Rotate is sent unrotated; a page
 * stored as several strips is skipped (each strip is under the page-size floor); an image dictionary
 * longer than 1024 bytes before its stream is missed. Tested on one real Pillow-written PDF only.
 */

const MB = 1024 * 1024;
export const MAX_PDF_BYTES = 20 * MB;
/** Pages read in one batch. Each page is one model call. */
export const MAX_DOC_PAGES = 20;
/** Embedded pictures smaller than this on their short side are logos, stamps and signatures, not pages. */
const MIN_PAGE_SIDE = 400;

export type PdfFailure = 'not_pdf' | 'too_large' | 'encrypted' | 'no_pages';
export interface PdfPage { jpeg: Uint8Array; width: number; height: number }
export type PdfResult =
  | { ok: true; pages: PdfPage[]; /** Pictures left out: too small, not JPEG, or beyond the page limit. */ skipped: number }
  | { ok: false; reason: PdfFailure };

const bytesOf = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const STREAM = bytesOf('stream');
const ENDSTREAM = bytesOf('endstream');
const MAGIC = bytesOf('%PDF-');
const ENCRYPT = bytesOf('/Encrypt');

/** Index of `needle` in `hay` at or after `from`, or -1. Uses the native single-byte search to hop. */
function find(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  const first = needle[0];
  for (let i = hay.indexOf(first, from); i !== -1 && i <= hay.length - needle.length; i = hay.indexOf(first, i + 1)) {
    let k = 1;
    while (k < needle.length && hay[i + k] === needle[k]) k++;
    if (k === needle.length) return i;
  }
  return -1;
}

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

/** Width, height and colour components from the first start-of-frame marker, or undefined when it is not a JPEG. */
export function jpegInfo(b: Uint8Array): { width: number; height: number; components: number } | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], components: b[i + 9] };
    }
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return undefined;
}

/** Page pictures of a scanned PDF, in file order. */
export function extractPdfPages(bytes: Uint8Array, maxPages = MAX_DOC_PAGES): PdfResult {
  if (bytes.length > MAX_PDF_BYTES) return { ok: false, reason: 'too_large' };
  const head = find(bytes.subarray(0, 1024), MAGIC);
  if (head < 0) return { ok: false, reason: 'not_pdf' };
  if (find(bytes, ENCRYPT) >= 0) return { ok: false, reason: 'encrypted' };

  const pages: PdfPage[] = [];
  let skipped = 0;
  let at = head;
  for (;;) {
    const s = find(bytes, STREAM, at);
    if (s < 0) break;
    const e = find(bytes, ENDSTREAM, s + STREAM.length);
    if (e < 0) break;
    at = e + ENDSTREAM.length;
    // The object's dictionary is the text between its last "obj" and the stream keyword.
    const window = latin1(bytes.subarray(Math.max(0, s - 1024), s));
    const dict = window.slice(window.lastIndexOf('obj') + 3);
    if (!/\/Subtype\s*\/Image\b/.test(dict) || /\/ImageMask\s+true/.test(dict)) continue;
    if (!/\/Filter\s*\[?\s*\/DCTDecode\b/.test(dict)) { skipped++; continue; }

    let start = s + STREAM.length;
    if (bytes[start] === 0x0d && bytes[start + 1] === 0x0a) start += 2;
    else if (bytes[start] === 0x0a || bytes[start] === 0x0d) start += 1;
    let end = e;
    while (end > start && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) end--;
    const jpeg = bytes.subarray(start, end);
    const info = jpegInfo(jpeg);
    // A real JPEG ends with the end-of-image marker; CMYK scans do not decode the same everywhere.
    const closed = jpeg.length > 2 && jpeg.subarray(Math.max(2, jpeg.length - 8)).some((x, i, a) => x === 0xff && a[i + 1] === 0xd9);
    if (!info || !closed || info.components === 4 || Math.min(info.width, info.height) < MIN_PAGE_SIDE) { skipped++; continue; }
    if (pages.length >= maxPages) { skipped++; continue; }
    pages.push({ jpeg, width: info.width, height: info.height });
  }
  return pages.length ? { ok: true, pages, skipped } : { ok: false, reason: 'no_pages' };
}
