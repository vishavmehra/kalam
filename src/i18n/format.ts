/**
 * Locale-aware formatting for numbers, currency, percentages, dates, times, lists and relative time
 * (docs/10 §13.3). Built on `Intl`, with plain fallbacks for runtimes that lack part of it.
 *
 * Decisions:
 * - The formatting locale defaults to India (`en-IN`, `hi-IN`, ...), so grouping reads 12,34,567.
 * - Digits are Latin by default (`-u-nu-latn`). Marathi and Bengali would otherwise switch to their own
 *   digits, which then sit next to Latin digits typed into number fields. Set `nativeDigits` to opt in.
 * - Currency is never guessed from the language. Pass it, or set it once on the formatter (default INR).
 * - Time zone is separate from language. Pass `timeZone` only to pin one (tests, reports).
 * Pure TypeScript.
 */
import { localeFor, resolveLanguage, type LanguageCode } from './languages';

export type DateInput = number | Date;
export type DateStyle = 'short' | 'medium' | 'long' | 'full';

export type RelativeTimeKey = 'time.justNow' | 'time.minutesAgo' | 'time.hoursAgo' | 'time.yesterday' | 'time.daysAgo';

export interface FormatterOptions {
  /** ISO 4217 code used by `currency()` when none is passed. Default `INR`. */
  currency?: string;
  timeZone?: string;
  /** Use the language's own digits (for example Devanagari for Marathi). Default false. */
  nativeDigits?: boolean;
  /** Resolves the relative-time catalogue strings. Without it, old dates fall back to a short date. */
  translate?: (key: RelativeTimeKey, params?: { count: number }) => string;
  /** Prefer `Intl.RelativeTimeFormat` when it exists. Default true. Tests turn it off to cover the catalogue path. */
  intlRelativeTime?: boolean;
  now?: () => number;
}

export interface Formatter {
  readonly language: LanguageCode;
  /** BCP-47 tag handed to Intl, for example `hi-IN-u-nu-latn`. */
  readonly locale: string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
  integer(value: number): string;
  /** `ratio` is 0 to 1: 0.256 gives "26%". */
  percent(ratio: number, fractionDigits?: number): string;
  currency(value: number, currency?: string, options?: Intl.NumberFormatOptions): string;
  date(value: DateInput, style?: DateStyle): string;
  time(value: DateInput, style?: 'short' | 'medium'): string;
  dateTime(value: DateInput, dateStyle?: DateStyle, timeStyle?: 'short' | 'medium'): string;
  /** "Just now", "5 min ago", "Yesterday", "3 days ago", else a short date. */
  relativeTime(value: DateInput, now?: number): string;
  list(items: readonly string[], type?: 'and' | 'or'): string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const cache = new Map<string, unknown>();

function memo<T>(key: string, make: () => T): T {
  if (cache.has(key)) return cache.get(key) as T;
  const value = make();
  cache.set(key, value);
  return value;
}

function toMillis(value: DateInput): number {
  return value instanceof Date ? value.getTime() : value;
}

export function createFormatter(language: string, options: FormatterOptions = {}): Formatter {
  const code = resolveLanguage(language);
  const base = localeFor(code);
  const locale = options.nativeDigits ? base : `${base}-u-nu-latn`;
  const defaultCurrency = options.currency ?? 'INR';
  const timeZone = options.timeZone;
  const now = options.now ?? Date.now;

  const numberFormat = (opts: Intl.NumberFormatOptions): Intl.NumberFormat | null => {
    try {
      return memo(`n|${locale}|${JSON.stringify(opts)}`, () => new Intl.NumberFormat(locale, opts));
    } catch {
      return null;
    }
  };

  const dateFormat = (opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat | null => {
    const full = timeZone ? { ...opts, timeZone } : opts;
    try {
      return memo(`d|${locale}|${JSON.stringify(full)}`, () => new Intl.DateTimeFormat(locale, full));
    } catch {
      return null;
    }
  };

  const validDate = (value: DateInput): Date | null => {
    const d = new Date(toMillis(value));
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const number: Formatter['number'] = (value, opts = {}) => {
    if (!Number.isFinite(value)) return '';
    return numberFormat(opts)?.format(value) ?? String(value);
  };

  const date: Formatter['date'] = (value, style = 'medium') => {
    const d = validDate(value);
    if (!d) return '';
    return dateFormat({ dateStyle: style })?.format(d) ?? d.toISOString().slice(0, 10);
  };

  const time: Formatter['time'] = (value, style = 'short') => {
    const d = validDate(value);
    if (!d) return '';
    return dateFormat({ timeStyle: style })?.format(d) ?? d.toISOString().slice(11, 16);
  };

  const shortDate = (d: Date, withYear: boolean): string =>
    dateFormat(withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' })?.format(d) ??
    d.toISOString().slice(0, 10);

  const relativeFormat = (): Intl.RelativeTimeFormat | null => {
    if (options.intlRelativeTime === false) return null;
    try {
      if (typeof Intl === 'undefined' || typeof Intl.RelativeTimeFormat !== 'function') return null;
      return memo(`r|${locale}`, () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' }));
    } catch {
      return null;
    }
  };

  const relativeTime: Formatter['relativeTime'] = (value, at = now()) => {
    const d = validDate(value);
    if (!d) return '';
    const diff = Math.max(0, at - d.getTime());
    const tr = options.translate;
    if (diff < MIN) return tr ? tr('time.justNow') : (relativeFormat()?.format(0, 'second') ?? date(d));
    if (diff >= 7 * DAY) return shortDate(d, diff > 300 * DAY);

    const unit: { n: number; name: 'minute' | 'hour' | 'day' } =
      diff < HOUR ? { n: Math.floor(diff / MIN), name: 'minute' } : diff < DAY ? { n: Math.floor(diff / HOUR), name: 'hour' } : { n: Math.floor(diff / DAY), name: 'day' };

    const rtf = relativeFormat();
    if (rtf) {
      try {
        return rtf.format(-unit.n, unit.name);
      } catch {
        /* fall through to the catalogue */
      }
    }
    if (tr) {
      if (unit.name === 'minute') return tr('time.minutesAgo', { count: unit.n });
      if (unit.name === 'hour') return tr('time.hoursAgo', { count: unit.n });
      return unit.n < 2 ? tr('time.yesterday') : tr('time.daysAgo', { count: unit.n });
    }
    return shortDate(d, diff > 300 * DAY);
  };

  return {
    language: code,
    locale,
    number,
    integer: (value) => number(value, { maximumFractionDigits: 0 }),
    percent: (ratio, fractionDigits = 0) =>
      number(ratio, { style: 'percent', minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }),
    currency: (value, currency = defaultCurrency, opts = {}) => {
      if (!Number.isFinite(value)) return '';
      const formatted = numberFormat({ style: 'currency', currency, ...opts })?.format(value);
      return formatted ?? `${currency} ${value.toFixed(2)}`;
    },
    date,
    time,
    dateTime: (value, dateStyle = 'medium', timeStyle = 'short') => {
      const d = validDate(value);
      if (!d) return '';
      return dateFormat({ dateStyle, timeStyle })?.format(d) ?? `${date(d, dateStyle)} ${time(d, timeStyle)}`;
    },
    relativeTime,
    list: (items, type = 'and') => {
      try {
        if (typeof Intl !== 'undefined' && typeof Intl.ListFormat === 'function') {
          return memo(`l|${locale}|${type}`, () => new Intl.ListFormat(locale, { style: 'long', type: type === 'and' ? 'conjunction' : 'disjunction' })).format(items);
        }
      } catch {
        /* fall through */
      }
      return items.join(', ');
    },
  };
}
