import { describe, expect, it } from 'vitest';

import type { DrawingDocument, DrawingElement, DrawingPage } from '@/core/contracts';

import { CROP_PADDING, contentCrop, MIN_CROP_SIDE } from './crop';
import { findSensitive, luhnValid, sensitiveKindsIn } from './sensitive';

const page = (elements: DrawingElement[], width = 1000, height = 1600): DrawingPage => ({ id: 'p1', title: 'Screen 1', width, height, elements } as DrawingPage);
const rect = (x: number, y: number, w: number, h: number, extra: Partial<DrawingElement> = {}): DrawingElement => ({ id: `r${x}${y}`, kind: 'rect', x, y, w, h, color: '#000000', size: 2, ...extra }) as DrawingElement;
const text = (t: string, extra: Partial<DrawingElement> = {}): DrawingElement => ({ id: `t${t.length}`, kind: 'text', x: 10, y: 10, text: t, color: '#000000', fontSize: 16, ...extra }) as DrawingElement;
const doc = (...elements: DrawingElement[]): Pick<DrawingDocument, 'pages'> => ({ pages: [page(elements)] });

describe('crop to content (D11-029)', () => {
  it('crops to the drawing plus a margin and stays inside the page', () => {
    const c = contentCrop(page([rect(400, 600, 200, 300)]))!;
    expect(c).toEqual({ x: 400 - CROP_PADDING, y: 600 - CROP_PADDING, w: 200 + CROP_PADDING * 2, h: 300 + CROP_PADDING * 2 });
    const edge = contentCrop(page([rect(0, 0, 300, 300)]))!;
    expect(edge.x).toBe(0);
    expect(edge.y).toBe(0);
    expect(edge.x + edge.w).toBeLessThanOrEqual(1000);
  });

  it('keeps a minimum picture so a single small mark still has context', () => {
    const c = contentCrop(page([rect(500, 800, 10, 10)]))!;
    expect(c.w).toBeGreaterThanOrEqual(MIN_CROP_SIDE);
    expect(c.h).toBeGreaterThanOrEqual(MIN_CROP_SIDE);
  });

  it('never counts hidden objects, and has nothing to crop on an empty screen', () => {
    expect(contentCrop(page([]))).toBeNull();
    expect(contentCrop(page([rect(10, 10, 50, 50, { hidden: true })]))).toBeNull();
    const c = contentCrop(page([rect(400, 600, 100, 100), rect(0, 0, 1000, 1600, { hidden: true })]))!;
    expect(c.w).toBeLessThan(400);
  });

  it('sends the whole screen when cropping would save very little', () => {
    expect(contentCrop(page([rect(10, 10, 980, 1580)]))).toBeNull();
  });

  it('includes a rotated object by its turned outline', () => {
    const c = contentCrop(page([rect(480, 700, 40, 400, { rotation: 90 })]))!;
    expect(c.w).toBeGreaterThan(400);
  });
});

describe('private details in a drawing (D11-029)', () => {
  it('passes the Luhn check only for real card numbers', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
    expect(luhnValid('123')).toBe(false);
  });

  it('names each kind it recognises', () => {
    expect(sensitiveKindsIn('Card 4111 1111 1111 1111')).toEqual(['card']);
    expect(sensitiveKindsIn('Aadhaar 2345 6789 0123')).toEqual(['id']);
    expect(sensitiveKindsIn('PAN ABCDE1234F')).toEqual(['id']);
    expect(sensitiveKindsIn('Call 98210 45367')).toEqual(['phone']);
    expect(sensitiveKindsIn('9821045367')).toEqual(['phone']);
    expect(sensitiveKindsIn('mail me at sunita@example.com')).toEqual(['email']);
    expect(sensitiveKindsIn('wifi password: tiger')).toEqual(['secret']);
    expect(sensitiveKindsIn('ओटीपी 4821')).toEqual(['secret']);
  });

  it('leaves ordinary drawings alone', () => {
    for (const t of ['Total: 850', 'Order 0417', 'Home screen', 'Rent due 5 Dec', '2026', 'pinch to zoom', 'spinning']) {
      expect(sensitiveKindsIn(t), t).toEqual([]);
    }
  });

  it('reads only visible text objects and returns kinds in a fixed order, never values', () => {
    const found = findSensitive(doc(text('sunita@example.com'), text('call 9821045367'), text('password: x', { hidden: true }), rect(0, 0, 10, 10)));
    expect(found).toEqual(['phone', 'email']);
    expect(JSON.stringify(found)).not.toContain('sunita');
  });

  it('finds details on any screen of the drawing', () => {
    const d: Pick<DrawingDocument, 'pages'> = { pages: [page([text('hello')]), page([text('4111111111111111')])] };
    expect(findSensitive(d)).toEqual(['card']);
  });
});
