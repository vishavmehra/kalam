import { afterEach, describe, expect, it, vi } from 'vitest';

import { setActiveLanguage } from '@/i18n/active';
import { loadCatalogue } from '@/i18n/catalogue';
import { LANGUAGE_CODES } from '@/i18n/languages';

import { countLabel, formatLatency, relativeTime } from './format';

afterEach(() => {
  setActiveLanguage('en');
  vi.unstubAllGlobals();
});

/** Intl without RelativeTimeFormat, as on some Hermes builds: relativeTime must fall back to the `time.*` keys. */
function withoutRelativeTimeFormat(): void {
  vi.stubGlobal('Intl', Object.create(Intl, { RelativeTimeFormat: { value: undefined } }));
}

describe('format helpers', () => {
  it('uses plural rules for counts', () => {
    expect(countLabel(1, 'app', 'apps')).toBe('1 app');
    expect(countLabel(0, 'app', 'apps')).toBe('0 apps');
    expect(countLabel(1200, 'app', 'apps')).toBe('1,200 apps');
  });

  it('says relative times in words, then a date', () => {
    const now = Date.UTC(2026, 10, 25, 12);
    expect(relativeTime(now - 5_000, now)).toBe('Just now');
    expect(relativeTime(now - 5 * 60_000, now)).toMatch(/5 min/);
    expect(relativeTime(now - 40 * 86_400_000, now)).toMatch(/Oct/);
  });

  it('says relative times in Kalam\'s language through the catalogue', async () => {
    await loadCatalogue('hi');
    setActiveLanguage('hi');
    withoutRelativeTimeFormat();
    const now = Date.UTC(2026, 10, 25, 12);
    expect(relativeTime(now - 5_000, now)).toBe('अभी');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 मिनट पहले');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 घंटे पहले');
    expect(relativeTime(now - 30 * 3_600_000, now)).toBe('कल');
    expect(relativeTime(now - 4 * 86_400_000, now)).toBe('4 दिन पहले');
  });

  it('formats latency without dashes', () => {
    expect(formatLatency(412)).toBe('412 ms');
    expect(formatLatency(2400)).toBe('2.4 s');
    expect(formatLatency(12_400)).toBe('12 s');
    expect(formatLatency(undefined)).toBe('Not timed');
  });

  it('formats latency in Kalam\'s language', async () => {
    await loadCatalogue('hi');
    setActiveLanguage('hi');
    expect(formatLatency(412)).toBe('412 मि.से.');
    expect(formatLatency(2400)).toBe('2.4 से.');
    expect(formatLatency(null)).toBe('समय नहीं मापा');
  });

  it('has every time.* key in all ten catalogues', async () => {
    const keys = ['justNow', 'minutesAgo', 'hoursAgo', 'yesterday', 'daysAgo', 'ms', 'seconds', 'notTimed'];
    for (const code of LANGUAGE_CODES) {
      const catalogue = await loadCatalogue(code);
      for (const key of keys) expect(catalogue?.messages.has(`time.${key}`), `${code} time.${key}`).toBe(true);
    }
  });
});
