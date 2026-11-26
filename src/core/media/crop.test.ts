import { describe, expect, it } from 'vitest';
import { cropPixels, dragCrop, isWholePicture, MIN_CROP, nudgeCrop, WHOLE_PICTURE, type CropHandle, type CropRect } from './crop';

const box: CropRect = { x: 0.2, y: 0.2, w: 0.5, h: 0.4 };
const near = (a: CropRect, b: CropRect) => (['x', 'y', 'w', 'h'] as const).forEach((k) => expect(a[k]).toBeCloseTo(b[k], 6));

describe('crop box', () => {
  it('moves without leaving the picture or changing size', () => {
    near(dragCrop(box, 'move', 0.1, -0.05), { x: 0.3, y: 0.15, w: 0.5, h: 0.4 });
    near(dragCrop(box, 'move', 5, 5), { x: 0.5, y: 0.6, w: 0.5, h: 0.4 });
    near(dragCrop(box, 'move', -5, -5), { x: 0, y: 0, w: 0.5, h: 0.4 });
  });

  it('resizes from an edge or a corner, with the opposite side staying put', () => {
    near(dragCrop(box, 'e', 0.1, 0.3), { x: 0.2, y: 0.2, w: 0.6, h: 0.4 });
    near(dragCrop(box, 'w', 0.1, 0.3), { x: 0.3, y: 0.2, w: 0.4, h: 0.4 });
    near(dragCrop(box, 'n', 0.3, -0.1), { x: 0.2, y: 0.1, w: 0.5, h: 0.5 });
    near(dragCrop(box, 's', 0.3, 0.1), { x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
    near(dragCrop(box, 'nw', -0.1, -0.1), { x: 0.1, y: 0.1, w: 0.6, h: 0.5 });
    near(dragCrop(box, 'se', 0.1, 0.1), { x: 0.2, y: 0.2, w: 0.6, h: 0.5 });
    near(dragCrop(box, 'ne', 0.1, -0.1), { x: 0.2, y: 0.1, w: 0.6, h: 0.5 });
    near(dragCrop(box, 'sw', -0.1, 0.1), { x: 0.1, y: 0.2, w: 0.6, h: 0.5 });
  });

  it('never goes outside the picture or thinner than the smallest box, whichever way it is dragged', () => {
    const handles: CropHandle[] = ['move', 'n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
    for (const h of handles) {
      for (const [dx, dy] of [[9, 9], [-9, -9], [9, -9], [-9, 9], [0, 0]] as const) {
        const r = dragCrop(box, h, dx, dy);
        expect(r.x).toBeGreaterThanOrEqual(-1e-9);
        expect(r.y).toBeGreaterThanOrEqual(-1e-9);
        expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
        expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
        expect(r.w).toBeGreaterThanOrEqual(Math.min(box.w, MIN_CROP) - 1e-9);
        expect(r.h).toBeGreaterThanOrEqual(Math.min(box.h, MIN_CROP) - 1e-9);
      }
    }
    near(dragCrop(box, 'e', -9, 0), { x: 0.2, y: 0.2, w: MIN_CROP, h: 0.4 });
  });

  it('answers arrow keys, and Shift resizes instead of moving', () => {
    near(nudgeCrop(box, 'ArrowRight', false), { ...box, x: 0.22 });
    near(nudgeCrop(box, 'ArrowUp', false), { ...box, y: 0.18 });
    near(nudgeCrop(box, 'ArrowRight', true), { ...box, w: 0.52 });
    near(nudgeCrop(box, 'ArrowUp', true), { ...box, h: 0.38 });
    near(nudgeCrop(WHOLE_PICTURE, 'ArrowRight', false), WHOLE_PICTURE);
  });

  it('knows when nothing is cropped', () => {
    expect(isWholePicture(WHOLE_PICTURE)).toBe(true);
    expect(isWholePicture(dragCrop(WHOLE_PICTURE, 'w', 0.05, 0))).toBe(false);
  });
});

describe('pixels to cut', () => {
  it('turns the box into whole pixels inside the picture', () => {
    expect(cropPixels(box, 4000, 3000)).toEqual({ originX: 800, originY: 600, width: 2000, height: 1200 });
    expect(cropPixels(WHOLE_PICTURE, 640, 480)).toEqual({ originX: 0, originY: 0, width: 640, height: 480 });
    expect(cropPixels({ x: 0.999, y: 0.999, w: 0.5, h: 0.5 }, 100, 100)).toEqual({ originX: 100 - 1, originY: 99, width: 1, height: 1 });
    expect(cropPixels({ x: 0, y: 0, w: 0.001, h: 0.001 }, 100, 100)).toEqual({ originX: 0, originY: 0, width: 1, height: 1 });
  });

  it('copes with a one pixel picture', () => {
    expect(cropPixels(box, 1, 1)).toEqual({ originX: 0, originY: 0, width: 1, height: 1 });
  });
});
