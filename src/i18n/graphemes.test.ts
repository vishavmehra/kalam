import { describe, expect, it } from 'vitest';

import { graphemeCount, graphemes, graphemesFallback, truncateGraphemes } from './graphemes';

const SAMPLES = {
  hindi: 'किताब', // कि ता ब
  conjunct: 'क्षमा',
  tamil: 'குடும்பம்',
  bengali: 'বাংলা',
  decomposed: 'école',
};

describe('graphemes', () => {
  it('never splits a letter from its vowel sign or accent', () => {
    expect(graphemeCount('कि')).toBe(1);
    expect(graphemeCount('கு')).toBe(1);
    expect(graphemeCount('é')).toBe(1);
    expect(graphemeCount('abc')).toBe(3);
    expect(graphemeCount('')).toBe(0);
  });

  it('counts fewer than UTF-16 units for Indic text', () => {
    for (const text of Object.values(SAMPLES)) expect(graphemeCount(text), text).toBeLessThan(text.length);
  });

  it('the fallback keeps marks, joiners and virama clusters together', () => {
    expect(graphemesFallback('कि')).toEqual(['कि']);
    expect(graphemesFallback('क्षमा')).toEqual(['क्षमा'.slice(0, 3), 'मा']);
    expect(graphemesFallback('éc')).toEqual(['é', 'c']);
    expect(graphemesFallback('👨‍👩‍👧x')).toEqual(['👨‍👩‍👧', 'x']);
    expect(graphemesFallback('')).toEqual([]);
  });

  it('the fallback agrees with Intl.Segmenter on simple Indic text', () => {
    for (const text of ['किताब', 'বাংলা', 'ਪੰਜਾਬੀ', 'ಕನ್ನಡ'.slice(0, 2)]) {
      expect(graphemesFallback(text), text).toEqual(graphemes(text));
    }
  });
});

describe('truncateGraphemes', () => {
  it('keeps text that fits and cuts on a boundary otherwise', () => {
    expect(truncateGraphemes('hello', 10)).toBe('hello');
    expect(truncateGraphemes('hello', 3)).toBe('hel');
    expect(truncateGraphemes('किताब', 2)).toBe('किता');
    expect(truncateGraphemes('école', 1)).toBe('é');
    expect(truncateGraphemes('anything', 0)).toBe('');
  });

  it('never ends on a dangling mark', () => {
    for (const text of Object.values(SAMPLES)) {
      for (let max = 1; max <= graphemeCount(text); max++) {
        const cut = truncateGraphemes(text, max);
        expect(cut, `${text} ${max}`).toBe(graphemes(text).slice(0, max).join(''));
      }
    }
  });

  it('counts the ellipsis toward the limit', () => {
    const text = 'कितनी लंबी बात';
    expect(truncateGraphemes(text, 6, '…')).toBe(graphemes(text).slice(0, 5).join('') + '…');
    expect(graphemeCount(truncateGraphemes('कितनी लंबी बात', 6, '…'))).toBe(6);
  });
});
