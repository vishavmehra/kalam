/**
 * Actions that reach outside the drawing: saving PNG files for the person, and placing a photo as an
 * image object. Kept apart from the store so the store stays pure and fast.
 */
import type { DrawingDocument } from '@/core/contracts';
import { pickImages } from '@/infrastructure/platform/image';
import { getServices } from '@/services';
import { renderPageBytes, saveExportFiles } from './export';
import { images } from './image-cache';
import { newId, pngFileName, zipFileName, type ExportFile, type ExportScale, type SaveOutcome } from './model';
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
