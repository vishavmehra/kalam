import { beforeAll, describe, expect, it } from 'vitest';

import { loadCatalogue } from './catalogue';
import { createFormatter } from './format';
import { createTranslator } from './translator';

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

beforeAll(async () => {
  await Promise.all([loadCatalogue('en'), loadCatalogue('hi')]);
});

describe('numbers', () => {
  it('groups digits the Indian way by default', () => {
    expect(createFormatter('en').number(1234567.5)).toBe('12,34,567.5');
    expect(createFormatter('hi').number(1234567)).toBe('12,34,567');
    expect(createFormatter('en').integer(1234.6)).toBe('1,235');
  });

  it('uses Latin digits unless native digits are asked for', () => {
    expect(createFormatter('mr').number(1234)).toMatch(/^[0-9,]+$/);
    expect(createFormatter('mr', { nativeDigits: true }).number(1234)).toMatch(/[०-९]/);
    expect(createFormatter('bn', { nativeDigits: true }).number(1234)).toMatch(/[০-৯]/);
    expect(createFormatter('bn').number(1234)).toMatch(/^[0-9,]+$/);
  });

  it('formats percentages from a 0 to 1 ratio', () => {
    expect(createFormatter('en').percent(0.256)).toBe('26%');
    expect(createFormatter('en').percent(0.256, 1)).toBe('25.6%');
  });

  it('returns an empty string for numbers that are not finite', () => {
    const f = createFormatter('en');
    expect(f.number(Number.NaN)).toBe('');
    expect(f.currency(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('currency', () => {
  it('defaults to rupees and groups the Indian way', () => {
    expect(createFormatter('en').currency(1234567)).toBe('₹12,34,567.00');
  });

  it('never infers the currency from the language', () => {
    expect(createFormatter('hi').currency(1200, 'USD')).toMatch(/\$|US/);
    expect(createFormatter('hi').currency(1200, 'USD')).not.toContain('₹');
    expect(createFormatter('hi', { currency: 'EUR' }).currency(5)).toContain('€');
    expect(createFormatter('en').currency(5, 'AED')).toMatch(/AED/);
  });

  it('allows the caller to change fraction digits', () => {
    expect(createFormatter('en').currency(1200, 'INR', { maximumFractionDigits: 0, minimumFractionDigits: 0 })).toBe('₹1,200');
  });
});

describe('dates and times (time zone is separate from language)', () => {
  const at = Date.UTC(2026, 10, 18, 14, 5);

  it('formats dates for the language', () => {
    expect(createFormatter('en', { timeZone: 'UTC' }).date(at)).toMatch(/18 Nov 2026/);
    const hindi = createFormatter('hi', { timeZone: 'UTC' }).date(at);
    expect(hindi).toContain('2026');
    expect(hindi).toContain('18');
    expect(hindi).not.toMatch(/Nov/);
  });

  it('formats times and date-times in the requested time zone', () => {
    expect(createFormatter('en', { timeZone: 'UTC' }).time(at)).toMatch(/^2:05\s?pm$/i);
    expect(createFormatter('en', { timeZone: 'Asia/Kolkata' }).time(at)).toMatch(/^7:35\s?pm$/i);
    expect(createFormatter('en', { timeZone: 'UTC' }).dateTime(new Date(at))).toMatch(/18 Nov 2026.*2:05/);
  });

  it('returns an empty string for an invalid date', () => {
    expect(createFormatter('en').date(Number.NaN)).toBe('');
    expect(createFormatter('en').relativeTime(new Date('nope'))).toBe('');
  });

  it('joins lists with the language conjunction', () => {
    expect(createFormatter('en').list(['A', 'B', 'C'])).toBe('A, B and C');
    expect(createFormatter('en').list(['A', 'B'], 'or')).toBe('A or B');
    expect(createFormatter('en').list(['A'])).toBe('A');
  });
});

describe('relative time through the catalogue (no Intl.RelativeTimeFormat)', () => {
  const english = createTranslator('en', { warn: false, formatter: { intlRelativeTime: false, timeZone: 'UTC', now: () => NOW } }).format;
  const hindi = createTranslator('hi', { warn: false, formatter: { intlRelativeTime: false, timeZone: 'UTC', now: () => NOW } }).format;

  it('says just now, minutes, hours, yesterday and days', () => {
    expect(english.relativeTime(NOW - 20_000)).toBe('Just now');
    expect(english.relativeTime(NOW - 5 * MIN)).toBe('5 min ago');
    expect(english.relativeTime(NOW - 3 * HOUR)).toBe('3 h ago');
    expect(english.relativeTime(NOW - 30 * HOUR)).toBe('Yesterday');
    expect(english.relativeTime(NOW - 3 * DAY)).toBe('3 days ago');
  });

  it('uses the language catalogue and plural rules', () => {
    expect(hindi.relativeTime(NOW - 5 * MIN)).toBe('5 मिनट पहले');
    expect(hindi.relativeTime(NOW - 30 * HOUR)).toBe('कल');
    expect(hindi.relativeTime(NOW - 2 * HOUR)).toBe('2 घंटे पहले');
  });

  it('switches to a short date after a week, adding the year after about ten months', () => {
    expect(english.relativeTime(NOW - 10 * DAY)).toMatch(/^8 Nov$/);
    expect(english.relativeTime(NOW - 400 * DAY)).toMatch(/2025/);
  });

  it('treats a future time as just now', () => {
    expect(english.relativeTime(NOW + HOUR)).toBe('Just now');
  });
});

describe('relative time through Intl.RelativeTimeFormat', () => {
  it('uses the platform formatter when it exists', () => {
    const { format } = createTranslator('en', { warn: false, formatter: { now: () => NOW } });
    expect(format.relativeTime(NOW - 5 * MIN)).toMatch(/5\s?min/i);
    expect(format.relativeTime(NOW - 30 * HOUR)).toMatch(/yesterday/i);
    expect(format.relativeTime(NOW - 20_000)).toBe('Just now');
  });

  it('produces Latin digits for Hindi', () => {
    const { format } = createTranslator('hi', { warn: false, formatter: { now: () => NOW } });
    expect(format.relativeTime(NOW - 5 * MIN)).toMatch(/5/);
  });

  it('falls back to a short date when there is no translator and no Intl.RelativeTimeFormat', () => {
    const f = createFormatter('en', { intlRelativeTime: false, timeZone: 'UTC', now: () => NOW });
    expect(f.relativeTime(NOW - 5 * MIN)).toMatch(/Nov/);
  });
});
