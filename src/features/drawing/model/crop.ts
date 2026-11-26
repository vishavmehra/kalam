/**
 * Crop to content (docs/11 §7.5 "avoid sending the full drawing document when a relevant crop is sufficient"). The
 * picture that may go to cloud vision shows only the part of the screen that has something drawn on it, plus a margin,
 * so empty paper and anything beyond the drawing never leaves the phone. Pure geometry.
 */
import type { DrawingPage } from '@/core/contracts';
import { elementAABB, unionBounds, type Bounds } from './geometry';

/** Margin kept around the drawing, in document px. */
export const CROP_PADDING = 32;
/** A crop smaller than this on a side is grown (centred on the drawing) so the picture keeps its context. */
export const MIN_CROP_SIDE = 240;
/** Cropping is skipped unless it leaves out at least this share of the screen's area. */
export const MIN_CROP_SAVING = 0.15;

/**
 * The box to send for `page`, or null when there is nothing visible or cropping would leave out too little to matter.
 * Hidden objects never count. The box stays inside the page and is rounded to whole pixels.
 */
export function contentCrop(page: Pick<DrawingPage, 'width' | 'height' | 'elements'>, pad = CROP_PADDING): Bounds | null {
  const boxes = page.elements.filter((e) => !e.hidden).map(elementAABB).filter((b) => Number.isFinite(b.w + b.h + b.x + b.y));
  if (!boxes.length) return null;
  const u = unionBounds(boxes);
  const wantW = Math.min(page.width, Math.max(MIN_CROP_SIDE, u.w + pad * 2));
  const wantH = Math.min(page.height, Math.max(MIN_CROP_SIDE, u.h + pad * 2));
  const cx = u.x + u.w / 2;
  const cy = u.y + u.h / 2;
  const x = Math.round(Math.min(Math.max(0, cx - wantW / 2), page.width - wantW));
  const y = Math.round(Math.min(Math.max(0, cy - wantH / 2), page.height - wantH));
  const w = Math.min(page.width - x, Math.round(wantW));
  const h = Math.min(page.height - y, Math.round(wantH));
  if ((w * h) / (page.width * page.height) > 1 - MIN_CROP_SAVING) return null;
  return { x, y, w, h };
}
