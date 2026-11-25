import { afterEach, describe, expect, it, vi } from 'vitest';

import { LANGUAGE_CODES } from './languages';
import { fallbackPluralCategory, pluralCategory, resetPluralCache } from './plural';

describe('plural categories', () => {
  it('English: only exactly 1 is singular', () => {
    expect(pluralCategory('en', 1)).toBe('one');
    expect(pluralCategory('en', 0)).toBe('other');
    expect(pluralCategory('en', 2)).toBe('other');
    expect(pluralCategory('en', 1.5)).toBe('other');
  });

  it('Hindi, Bengali, Gujarati and Kannada treat 0 and 1 as singular', () => {
    for (const lang of ['hi', 'bn', 'gu', 'kn']) {
      expect(pluralCategory(lang, 0)).toBe('one');
      expect(pluralCategory(lang, 1)).toBe('one');
      expect(pluralCategory(lang, 2)).toBe('other');
    }
  });

  it('Marathi, Tamil, Telugu and Malayalam: only 1 is singular', () => {
    for (const lang of ['mr', 'ta', 'te', 'ml']) {
      expect(pluralCategory(lang, 1)).toBe('one');
      expect(pluralCategory(lang, 0)).toBe('other');
      expect(pluralCategory(lang, 5)).toBe('other');
    }
  });

  it('Punjabi: 0 and 1 are singular', () => {
    expect(pluralCategory('pa', 0)).toBe('one');
    expect(pluralCategory('pa', 1)).toBe('one');
    expect(pluralCategory('pa', 2)).toBe('other');
  });

  it('negative counts use the absolute value and non-finite counts use "other"', () => {
    expect(pluralCategory('en', -1)).toBe('one');
    expect(pluralCategory('en', Number.NaN)).toBe('other');
    expect(pluralCategory('hi', Number.POSITIVE_INFINITY)).toBe('other');
  });

  it('the built-in rules agree with Intl.PluralRules for every shipped language', () => {
    const counts = [...Array.from({ length: 121 }, (_, i) => i), 1000, 100000, 0.5, 1.5, 2.5];
    for (const lang of LANGUAGE_CODES) {
      const intl = new Intl.PluralRules(lang);
      for (const n of counts) {
        expect(fallbackPluralCategory(lang, n), `${lang} ${n}`).toBe(intl.select(n));
      }
    }
  });

  describe('when the runtime has no plural data', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      resetPluralCache();
    });

    it('falls back to the built-in rules', () => {
      resetPluralCache();
      vi.spyOn(Intl.PluralRules, 'supportedLocalesOf').mockReturnValue([]);
      expect(pluralCategory('hi', 0)).toBe('one');
      expect(pluralCategory('ta', 0)).toBe('other');
      expect(pluralCategory('en', 1)).toBe('one');
    });
  });
});
