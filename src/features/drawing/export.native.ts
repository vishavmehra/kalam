/**
 * Android export (docs/08 §14): offscreen Skia surfaces for the compiler's page PNGs, page strip
 * thumbnails and PNG files a person saves through the system share sheet.
 */
import { ImageFormat, Skia } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { zipSync } from 'fflate';
import type { DrawingDocument, DrawingPage, NormalizedImage } from '@/core/contracts';
import { timings } from '@/core/observability';
import { fitWithin } from '@/features/input/media-math';
import { images } from './image-cache.native';
import { contentCrop, exportSize, pageHasVisibleContent, pageImageIds, pagePrimitives, type Bounds, type ExportFile, type SaveOutcome } from './model';
import { drawPrimitivesSkia } from './render-skia';
import { textFontsReady } from './text-fonts';

function snapshot(page: DrawingPage, width: number, height: number, crop?: Bounds) {
  const surface = Skia.Surface.MakeOffscreen(width, height);
  if (!surface) throw new Error('Could not create an image for this page.');
  const canvas = surface.getCanvas();
  if (crop) {
    canvas.scale(width / crop.w, height / crop.h);
    canvas.translate(-crop.x, -crop.y);
  } else canvas.scale(width / page.width, height / page.height);
  drawPrimitivesSkia(canvas, pagePrimitives(page));
  surface.flush();
  return surface.makeImageSnapshot();
}

/**
 * PNG of one page for cloud vision, at most 1280 px on the long side. It is cropped to what is drawn (docs/11 §7.5), so empty
 * paper and anything beyond the drawing is not in the picture.
 */
export function exportPagePng(page: DrawingPage, index: number): NormalizedImage {
  const crop = contentCrop(page);
  const size = fitWithin((crop?.w ?? page.width) * 4, (crop?.h ?? page.height) * 4);
  const image = snapshot(page, size.width, size.height, crop ?? undefined);
  return {
    id: `${page.id}_png`,
    mimeType: 'image/png',
    base64: image.encodeToBase64(ImageFormat.PNG, 100),
    width: size.width,
    height: size.height,
    source: 'drawing',
    label: `Screen ${index + 1}: ${page.title}${crop ? ' (cropped to the drawing)' : ''}`,
  };
}

export function exportDrawingPages(doc: DrawingDocument): Promise<NormalizedImage[]> {
  return timings.time('drawing_export', async () => {
    await images.ensure(doc.pages.flatMap(pageImageIds));
    await textFontsReady(doc.pages);
    return doc.pages.flatMap((p, i) => (pageHasVisibleContent(p) ? [exportPagePng(p, i)] : []));
  });
}

/** PNG bytes for a person to keep. Large scales are reduced to a size a phone can hold. */
export async function renderPageBytes(page: DrawingPage, scale: number): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  await images.ensure(pageImageIds(page));
  await textFontsReady([page]);
  const { width, height } = exportSize(page, scale);
  const image = snapshot(page, width, height);
  return { bytes: image.encodeToBytes(ImageFormat.PNG, 100), width, height };
}

/** JPEG bytes of a page, for the PDF. */
export async function renderPageJpeg(page: DrawingPage, scale: number): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  await images.ensure(pageImageIds(page));
  await textFontsReady([page]);
  const { width, height } = exportSize(page, scale);
  const image = snapshot(page, width, height);
  return { bytes: image.encodeToBytes(ImageFormat.JPEG, 92), width, height };
}

/** Small JPEG data URI for the page strip. */
export function renderPageThumbnail(page: DrawingPage, width: number): string | undefined {
  try {
    const height = Math.max(1, Math.round((width * page.height) / page.width));
    const image = snapshot(page, width, height);
    return `data:image/jpeg;base64,${image.encodeToBase64(ImageFormat.JPEG, 72)}`;
  } catch {
    return undefined;
  }
}

/** Writes the file(s) to the cache and opens the share sheet, where the person can save to Files, Drive or send. */
export async function saveExportFiles(files: ExportFile[], archiveName: string): Promise<SaveOutcome> {
  if (files.length === 0) throw new Error('There is nothing to export.');
  const single = files.length === 1;
  const name = single ? files[0]!.name : archiveName;
  const bytes = single ? files[0]!.bytes : zipSync(Object.fromEntries(files.map((f) => [f.name, f.bytes] as const)), { level: 0 });
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  await file.write(bytes);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Saving files is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: single ? files[0]!.mimeType ?? 'image/png' : 'application/zip', dialogTitle: name });
  return 'shared';
}
