import { describe, expect, it } from 'vitest';

import { palette } from '@/design/tokens';
import { DEFAULT_PAGE_COLOR, INK_COLORS, PAGE_COLORS, SELECTION_COLORS, STAMP_COLORS } from './constants';

const HEX6 = /^#[0-9a-f]{6}$/i;

describe('Drawing Studio colours', () => {
  it('offers distinct, valid pen and page colours from the Khata and Kalam palette', () => {
    for (const list of [INK_COLORS, PAGE_COLORS]) {
      expect(new Set(list.map((c) => c.value.toLowerCase())).size).toBe(list.length);
      for (const c of list) {
        expect(c.value, c.name).toMatch(HEX6);
        expect(c.name.length, c.value).toBeGreaterThan(0);
      }
    }
    expect(INK_COLORS[0]!.value).toBe(palette.paper.ink);
    expect(PAGE_COLORS[0]!.value).toBe(DEFAULT_PAGE_COLOR);
  });

  it('keeps no colour from the earlier Ink and Marigold direction', () => {
    const old = new Set(Object.values(palette.brand).map((v) => v.toLowerCase()));
    const used = [...INK_COLORS, ...PAGE_COLORS].map((c) => c.value.toLowerCase()).concat(
      Object.values(STAMP_COLORS).map((v) => v.toLowerCase()), SELECTION_COLORS.line.toLowerCase(),
    );
    expect(used.filter((v) => old.has(v))).toEqual([]);
  });

  it('draws selection in royal ink', () => {
    expect(SELECTION_COLORS.line).toBe(palette.paper.royal);
  });
});
