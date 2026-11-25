/**
 * Calendar dates for reports. Everything is a civil date string 'YYYY-MM-DD', so bucketing never
 * depends on the machine's time zone. The only zone-aware step is turning an instant (now, or the
 * time an entry was added) into a civil date, and that takes an explicit IANA zone.
 */
import type { TimeUnit } from './chart-component';

const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  let f = zoneFormatters.get(key);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
    try {
      f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone });
    } catch {
      f = new Intl.DateTimeFormat('en-US', opts); // unknown zone name: the device zone
    }
    zoneFormatters.set(key, f);
  }
  return f;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const fromUtc = (t: number): string => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const toUtc = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
};

/** The civil date of an instant in `timeZone` (absent: the device zone). */
export function civilDate(instant: Date | number, timeZone?: string): string {
  const parts = zoneFormatter(timeZone).formatToParts(typeof instant === 'number' ? new Date(instant) : instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '01';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 'YYYY-MM-DD' (or a longer ISO string) from a record value, if it is a real date. */
export function parseCivil(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = ISO.exec(v.trim());
  if (!m) return undefined;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  return fromUtc(toUtc(date)) === date ? date : undefined; // rejects 2026-02-31
}

export const addDays = (date: string, n: number): string => fromUtc(toUtc(date) + n * DAY_MS);

/** Same day n months later, clamped to the month's last day (31 Mar minus 1 month = 28 or 29 Feb). */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y!, m! - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d!, last))}`;
}

export function shift(date: string, unit: TimeUnit, n: number): string {
  return unit === 'month' ? addMonths(date, n) : addDays(date, unit === 'week' ? n * 7 : n);
}

/** First day of the bucket that holds `date`. Weeks start on Monday (ISO 8601). */
export function startOf(date: string, unit: TimeUnit): string {
  if (unit === 'day') return date;
  if (unit === 'month') return `${date.slice(0, 7)}-01`;
  const weekday = (new Date(toUtc(date)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -weekday);
}

/** Bucket starts from the bucket of `from` to the bucket of `to`, inclusive. */
export function bucketsBetween(from: string, to: string, unit: TimeUnit): string[] {
  const out: string[] = [];
  for (let k = startOf(from, unit); k <= to; k = shift(k, unit, 1)) out.push(k);
  return out;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function format(date: string, lang: string, opts: Intl.DateTimeFormatOptions): string {
  const key = `${lang}|${JSON.stringify(opts)}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(lang, { ...opts, timeZone: 'UTC' });
    } catch {
      f = new Intl.DateTimeFormat('en', { ...opts, timeZone: 'UTC' });
    }
    formatters.set(key, f);
  }
  return f.format(new Date(toUtc(date)));
}

/** 18 Nov 2026 */
export const formatDay = (date: string, lang: string): string => format(date, lang, { day: 'numeric', month: 'short', year: 'numeric' });

/** Axis and table label of a bucket: "18 Nov", "16 Nov" (the week's Monday) or "Nov 2026". */
export function bucketLabel(key: string, unit: TimeUnit, lang: string): string {
  return unit === 'month'
    ? format(key, lang, { month: 'short', year: 'numeric' })
    : format(key, lang, { day: 'numeric', month: 'short' });
}
