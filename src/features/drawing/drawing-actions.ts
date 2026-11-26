/**
 * Actions that reach outside the drawing: saving PNG, SVG and PDF files for the person, bringing in an SVG
 * file, and placing a photo as an image object. Kept apart from the store so the store stays pure and fast.
 */
import { strToU8 } from 'fflate';
import type { DrawingDocument, DrawingElement, DrawingPage } from '@/core/contracts';
import { pickImages } from '@/infrastructure/platform/image';
import { getServices } from '@/services';
import { renderPageBytes, renderPageJpeg, saveExportFiles } from './export';
import { images } from './image-cache';
import {
  buildPdf, importSvg, newId, pageImageIds, pageToSvg, pdfFileName, pngFileName, PX_TO_PT, svgFileName, zipFileName,
  type ExportFile, type ExportFormat, type ExportScale, type PdfPage, type SaveOutcome,
} from './model';
import { pickSvgFile } from './pick-svg-file';
import type { PlacedImage } from './studio-store';

export interface ExportResult { files: number; outcome: SaveOutcome; width: number; height: number }

/** Renders the chosen screens one at a time (keeps memory low on phones) and hands them to the device. */
export async function exportDrawing(doc: DrawingDocument, pageIds: readonly string[], scale: ExportScale): Promise<ExportResult> {
  const pages = doc.pages.map((page, index) => ({ page, index })).filter(({ page }) => pageIds.includes(page.id));
  if (pages.length === 0) throw new Error('Choose a screen to export.');
  const multiple = pages.length > 1;
  const files: ExportFile[] = [];
  let size = { width: 0, height: 0 };
  for (const { page, index } of pages) {
    const out = await renderPageBytes(page, scale);
    size = { width: out.width, height: out.height };
    files.push({ name: pngFileName(doc.title, page.title, index, scale, multiple), bytes: out.bytes });
  }
  const outcome = await saveExportFiles(files, zipFileName(doc.title));
  return { files: files.length, outcome, ...size };
}

/** `data:` addresses for the photos on these pages, read from the blob store. Photos that are gone are left out. */
async function photoAddresses(pages: readonly DrawingPage[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const blobs = getServices().db.blobs;
  if (!blobs) return out;
  for (const id of new Set(pages.flatMap(pageImageIds))) {
    const blob = await blobs.get(id).catch(() => undefined);
    if (blob && /^image\/(png|jpeg|webp)$/.test(blob.mimeType)) out.set(id, `data:${blob.mimeType};base64,${blob.base64}`);
  }
  return out;
}

/** SVG: every chosen screen as shapes, with photos embedded. Several screens are saved together as one zip. */
export async function exportDrawingSvg(doc: DrawingDocument, pageIds: readonly string[]): Promise<ExportResult> {
  const pages = doc.pages.map((page, index) => ({ page, index })).filter(({ page }) => pageIds.includes(page.id));
  if (pages.length === 0) throw new Error('Choose a screen to export.');
  const photos = await photoAddresses(pages.map((p) => p.page));
  const multiple = pages.length > 1;
  const files: ExportFile[] = pages.map(({ page, index }) => ({
    name: svgFileName(doc.title, page.title, index, multiple),
    bytes: strToU8(pageToSvg(page, { imageHref: (id) => photos.get(id) })),
    mimeType: 'image/svg+xml',
  }));
  const outcome = await saveExportFiles(files, zipFileName(doc.title));
  return { files: files.length, outcome, width: pages[0]!.page.width, height: pages[0]!.page.height };
}

/**
 * PDF: all screens in one file, in order. Each page is a picture of the screen, so every script and photo
 * looks exactly as it does in the Studio. No PDF library is used (see model/pdf.ts).
 */
export async function exportDrawingPdf(doc: DrawingDocument, scale: ExportScale): Promise<ExportResult> {
  const pages: PdfPage[] = [];
  let size = { width: 0, height: 0 };
  for (const page of doc.pages) {
    const out = await renderPageJpeg(page, scale);
    size = { width: out.width, height: out.height };
    pages.push({ jpeg: out.bytes, pxWidth: out.width, pxHeight: out.height, widthPt: page.width * PX_TO_PT, heightPt: page.height * PX_TO_PT });
  }
  const bytes = buildPdf(pages, doc.title);
  const outcome = await saveExportFiles([{ name: pdfFileName(doc.title), bytes, mimeType: 'application/pdf' }], zipFileName(doc.title));
  return { files: 1, outcome, ...size };
}

export function exportDrawingAs(format: ExportFormat, doc: DrawingDocument, pageIds: readonly string[], scale: ExportScale): Promise<ExportResult> {
  return format === 'svg' ? exportDrawingSvg(doc, pageIds) : format === 'pdf' ? exportDrawingPdf(doc, scale) : exportDrawing(doc, pageIds, scale);
}

export type SvgImportOutcome =
  | { status: 'imported'; elements: DrawingElement[]; notices: string[] }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

/** Lets the person choose an SVG file and reads its simple shapes. `room` is how many more objects the screen can hold. */
export async function importSvgFile(room: number): Promise<SvgImportOutcome> {
  let text: string | undefined;
  try {
    text = await pickSvgFile();
  } catch (e) {
    return { status: 'failed', message: e instanceof Error && e.message ? e.message : 'That file could not be opened.' };
  }
  if (text === undefined) return { status: 'cancelled' };
  const res = importSvg(text, room);
  return res.ok ? { status: 'imported', elements: res.elements, notices: res.notices } : { status: 'failed', message: res.reason };
}

export type PhotoResult = { status: 'placed'; image: PlacedImage } | { status: 'cancelled' } | { status: 'unavailable' };

/** Lets the person choose a photo and stores it in the BlobRepository. Photos never live inside the drawing document. */
export async function pickPhotoForDrawing(drawingId: string): Promise<PhotoResult> {
  const blobs = getServices().db.blobs;
  if (!blobs) return { status: 'unavailable' };
  const [picked] = await pickImages('library', 1);
  if (!picked) return { status: 'cancelled' };
  const stored = await blobs.put({ id: newId('blob'), kind: 'image', mimeType: picked.mimeType, base64: picked.base64, ownerId: drawingId });
  await images.put(stored.id, { base64: picked.base64, mimeType: picked.mimeType });
  return { status: 'placed', image: { blobId: stored.id, width: picked.width, height: picked.height } };
}

/** Wires the image cache to the BlobRepository so photos in saved drawings load on demand. */
export function connectImageStorage(): () => void {
  images.setLoader(async (blobId) => {
    const blob = await getServices().db.blobs?.get(blobId);
    return blob ? { base64: blob.base64, mimeType: blob.mimeType } : undefined;
  });
  return () => images.setLoader(undefined);
}
