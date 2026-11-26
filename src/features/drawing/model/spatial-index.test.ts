import { describe, expect, it } from 'vitest';
import type { DrawingElement, DrawingPage, DrawingPoint } from '@/core/contracts';
import {
  buildSpatialIndex, createPage, elementsInRect, elementsInRectFast, getSpatialIndex, hitTest, hitTestFast, pagePrimitives,
  pagePrimitivesIn, SPATIAL_MIN,
} from './index';

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A busy page: 500 mixed objects scattered over a 400 x 800 screen, strokes with many points. */
function busyPage(count = 500): DrawingPage {
  const r = rng(42);
  const elements: DrawingElement[] = [];
  for (let i = 0; i < count; i++) {
    const x = r() * 380; const y = r() * 780; const kind = i % 5;
    if (kind === 0) {
      const points: DrawingPoint[] = Array.from({ length: 60 }, (_, k) => ({ x: x + k * 0.5, y: y + Math.sin(k / 4) * 8 }));
      elements.push({ id: `s${i}`, kind: 'stroke', tool: 'pen', color: '#000000', size: 4, points });
    } else if (kind === 1) elements.push({ id: `r${i}`, kind: 'rect', x, y, w: 10 + r() * 40, h: 10 + r() * 30, color: '#000000', size: 2 });
    else if (kind === 2) elements.push({ id: `e${i}`, kind: 'ellipse', x, y, w: 12 + r() * 30, h: 12 + r() * 30, color: '#000000', size: 2, rotation: 30 });
    else if (kind === 3) elements.push({ id: `a${i}`, kind: 'arrow', x, y, w: r() * 60 - 30, h: r() * 60 - 30, color: '#000000', size: 3 });
    else elements.push({ id: `t${i}`, kind: 'text', x, y, text: 'Label', color: '#000000', fontSize: 16 });
  }
  return { ...createPage(0, 'pg_busy'), elements };
}

describe('spatial index', () => {
  it('finds the same object as a plain loop for every point of a grid, on a page of 500', () => {
    const page = busyPage();
    const different: string[] = [];
    for (let y = 0; y < 800; y += 21) {
      for (let x = 0; x < 400; x += 17) {
        if (hitTestFast(page, { x, y }, 8) !== hitTest(page, { x, y }, 8)) different.push(`${x},${y}`);
      }
    }
    expect(different).toEqual([]);
  }, 30_000);

  it('finds the same objects as a plain loop for marquee boxes', () => {
    const page = busyPage();
    const boxes = [{ x: 0, y: 0, w: 400, h: 800 }, { x: 50, y: 50, w: 100, h: 100 }, { x: 300, y: 700, w: 40, h: 40 }, { x: -50, y: -50, w: 60, h: 60 }];
    for (const b of boxes) expect(elementsInRectFast(page, b)).toEqual(elementsInRect(page, b));
  });

  it('skips hidden objects and returns the topmost first', () => {
    const a: DrawingElement = { id: 'under', kind: 'rect', x: 100, y: 100, w: 60, h: 60, color: '#000000', size: 2 };
    const b: DrawingElement = { id: 'over', kind: 'rect', x: 110, y: 110, w: 60, h: 60, color: '#000000', size: 2 };
    const padded = { ...createPage(0, 'pg_x'), elements: [...busyPage(60).elements, a, b] };
    expect(padded.elements.length).toBeGreaterThanOrEqual(SPATIAL_MIN);
    expect(hitTestFast(padded, { x: 130, y: 130 })).toBe('over');
    const hidden = { ...padded, elements: padded.elements.map((e) => (e.id === 'over' ? { ...e, hidden: true } : e)) };
    expect(hitTestFast(hidden, { x: 130, y: 130 })).toBe(hitTest(hidden, { x: 130, y: 130 }));
  });

  it('reuses one index while the elements array is the same', () => {
    const page = busyPage(80);
    expect(getSpatialIndex(page.elements)).toBe(getSpatialIndex(page.elements));
    expect(getSpatialIndex([...page.elements])).not.toBe(getSpatialIndex(page.elements));
  });

  it('keeps very large objects findable', () => {
    const els: DrawingElement[] = [
      { id: 'huge', kind: 'rect', x: -5000, y: -5000, w: 10_000, h: 10_000, color: '#000000', size: 2 },
      ...busyPage(60).elements,
    ];
    expect(buildSpatialIndex(els).query({ x: 200, y: 400, w: 1, h: 1 })).toContain(0);
  });

  it('work: 500 objects, 1500 hit tests, and what a zoomed-in view has to draw', () => {
    const page = busyPage();
    const r = rng(7);
    const points = Array.from({ length: 1500 }, () => ({ x: r() * 400, y: r() * 800 }));
    getSpatialIndex(page.elements); // built once per edit, not per query

    let slow = 0;
    for (const p of points) if (hitTest(page, p, 8)) slow += 1;
    let fast = 0;
    for (const p of points) if (hitTestFast(page, p, 8)) fast += 1;
    expect(fast).toBe(slow);
    // Work done, counted rather than timed (timing flakes on a busy machine): a point query looks at a handful of objects, not all 500.
    const candidates = points.slice(0, 500).map((p) => getSpatialIndex(page.elements).query({ x: p.x - 8, y: p.y - 8, w: 16, h: 16 }).length);
    const avg = candidates.reduce((m, c) => m + c, 0) / candidates.length;
    expect(avg).toBeLessThan(25);

    // Zoomed to a quarter of the page, only the objects in view are drawn.
    const all = pagePrimitives(page).length;
    const view = pagePrimitivesIn(page, { x: 0, y: 0, w: 100, h: 200 }).length;
    expect(view).toBeLessThan(all * 0.4);
    expect(pagePrimitivesIn(page, { x: -10, y: -10, w: 500, h: 900 }).length).toBe(all);
  }, 30_000);
});
