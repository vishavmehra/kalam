/**
 * Web export (docs/08 §14): page PNGs for the compiler, thumbnails for the page strip, and PNG files
 * a person saves to their device. Everything is drawn from the same display list as the canvas.
 */
import { zipSync } from 'fflate';
import type { DrawingDocument, DrawingPage, NormalizedImage } from '@/core/contracts';
import { timings } from '@/core/observability';
import { fitWithin, stripDataUrl } from '@/features/input/media-math';
import { images } from './image-cache.web';
import { contentCrop, exportSize, pageHasVisibleContent, pageImageIds, pagePrimitives, type Bounds, type ExportFile, type SaveOutcome } from './model';
import { drawPrimitives } from './render-canvas';
import { textFontsReady } from './text-fonts';

function paintPage(page: DrawingPage, width: number, height: number, crop?: Bounds): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser.');
  if (crop) {
    ctx.scale(width / crop.w, height / crop.h);
    ctx.translate(-crop.x, -crop.y);
  } else ctx.scale(width / page.width, height / page.height);
  drawPrimitives(ctx, pagePrimitives(page));
  return canvas;
}

/** Frees the bitmap memory of a canvas we no longer need (docs/08 §17.3). */
function release(canvas: HTMLCanvasElement) {
  canvas.width = 0; canvas.height = 0;
}

/**
 * PNG of one page for cloud vision, at most 1280 px on the long side. It is cropped to what is drawn (docs/11 §7.5), so empty
 * paper and anything beyond the drawing is not in the picture.
 */
export function exportPagePng(page: DrawingPage, index: number): NormalizedImage {
  const crop = contentCrop(page);
  const size = fitWithin((crop?.w ?? page.width) * 4, (crop?.h ?? page.height) * 4);
  const canvas = paintPage(page, size.width, size.height, crop ?? undefined);
  const base64 = stripDataUrl(canvas.toDataURL('image/png'));
  release(canvas);
  return {
    id: `${page.id}_png`,
    mimeType: 'image/png',
    base64,
    width: size.width,
    height: size.height,
    source: 'drawing',
    label: `Screen ${index + 1}: ${page.title}${crop ? ' (cropped to the drawing)' : ''}`,
  };
}

/** PNGs for every page with something visible, in page order. */
export function exportDrawingPages(doc: DrawingDocument): Promise<NormalizedImage[]> {
  return timings.time('drawing_export', async () => {
    await images.ensure(doc.pages.flatMap(pageImageIds));
    await textFontsReady(doc.pages);
    return doc.pages.flatMap((p, i) => (pageHasVisibleContent(p) ? [exportPagePng(p, i)] : []));
  });
}

/** PNG bytes for a person to keep. `scale` 1 = the page's own size; large scales are reduced to a safe size. */
export async function renderPageBytes(page: DrawingPage, scale: number): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  await images.ensure(pageImageIds(page));
  await textFontsReady([page]);
  const { width, height } = exportSize(page, scale);
  const canvas = paintPage(page, width, height);
  try {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The image could not be created.');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    release(canvas);
  }
}

/** JPEG bytes of a page, for the PDF. Pages have an opaque paper colour, so nothing turns black. */
export async function renderPageJpeg(page: DrawingPage, scale: number): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  await images.ensure(pageImageIds(page));
  await textFontsReady([page]);
  const { width, height } = exportSize(page, scale);
  const canvas = paintPage(page, width, height);
  try {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('The image could not be created.');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    release(canvas);
  }
}

/** Small JPEG data URI for the page strip, or undefined if the browser refuses. */
export function renderPageThumbnail(page: DrawingPage, width: number): string | undefined {
  try {
    const height = Math.max(1, Math.round((width * page.height) / page.width));
    const canvas = paintPage(page, width, height);
    const uri = canvas.toDataURL('image/jpeg', 0.72);
    release(canvas);
    return uri;
  } catch {
    return undefined;
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** One file downloads as is; several download as one zip so the browser does not block repeated downloads. */
export async function saveExportFiles(files: ExportFile[], archiveName: string): Promise<SaveOutcome> {
  if (files.length === 0) throw new Error('There is nothing to export.');
  if (files.length === 1) {
    download(new Blob([files[0]!.bytes as BlobPart], { type: files[0]!.mimeType ?? 'image/png' }), files[0]!.name);
  } else {
    const zip = zipSync(Object.fromEntries(files.map((f) => [f.name, f.bytes] as const)), { level: 0 });
    download(new Blob([zip as BlobPart], { type: 'application/zip' }), archiveName);
  }
  return 'saved';
}
