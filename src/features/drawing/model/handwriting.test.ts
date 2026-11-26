import { describe, expect, it } from 'vitest';
import type { DrawingElement, DrawingPoint } from '@/core/contracts';
import { STAMP_COLORS } from './constants';
import {
  canReadHandwriting, cleanReading, DIGIT_SHAPES, dominantColor, HANDWRITING_MAX_CHARS, handwritingStrokes, matchDigit,
  parseHandwritingReply, readingSourceLabel, readingWasShortened, recognizeDigits, splitGlyphs, strokePicturePage, textPlacement, tidyText,
} from './handwriting';
import type { StrokeElement } from './geometry';

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const stroke = (id: string, pts: Array<[number, number]>, extra: Partial<StrokeElement> = {}): StrokeElement => ({
  id, kind: 'stroke', tool: 'pen', color: '#112233', size: 4, points: pts.map(([x, y]) => ({ x, y })), ...extra,
});

/** A handwritten-looking copy of a digit: a little rotated, stretched and shaky, drawn with extra samples. */
function written(digit: string, at: { x: number; y: number; h: number }, r: () => number): StrokeElement[] {
  const rot = ((r() - 0.5) * 12 * Math.PI) / 180;
  const sx = 0.85 + r() * 0.4;
  return DIGIT_SHAPES[digit]!.map((s, n) => {
    const pts: DrawingPoint[] = [];
    s.forEach((p, i) => {
      const next = s[i + 1];
      pts.push(p);
      if (next) { pts.push({ x: p.x + (next.x - p.x) / 2, y: p.y + (next.y - p.y) / 2 }); }
    });
    return stroke(`${digit}${n}`, pts.map((p) => {
      const x = p.x * sx + (r() - 0.5) * 0.02; const y = p.y + (r() - 0.5) * 0.02;
      const rx = x * Math.cos(rot) - y * Math.sin(rot); const ry = x * Math.sin(rot) + y * Math.cos(rot);
      return [at.x + rx * at.h, at.y + ry * at.h] as [number, number];
    }));
  });
}

describe('which strokes can be read', () => {
  it('keeps visible, unlocked pen and marker strokes with more than one point', () => {
    const els: DrawingElement[] = [
      stroke('a', [[0, 0], [10, 10]]),
      stroke('hl', [[0, 0], [10, 10]], { tool: 'highlighter' }),
      stroke('lock', [[0, 0], [10, 10]], { locked: true }),
      stroke('hid', [[0, 0], [10, 10]], { hidden: true }),
      stroke('dot', [[5, 5]]),
      { id: 'r', kind: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000000', size: 2 },
    ];
    expect(handwritingStrokes(els).map((s) => s.id)).toEqual(['a']);
    expect(canReadHandwriting(els)).toBe(true);
    expect(canReadHandwriting([els[5]!])).toBe(false);
  });

  it('refuses a selection with too many strokes to send', () => {
    const many = Array.from({ length: 121 }, (_, i) => stroke(`s${i}`, [[0, 0], [5, 5]]));
    expect(canReadHandwriting(many)).toBe(false);
  });
});

describe('the picture of the writing', () => {
  it('moves the strokes to the corner on a plain page in plain ink, and leaves the originals alone', () => {
    const original = stroke('a', [[300, 500], [340, 520]], { color: '#ff0000', tool: 'marker', locked: undefined });
    const page = strokePicturePage([original]);
    expect(page.elements).toHaveLength(1);
    const el = page.elements[0] as StrokeElement;
    expect(el.color).toBe(STAMP_COLORS.ink);
    expect(el.tool).toBe('pen');
    expect(Math.min(...el.points.map((p) => p.x))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...el.points.map((p) => p.y))).toBeGreaterThanOrEqual(0);
    expect(page.width).toBeLessThan(150);
    expect(original.points[0]).toEqual({ x: 300, y: 500 });
    expect(original.color).toBe('#ff0000');
  });
});

describe('where the typed text goes', () => {
  it('starts at the writing, sizes to its height, and stays within the font limits', () => {
    const one = textPlacement([stroke('a', [[100, 200], [180, 240]])], 'Milk');
    expect(one.x).toBeLessThanOrEqual(100);
    expect(one.y).toBeLessThanOrEqual(200);
    expect(one.fontSize).toBeGreaterThanOrEqual(12);
    const huge = textPlacement([stroke('b', [[0, 0], [10, 2000]])], 'x');
    expect(huge.fontSize).toBeLessThanOrEqual(160);
    const two = textPlacement([stroke('c', [[0, 0], [10, 100]])], 'a\nb');
    const single = textPlacement([stroke('c', [[0, 0], [10, 100]])], 'a');
    expect(two.fontSize).toBeLessThan(single.fontSize);
  });

  it('keeps the most used stroke colour', () => {
    expect(dominantColor([stroke('a', [[0, 0], [1, 1], [2, 2]], { color: '#aa0000' }), stroke('b', [[0, 0], [1, 1]], { color: '#00aa00' })])).toBe('#aa0000');
  });
});

