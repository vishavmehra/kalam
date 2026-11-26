/**
 * Turns picked files into pages to read (docs/14 §9.3 steps 1-3): validates each file, pulls the page
 * pictures out of a scanned PDF, and makes every page a ≤2000 px JPEG with its metadata removed. Works on
 * web, Android and iOS with the packages already installed. Pages are held in memory by the caller and
 * never written anywhere; the one temporary file made on a phone is deleted straight after use.
 */
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

import { base64ToBytes, bytesToBase64 } from '@/core/backup/base64';
import type { DocumentPage, PdfFailure } from '@/core/document-intel';
import { extractPdfPages, MAX_DOC_PAGES, MAX_PDF_BYTES } from '@/core/document-intel';
import { toMediaError } from '@/core/media/errors';
import { readBase64, readHead, sizeOf } from '@/infrastructure/media/file-bytes';
import { inspectMedia } from '@/infrastructure/media/inspect';
import { pickImages } from '@/infrastructure/media/pick';
import type { MediaSource } from '@/infrastructure/media/source';
import { normalizeImageUri } from '@/infrastructure/platform/image';

/** Long side of a page picture. Handwriting on a full sheet needs more than the 1280 px used for sketches. */
export const DOC_SIDE = 2000;

/** Things to tell the person, as codes the screen turns into words in their language. */
export type PickNote =
  | { kind: 'pdf'; name: string; reason: PdfFailure }
  | { kind: 'file'; name: string; reason: string }
  | { kind: 'skipped'; count: number }
  | { kind: 'cut'; max: number };

export interface PickedPages { pages: DocumentPage[]; notes: PickNote[] }

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];
let counter = 0;
const newId = () => `doc_${Date.now().toString(36)}_${(counter++).toString(36)}`;
const fromAsset = (a: DocumentPicker.DocumentPickerAsset): MediaSource => ({
  uri: a.uri,
  ...(a.file ? { file: a.file } : {}),
  ...(a.name ? { name: a.name } : {}),
  ...(a.size ? { sizeBytes: a.size } : {}),
  ...(a.mimeType ? { mimeType: a.mimeType } : {}),
});

/** A page JPEG as something the image tools can open: a data URL on web, a short-lived cache file on a phone. */
async function openJpeg(bytes: Uint8Array): Promise<{ uri: string; release(): void }> {
  if (Platform.OS === 'web') return { uri: `data:image/jpeg;base64,${bytesToBase64(bytes)}`, release() {} };
  const { File: FsFile, Paths } = await import('expo-file-system'); // native only, so the web bundle never loads it
  const file = new FsFile(Paths.cache, `kalam-doc-page-${newId()}.jpg`);
  if (file.exists) file.delete();
  file.create();
  await file.write(bytes);
  return {
    uri: file.uri,
    release() {
      try { file.delete(); } catch { /* the system clears the cache anyway */ }
    },
  };
}

async function pageFrom(uri: string, name: string, page: number, pages: number): Promise<DocumentPage> {
  const img = await normalizeImageUri(uri, 'photo', undefined, DOC_SIDE);
  return { id: newId(), image: { mimeType: 'image/jpeg', base64: img.base64 }, width: img.width, height: img.height, name, page, pages };
}

async function fromFile(src: MediaSource, room: number): Promise<{ pages: DocumentPage[]; notes: PickNote[] }> {
  const name = src.name ?? 'Document';
  const head = await readHead(src, 4);
  if (PDF_MAGIC.every((b, i) => head[i] === b)) {
    if ((await sizeOf(src)) > MAX_PDF_BYTES) return { pages: [], notes: [{ kind: 'pdf', name, reason: 'too_large' }] };
    const found = extractPdfPages(base64ToBytes(await readBase64(src)), room);
    if (!found.ok) return { pages: [], notes: [{ kind: 'pdf', name, reason: found.reason }] };
    const pages: DocumentPage[] = [];
    for (const [i, p] of found.pages.entries()) {
      const tmp = await openJpeg(p.jpeg);
      try {
        pages.push(await pageFrom(tmp.uri, name, i + 1, found.pages.length));
      } finally {
        tmp.release();
      }
    }
    return { pages, notes: found.skipped ? [{ kind: 'skipped', count: found.skipped }] : [] };
  }
  // Pictures go through the same checks as every other photo: content sniffing, size and dimension limits.
  await inspectMedia(src, 'image', name);
  return { pages: [await pageFrom(src.uri, name, 1, 1)], notes: [] };
}

/**
 * Photos and scanned PDFs from the files on the device (`files`), or one new photo from the camera.
 * `room` is how many more pages the batch can take. A bad file is reported and skipped; the rest still load.
 */
export async function pickPages(from: 'files' | 'camera', room: number): Promise<PickedPages> {
  const out: PickedPages = { pages: [], notes: [] };
  let sources: MediaSource[];
  if (from === 'camera') sources = await pickImages('camera', 1);
  else {
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], multiple: true, copyToCacheDirectory: true });
    sources = res.canceled ? [] : res.assets.map(fromAsset);
  }
  for (const src of sources) {
    const left = Math.min(room, MAX_DOC_PAGES) - out.pages.length;
    if (left <= 0) {
      out.notes.push({ kind: 'cut', max: MAX_DOC_PAGES });
      break;
    }
    try {
      const r = await fromFile(src, left);
      out.pages.push(...r.pages);
      out.notes.push(...r.notes);
    } catch (e) {
      out.notes.push({ kind: 'file', name: src.name ?? 'File', reason: toMediaError(e, 'FILE_CORRUPTED').message });
    }
  }
  return out;
}
