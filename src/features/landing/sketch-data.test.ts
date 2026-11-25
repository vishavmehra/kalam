import { describe, expect, it } from 'vitest';

import { buildSketch, DRAW_SECONDS, inkWidths, ribbon, strokeCenterPath, strokeOutlinePath } from './sketch-data';

describe('onboarding sketch data', () => {
  const strokes = buildSketch();

  it('is deterministic and timed sequentially within the drawing phase', () => {
    expect(buildSketch()).toBe(strokes);
    expect(strokes.length).toBeGreaterThan(30);
    for (let i = 1; i < strokes.length; i++) expect(strokes[i].start).toBeGreaterThanOrEqual(strokes[i - 1].start + strokes[i - 1].duration - 1e-9);
    const last = strokes[strokes.length - 1];
    expect(last.start + last.duration).toBeLessThanOrEqual(DRAW_SECONDS + 1e-6);
    expect(last.color).toBe('accent');
  });

  it('produces finite geometry and well-formed SVG paths', () => {
    for (const s of strokes) {
      expect(s.points.length).toBeGreaterThan(1);
      const { left, right } = ribbon(s);
      expect(left.length).toBe(s.points.length);
      expect(right.length).toBe(s.points.length);
      expect(inkWidths(s).every((w) => w > 0 && w <= s.width)).toBe(true);
      expect(strokeOutlinePath(s)).toMatch(/^M[-\d. L]+Z$/);
      expect(strokeCenterPath(s)).not.toMatch(/NaN|Infinity/);
    }
  });
});
