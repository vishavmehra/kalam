import { describe, expect, it } from 'vitest';

import { sheetPanelStyle } from './sheet-motion';

const shape = (s: ReturnType<typeof sheetPanelStyle>) => [Object.keys(s), s.transform.map((t) => Object.keys(t)[0])];

describe('sheetPanelStyle', () => {
  it('sets the same keys in every branch, so switching reduced motion leaves no stale offset', () => {
    const all = [false, true].flatMap((reduced) => [false, true].map((desk) => sheetPanelStyle(0, 480, reduced, desk)));
    for (const s of all) expect(shape(s)).toEqual(shape(all[0]!));
  });

  it('rests on screen when shown, whatever the mode', () => {
    for (const reduced of [false, true]) {
      for (const desk of [false, true]) {
        const s = sheetPanelStyle(1, 480, reduced, desk);
        expect(s.opacity).toBe(1);
        expect(s.transform).toEqual([{ translateY: 0 }, { scale: 1 }]);
      }
    }
  });

  it('slides up from its own height on phones', () => {
    expect(sheetPanelStyle(0, 500, false, false).transform[0]).toEqual({ translateY: 500 });
  });
});
