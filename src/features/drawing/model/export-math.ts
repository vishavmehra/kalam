/**
 * Export sizing and file naming (docs/08 §14.3). Pure so the limits are testable: a long page at a
 * high scale must never ask a phone for an image bigger than it can hold.
 */
import type { DrawingPage } from '@/core/contracts';

export const EXPORT_SCALES = [1, 2, 4] as const;
export type ExportScale = (typeof EXPORT_SCALES)[number];
export const EXPORT_SCALE_LABELS: Record<ExportScale, string> = { 1: 'Standard', 2: 'Sharp', 4: 'Extra sharp' };
/** Longest side of an exported image, in pixels. */
export const MAX_EXPORT_SIDE = 4096;

/** Pixel size for `page` at `scale`, reduced if the longest side would pass the limit. */
export function exportSize(page: Pick<DrawingPage, 'width' | 'height'>, scale: number): { width: number; height: number; scale: number } {
  const wanted = Math.max(0.1, scale);
  const longest = Math.max(page.width, page.height) * wanted;
  const effective = longest > MAX_EXPORT_SIDE ? (MAX_EXPORT_SIDE / Math.max(page.width, page.height)) : wanted;
  return {
    width: Math.max(1, Math.round(page.width * effective)),
    height: Math.max(1, Math.round(page.height * effective)),
    scale: effective,
  };
}

/** Name safe for a file system, keeping letters and numbers from any script. */
export function safeName(name: string, fallback: string): string {
  const base = name.trim().replace(/[^\p{L}\p{M}\p{N}\-_ ]+/gu, '').replace(/\s+/g, '-').slice(0, 48);
  return base || fallback;
}

export function pngFileName(drawingTitle: string, pageTitle: string, index: number, scale: number, multiple: boolean): string {
  const drawing = safeName(drawingTitle, 'drawing');
  const page = safeName(pageTitle, `screen-${index + 1}`);
  const suffix = scale === 1 ? '' : `@${scale}x`;
  return multiple ? `${drawing}-${index + 1}-${page}${suffix}.png` : `${drawing}-${page}${suffix}.png`;
}

export function zipFileName(drawingTitle: string): string {
  return `${safeName(drawingTitle, 'drawing')}-screens.zip`;
}

export interface ExportFile { name: string; bytes: Uint8Array }
/** 'saved' = downloaded by the browser; 'shared' = handed to the Android share sheet. */
export type SaveOutcome = 'saved' | 'shared';
