/**
 * Pure helpers behind the shell inputs: roving arrow-key navigation, number and date parsing. No React and no
 * react-native import, so they run under vitest. Typed digits from the ten shipped scripts are accepted.
 */

/** Result of reading what someone typed. `empty` is "cleared", `error` carries a reason the field can word. */
export type Parsed<T, E extends string> = { kind: 'empty' } | { kind: 'error'; reason: E } | { kind: 'ok'; value: T };

// ---------------------------------------------------------------- keyboard navigation

export type Orientation = 'horizontal' | 'vertical' | 'both';

export interface NavOptions {
  orientation?: Orientation;
  /** Right-to-left layout: Left moves forward. */
  rtl?: boolean;
  /** Wrap from the last item to the first. Default true (tabs and radios wrap). */
  wrap?: boolean;
  isDisabled?: (index: number) => boolean;
}

/**
 * Where focus goes for `key` from item `current` of `count` (WAI-ARIA tabs and radio group patterns).
 * Returns `null` when the key is not a navigation key here (the caller leaves the event alone), otherwise the
 * target index, which equals `current` when there is nowhere to go. Disabled items are skipped.
 * `current` may be -1 when nothing is selected: forward lands on the first item, back on the last.
 */
export function nextIndex(key: string, current: number, count: number, opts: NavOptions = {}): number | null {
  const { orientation = 'horizontal', rtl = false, wrap = true, isDisabled } = opts;
  if (count <= 0) return null;
  const across = orientation !== 'vertical';
  const down = orientation !== 'horizontal';
  const ok = (i: number) => !isDisabled?.(i);

  if (key === 'Home' || key === 'End') {
    for (let n = 0; n < count; n++) {
      const i = key === 'Home' ? n : count - 1 - n;
      if (ok(i)) return i;
    }
    return current;
  }

  let dir = 0;
  if (key === 'ArrowRight' && across) dir = rtl ? -1 : 1;
  else if (key === 'ArrowLeft' && across) dir = rtl ? 1 : -1;
  else if (key === 'ArrowDown' && down) dir = 1;
  else if (key === 'ArrowUp' && down) dir = -1;
  if (dir === 0) return null;

  let i = current >= 0 && current < count ? current : dir > 0 ? -1 : 0;
  for (let n = 0; n < count; n++) {
    i += dir;
    if (i < 0 || i >= count) {
      if (!wrap) return current;
      i = (i + count) % count;
    }
    if (ok(i)) return i;
  }
  return current;
}

export type RovingAction = { kind: 'activate' } | { kind: 'move'; to: number };

/**
 * What one key press does on a roving item: Space activates it (only when `activate` is set; WAI-ARIA radio
 * group), the arrows, Home and End move focus. `null` leaves the event alone.
 */
export function rovingAction(key: string, current: number, count: number, opts: NavOptions & { activate?: boolean } = {}): RovingAction | null {
  if (key === ' ' && opts.activate) return { kind: 'activate' };
  const to = nextIndex(key, current, count, opts);
  return to === null ? null : { kind: 'move', to };
}

// ---------------------------------------------------------------- digits

/** Code point of the zero of each decimal digit set Kalam may see typed: Arabic-Indic, Devanagari, Bengali,
 *  Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam and fullwidth. */
const DIGIT_ZEROS = [0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xff10];

/** Maps digits of other scripts to 0 to 9. Everything else is left as typed. */
export function toAsciiDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9);
    out += zero === undefined ? ch : String(cp - zero);
  }
  return out;
}

// ---------------------------------------------------------------- numbers

export interface NumberRules { min?: number; max?: number; decimals?: number }
export type NumberError = 'invalid' | 'min' | 'max';

const decimalPlaces = (x: number): number => {
  const m = /(?:\.(\d+))?(?:e([+-]\d+))?$/i.exec(String(x));
  return Math.max(0, (m?.[1]?.length ?? 0) - Number(m?.[2] ?? 0));
};

/** Rounds half away from zero to `decimals` places without the 1.005 floating point miss. */
export function roundTo(n: number, decimals: number): number {
  const d = Math.max(0, Math.min(10, Math.floor(decimals)));
  const abs = String(Math.abs(n));
  if (abs.includes('e')) return Number(n.toFixed(d)) + 0;
  return Math.sign(n) * Number(`${Math.round(Number(`${abs}e${d}`))}e-${d}`) + 0;
}

