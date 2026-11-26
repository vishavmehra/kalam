/**
 * Crop box geometry for the web cropper (docs/06 §7.3). The box is kept as fractions of the picture, so it
 * does not matter how large the picture is drawn. Pure TypeScript: the screen only turns pointer moves and
 * arrow keys into these calls, and `cropPixels` turns the box into the pixels to cut.
 */

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

/** The smallest side of the box, as a fraction of the picture's side. */
export const MIN_CROP = 0.08;
export const WHOLE_PICTURE: CropRect = { x: 0, y: 0, w: 1, h: 1 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Moves the box, or one edge or corner of it, by (dx, dy) fractions. The box never leaves the picture or gets thinner than MIN_CROP. */
export function dragCrop(r: CropRect, handle: CropHandle, dx: number, dy: number): CropRect {
  if (handle === 'move') return { ...r, x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h) };
  let left = r.x;
  let top = r.y;
  let right = r.x + r.w;
  let bottom = r.y + r.h;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - MIN_CROP);
  if (handle.includes('e')) right = clamp(right + dx, left + MIN_CROP, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - MIN_CROP);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + MIN_CROP, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export type CropKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
const ARROW: Record<CropKey, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Arrow keys move the box; with Shift they resize it from its bottom right corner. */
export function nudgeCrop(r: CropRect, key: CropKey, resize: boolean, step = 0.02): CropRect {
  const [x, y] = ARROW[key];
  return dragCrop(r, resize ? 'se' : 'move', x * step, y * step);
}

export const isWholePicture = (r: CropRect) => r.x <= 0.0005 && r.y <= 0.0005 && r.w >= 0.999 && r.h >= 0.999;

/** The pixels to cut from a picture of `width` x `height`: whole numbers, inside the picture, at least one pixel. */
export function cropPixels(r: CropRect, width: number, height: number): { originX: number; originY: number; width: number; height: number } {
  const originX = clamp(Math.round(r.x * width), 0, Math.max(0, width - 1));
  const originY = clamp(Math.round(r.y * height), 0, Math.max(0, height - 1));
  return {
    originX,
    originY,
    width: clamp(Math.round(r.w * width), 1, Math.max(1, width - originX)),
    height: clamp(Math.round(r.h * height), 1, Math.max(1, height - originY)),
  };
}