describe('tidying a reading', () => {
  it('collapses blanks, drops control characters and caps the length', () => {
    expect(cleanReading('  Total   price \u0007 \n\n  120  ')).toBe('Total price\n120');
    expect(cleanReading('x'.repeat(500))).toHaveLength(HANDWRITING_MAX_CHARS);
    expect(cleanReading('a\nb\nc\nd\ne\nf\ng\nh').split('\n')).toHaveLength(6);
  });

  it('keeps Hindi and Tamil text whole', () => {
    expect(cleanReading('कुल  रक़म')).toBe('कुल रक़म'.normalize('NFC'));
    expect(cleanReading('மொத்தம்')).toBe('மொத்தம்');
  });

  it('tidies text the person typed without cutting any of it off', () => {
    expect(tidyText('  Total   price \u0007 \n\n  120  ')).toBe('Total price\n120');
    const long = 'x'.repeat(HANDWRITING_MAX_CHARS + 150);
    expect(tidyText(long)).toBe(long);
    expect(tidyText('a\nb\nc\nd\ne\nf\ng\nh').split('\n')).toHaveLength(8);
  });

  it('knows when a model reading had to be shortened, so the screen can say so', () => {
    expect(readingWasShortened('Rice 2 kg')).toBe(false);
    expect(readingWasShortened('x'.repeat(HANDWRITING_MAX_CHARS))).toBe(false);
    expect(readingWasShortened('x'.repeat(HANDWRITING_MAX_CHARS + 1))).toBe(true);
    expect(readingWasShortened('a\nb\nc\nd\ne\nf\ng')).toBe(true);
    expect(readingWasShortened('a\nb\nc\nd\ne\nf')).toBe(false);
  });
});

describe('the reply', () => {
  it('accepts text with or without the unsure flag and rejects anything else', () => {
    expect(parseHandwritingReply({ text: 'Rice 2 kg' })).toEqual({ success: true, data: { text: 'Rice 2 kg' } });
    expect(parseHandwritingReply({ text: 'Rice', unsure: true }).success).toBe(true);
    expect(parseHandwritingReply({ unsure: true }).success).toBe(false);
    expect(parseHandwritingReply('Rice').success).toBe(false);
    expect(parseHandwritingReply({ text: 5 }).success).toBe(false);
  });

  it('names the source honestly', () => {
    expect(readingSourceLabel('deterministic')).toMatch(/this device/i);
    expect(readingSourceLabel('on_device')).toMatch(/Gemini Nano/);
    expect(readingSourceLabel('cloud')).toMatch(/cloud/i);
    expect(readingSourceLabel('cloud')).toMatch(/sent/i);
    expect(readingSourceLabel('on_device')).toMatch(/nothing was sent/i);
  });
});

describe('reading handwritten digits with no model', () => {
  it('matches each digit when it is written a little differently every time', () => {
    const r = rng(11);
    for (const digit of Object.keys(DIGIT_SHAPES)) {
      for (let k = 0; k < 6; k++) {
        const glyph = written(digit, { x: 100, y: 100, h: 80 }, r);
        const m = matchDigit(glyph.map((s) => s.points));
        expect(m?.digit, `digit ${digit} try ${k}`).toBe(digit);
      }
    }
  });

  it('reads a number written left to right', () => {
    const r = rng(5);
    const strokes = [...written('4', { x: 40, y: 100, h: 60 }, r), ...written('2', { x: 120, y: 100, h: 60 }, r), ...written('7', { x: 200, y: 100, h: 60 }, r)];
    expect(splitGlyphs(strokes)).toHaveLength(3);
    expect(recognizeDigits(strokes)?.text).toBe('427');
  });

  it('keeps two strokes of one digit together', () => {
    const strokes = written('4', { x: 40, y: 100, h: 60 }, rng(2));
    expect(strokes.length).toBe(2);
    expect(splitGlyphs(strokes)).toHaveLength(1);
  });

  it('gives up on writing that is not digits, so the AI step can try', () => {
    const letterL = [stroke('l', [[0, 0], [0, 50], [30, 50]])];
    const zigzag = [stroke('z', [[0, 0], [20, 60], [40, 0], [60, 60], [80, 0]])];
    const crossbar = [stroke('t1', [[0, 0], [60, 0]]), stroke('t2', [[30, 0], [30, 70]])];
    expect(recognizeDigits(letterL)).toBeUndefined();
    expect(recognizeDigits(zigzag)).toBeUndefined();
    expect(recognizeDigits(crossbar)).toBeUndefined();
    expect(recognizeDigits([])).toBeUndefined();
  });

  it('reads letters that look like digits as digits, which is why the screen offers the AI instead', () => {
    // O, I, S and Z have the same shapes as 0, 1, 8 and 2. No shape matcher can tell them apart, so the sheet
    // says so and offers "Read it with AI instead". The claim for this step is digits, not letters.
    const arc = (cx: number, cy: number, rx: number, ry: number, from: number, to: number, n = 24): Array<[number, number]> =>
      Array.from({ length: n + 1 }, (_, i) => {
        const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
        return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
      });
    const letterO = [stroke('o', arc(30, 50, 28, 50, -90, 270))];
    const letterI = [stroke('i', [[30, 0], [30, 25], [30, 50], [30, 75], [30, 100]])];
    const letterZ = [stroke('z', [[0, 0], [30, 0], [60, 0], [30, 50], [0, 100], [30, 100], [60, 100]])];
    expect(recognizeDigits(letterO)?.text).toBe('0');
    expect(recognizeDigits(letterI)?.text).toBe('1');
    expect(recognizeDigits(letterZ)?.text).toBe('2');
  });

  it('gives up on a letter drawn with several crossing strokes', () => {
    const letterH = [stroke('h1', [[0, 0], [0, 100]]), stroke('h2', [[50, 0], [50, 100]]), stroke('h3', [[0, 50], [50, 50]])];
    expect(recognizeDigits(letterH)).toBeUndefined();
  });

  it('gives up when one glyph is far taller than the rest', () => {
    const r = rng(9);
    const strokes = [...written('4', { x: 40, y: 100, h: 140 }, r), ...written('2', { x: 140, y: 100, h: 40 }, r)];
    expect(recognizeDigits(strokes)).toBeUndefined();
  });
});