/** Rounds to `decimals` (when given), then keeps the value inside `min` and `max`. */
export function clampNumber(n: number, { min, max, decimals }: NumberRules = {}): number {
  let v = decimals === undefined ? n : roundTo(n, decimals);
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}

/** Text shown for a number: fixed places when the field has `decimals`. */
export const formatNumberText = (n: number, decimals?: number): string => (decimals === undefined ? String(n) : n.toFixed(decimals));

/**
 * Reads typed text as a number. Accepts spaces, a leading + or minus (also U+2212), digits of any shipped
 * script, and thousands commas (1,23,456 and 1,000). A single comma followed by one, two or four or more
 * digits is a decimal comma (1,5). Exponents, several dots and stray letters are errors.
 * ponytail: "1,000" always means one thousand (Indian grouping); a German-style 1,000 for one is not supported.
 */
export function parseNumberText(text: string, rules: NumberRules = {}): Parsed<number, NumberError> {
  let s = toAsciiDigits(text).replace(/[\s  ']/g, '').replace(/−/g, '-');
  if (s === '') return { kind: 'empty' };
  const lastComma = s.lastIndexOf(',');
  if (lastComma >= 0) {
    const lastDot = s.lastIndexOf('.');
    const decimalComma = lastDot >= 0 ? lastComma > lastDot : s.indexOf(',') === lastComma && s.length - lastComma - 1 !== 3;
    s = decimalComma ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return { kind: 'error', reason: 'invalid' };
  let n = Number(s);
  if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER) return { kind: 'error', reason: 'invalid' };
  if (rules.decimals !== undefined) n = roundTo(n, rules.decimals);
  if (rules.min !== undefined && n < rules.min) return { kind: 'error', reason: 'min' };
  if (rules.max !== undefined && n > rules.max) return { kind: 'error', reason: 'max' };
  return { kind: 'ok', value: n };
}

/** One press of a stepper or an Up or Down key. An empty field steps from 0 (then clamps to `min`). */
export function stepNumber(value: number | null, dir: 1 | -1, rules: NumberRules & { step?: number } = {}): number {
  const step = rules.step !== undefined && rules.step > 0 ? rules.step : 1;
  const places = Math.max(rules.decimals ?? 0, decimalPlaces(step));
  return clampNumber(roundTo((value ?? 0) + dir * step, places), { min: rules.min, max: rules.max });
}

// ---------------------------------------------------------------- dates

export type DateError = 'invalid' | 'min' | 'max';
/** Bounds as 'YYYY-MM-DD'. */
export interface DateRules { min?: string; max?: string }

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** True for a day that exists on the calendar (rejects 2026-02-30, accepts 2024-02-29). */
export function isRealDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** 'min' or 'max' when `iso` falls outside the bounds. ISO dates compare as strings. */
export function dateRangeError(iso: string, { min, max }: DateRules = {}): 'min' | 'max' | null {
  if (min !== undefined && iso < min) return 'min';
  if (max !== undefined && iso > max) return 'max';
  return null;
}

/**
 * Reads a typed date as 'YYYY-MM-DD'. Accepts year first (2026-11-25, 2026/11/25) and day first with a four
 * digit year (25/11/2026, 25-11-2026, 25.11.2026), digits of any shipped script, one or two digit day and month.
 * ponytail: day first only; month-first (11/25/2026) is not read.
 */
export function parseDateText(text: string, rules: DateRules = {}): Parsed<string, DateError> {
  const s = toAsciiDigits(text).trim();
  if (s === '') return { kind: 'empty' };
  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  const m = ymd ?? dmy;
  if (!m) return { kind: 'error', reason: 'invalid' };
  const [y, mo, d] = ymd ? [+m[1]!, +m[2]!, +m[3]!] : [+m[3]!, +m[2]!, +m[1]!];
  if (y < 1000 || !isRealDate(y, mo, d)) return { kind: 'error', reason: 'invalid' };
  const value = `${y}-${pad2(mo)}-${pad2(d)}`;
  const range = dateRangeError(value, rules);
  return range ? { kind: 'error', reason: range } : { kind: 'ok', value };
}

/** Today's local calendar date as 'YYYY-MM-DD'. */
export const todayIso = (now: Date = new Date()): string => `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
