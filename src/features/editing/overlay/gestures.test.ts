import { describe, expect, it } from 'vitest';
import { classifyStroke, combineStrokes, type InkPoint, type MarkGesture } from './gestures';
import { resample, pathLength } from './geometry';

/** Straight run of points from a to b (inclusive). */
const run = (a: [number, number], b: [number, number], n = 20): InkPoint[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: a[0] + ((b[0] - a[0]) * i) / n, y: a[1] + ((b[1] - a[1]) * i) / n }));
const path = (...corners: Array<[number, number]>): InkPoint[] =>
  corners.slice(1).flatMap((c, i) => run(corners[i] as [number, number], c).slice(i === 0 ? 0 : 1));
/** Ellipse from angle a0 to a1 (radians), with a little hand wobble. */
const ellipse = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 60): InkPoint[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    const wobble = 1 + 0.03 * Math.sin(i * 1.7);
    return { x: cx + rx * wobble * Math.cos(a), y: cy + ry * wobble * Math.sin(a) };
  });

describe('classifyStroke', () => {
  it('a short dab is a tap at its centre', () => {
    expect(classifyStroke([{ x: 100, y: 100 }, { x: 102, y: 101 }, { x: 101, y: 103 }])).toEqual({ kind: 'tap', at: { x: 101, y: 101.5 } });
  });

  it('a closed loop is a circle, even a squashed one around a wide button', () => {
    expect(classifyStroke(ellipse(200, 300, 120, 45, 0, Math.PI * 2)).kind).toBe('circle');
    expect(classifyStroke(ellipse(200, 300, 180, 26, -0.3, Math.PI * 2 - 0.2)).kind).toBe('circle');
  });

  it('a loop that stops short (about 300°) still counts as a circle', () => {
    expect(classifyStroke(ellipse(200, 300, 80, 60, 0, (Math.PI * 2 * 300) / 360)).kind).toBe('circle');
  });

  it('half a loop is a free stroke, not a circle', () => {
    expect(classifyStroke(ellipse(200, 300, 80, 60, 0, Math.PI)).kind).toBe('free');
  });

  it('a straight stroke is a line with its start and end', () => {
    const g = classifyStroke(run([50, 100], [250, 106]));
    expect(g).toMatchObject({ kind: 'line', from: { x: 50, y: 100 }, to: { x: 250, y: 106 } });
  });

  it('a shaft with a hook back at the end is an arrow pointing at the hook', () => {
    const g = classifyStroke(path([50, 300], [50, 100], [38, 116], [50, 100], [62, 116]));
    expect(g).toEqual({ kind: 'arrow', from: { x: 50, y: 300 }, to: { x: 50, y: 100 } });
  });

  it('an L or a V is not an arrow', () => {
    expect(classifyStroke(path([50, 100], [50, 250], [200, 250])).kind).toBe('free');
    expect(classifyStroke(path([50, 100], [120, 250], [190, 100])).kind).toBe('free');
  });

  it('a dense back-and-forth is a scribble', () => {
    const zigzag: Array<[number, number]> = [];
    for (let i = 0; i < 9; i++) zigzag.push([i % 2 ? 180 : 100, 100 + i * 5]);
    expect(classifyStroke(path(...zigzag)).kind).toBe('scribble');
  });

  it('ignores non-finite points and repeated samples', () => {
    expect(classifyStroke([{ x: Number.NaN, y: 1 }, { x: 5, y: 5 }, { x: 5, y: 5 }]).kind).toBe('tap');
    expect(classifyStroke([])).toEqual({ kind: 'tap', at: { x: 0, y: 0 } });
  });
});

describe('combineStrokes', () => {
  const line = (a: [number, number], b: [number, number]) => classifyStroke(run(a, b)) as MarkGesture;

  it('two lines crossing in their middles make a cross at the crossing point', () => {
    const g = combineStrokes(line([100, 100], [200, 200]), classifyStroke(run([200, 100], [100, 200])));
    expect(g?.kind).toBe('cross');
    if (g?.kind === 'cross') {
      expect(g.at.x).toBeCloseTo(150);
      expect(g.at.y).toBeCloseTo(150);
    }
  });

  it('nearly parallel lines do not make a cross', () => {
    expect(combineStrokes(line([100, 100], [300, 110]), classifyStroke(run([100, 112], [300, 98])))).toBeUndefined();
  });

  it('a small V at one end of a line makes it an arrow pointing there', () => {
    const shaft = line([50, 300], [50, 100]);
    const head = classifyStroke(path([38, 116], [50, 100], [62, 116]));
    expect(combineStrokes(shaft, head)).toEqual({ kind: 'arrow', from: { x: 50, y: 300 }, to: { x: 50, y: 100 } });
    const backwards = classifyStroke(path([38, 284], [50, 300], [62, 284]));
    expect(combineStrokes(shaft, backwards)).toEqual({ kind: 'arrow', from: { x: 50, y: 100 }, to: { x: 50, y: 300 } });
  });

  it('a short barb line touching the tip is a head, not a cross', () => {
    const g = combineStrokes(line([50, 100], [250, 100]), classifyStroke(run([250, 100], [234, 90])));
    expect(g).toEqual({ kind: 'arrow', from: { x: 50, y: 100 }, to: { x: 250, y: 100 } });
  });

  it('a second barb keeps the arrow; a far stroke starts a new mark', () => {
    const arrow: MarkGesture = { kind: 'arrow', from: { x: 50, y: 100 }, to: { x: 250, y: 100 } };
    expect(combineStrokes(arrow, classifyStroke(run([250, 100], [234, 110])))).toBe(arrow);
    expect(combineStrokes(arrow, classifyStroke(ellipse(600, 600, 40, 30, 0, Math.PI * 2)))).toBeUndefined();
  });
});

describe('resample', () => {
  it('spreads points evenly along the path', () => {
    const pts = resample(run([0, 0], [100, 0], 3), 11);
    expect(pts).toHaveLength(11);
    expect(pts[5]?.x).toBeCloseTo(50);
    expect(pathLength(pts)).toBeCloseTo(100);
  });
});
