/**
 * Deterministic coercion of model/voice output into typed record values. Anything that does not
 * fit the destination field is dropped (undefined) — never guessed (docs/05 §9.4, §10.4).
 */
import type { RecordValue } from '../contracts';
import type { KalamField, KalamScreen, KalamSpec } from '../spec/schema';

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
  // Hindi/Hinglish — "do" (2) is omitted on purpose: it is also the imperative "do" ("rakh do").
  ek: 1, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10,
};

export function toNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  const m = raw.replace(/(\d),(?=\d{2,3}\b)/g, '$1').match(/-?\d+(?:\.\d+)?/);
  if (m) return Number(m[0]);
  return WORD_NUMBERS[raw.trim().toLowerCase()];
}

export function toBoolean(raw: unknown): boolean | undefined {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1 ? true : raw === 0 ? false : undefined;
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim().toLowerCase();
  if (/^(true|yes|y|haan|han|ha|done|ho gaya|1|हाँ|हां)$/.test(t)) return true;
  if (/^(false|no|n|nahi|nahin|na|0|नहीं)$/.test(t)) return false;
  return undefined;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : undefined;
};

const WEEKDAYS: Readonly<Record<string, number>> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const MONTHS: Readonly<Record<string, number>> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};
const alternation = (names: Readonly<Record<string, number>>) =>
  Object.keys(names).sort((a, b) => b.length - a.length).join('|');
const WEEKDAY_PATTERN = alternation(WEEKDAYS);
const MONTH_PATTERN = alternation(MONTHS);

/** "by Friday", "this Friday", "next Friday", "Friday evening", "on Friday". Modifier and time of day are optional. */
const WEEKDAY_PHRASE = new RegExp(
  `^(?:(on|this|next|coming|last|past|by|before|till|until|upto|up to) )?(${WEEKDAY_PATTERN})(?: (?:morning|afternoon|evening|night))?$`,
);
/** "14 November", "14th of Nov 2026", optionally led by a weekday ("Friday 14 Nov"). */
const DAY_MONTH = new RegExp(`^(?:(?:${WEEKDAY_PATTERN}) )?(\\d{1,2}) (?:of )?(${MONTH_PATTERN})(?: (\\d{4}))?$`);
/** "November 14", "Nov 14 2026", optionally led by a weekday. */
const MONTH_DAY = new RegExp(`^(?:(?:${WEEKDAY_PATTERN}) )?(${MONTH_PATTERN}) (\\d{1,2})(?: (\\d{4}))?$`);

/** The calendar day `days` away from `now` (local date), as YYYY-MM-DD. */
function shiftDays(now: Date, days: number): string | undefined {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + days));
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Which way an ambiguous date word points. A field that is due in the future (delivery, deadline,
 * appointment) is 'future'. A field that records what already happened (paid on, bought on, birth) is
 * 'past'. 'unknown' means the label does not say, so an ambiguous word is not guessed.
 */
export type DateDirection = 'past' | 'future' | 'unknown';

export interface DateOptions {
  /**
   * Direction for words that could point either way: "kal", "parso", a bare weekday, and a day and
   * month without a year. A plain call reads them as future, like a delivery or due date.
   */
  direction?: DateDirection;
}

/** Offset in whole days to a weekday: strictly ahead (1 to 7), ahead or today (0 to 6), or strictly behind (-1 to -7). */
const weekdayAhead = (from: number, day: number) => ((day - from + 6) % 7) + 1;
const weekdayAheadOrToday = (from: number, day: number) => (day - from + 7) % 7;
const weekdayBehind = (from: number, day: number) => -(((from - day + 6) % 7) + 1);

/**
 * Day offset for spoken or typed relative dates, or undefined when `t` is not one, or is one whose
 * direction cannot be told. `t` is trimmed, lower-case and single-spaced.
 */
function relativeDayOffset(t: string, now: Date, direction: DateDirection): number | undefined {
  if (/^(today|aaj|आज)$/.test(t)) return 0;
  if (/^(tomorrow|tmrw)$/.test(t)) return 1;
  if (t === 'yesterday') return -1;
  if (/^(the )?day after( tomorrow)?$/.test(t)) return 2;
  if (/^(the )?day before( yesterday)?$/.test(t)) return -2;
  // Hindi and Hinglish "kal" is both yesterday and tomorrow, and "parso" both two days ahead and two
  // days back. A date that is expected in the future (delivery, due, appointment) reads them forward.
  // A field that records something that already happened (paid on, bought on) reads them backward.
  // When the label says neither, they are dropped rather than guessed (docs/05 §9.4).
  if (/^(kal|कल)$/.test(t)) return direction === 'past' ? -1 : direction === 'future' ? 1 : undefined;
  if (/^(parso|parson|parsoon|परसों|परसो)$/.test(t)) return direction === 'past' ? -2 : direction === 'future' ? 2 : undefined;
  const w = WEEKDAY_PHRASE.exec(t);
  if (w === null) return undefined;
  const day = WEEKDAYS[w[2]];
  const today = now.getDay();
  switch (w[1]) {
    // The person said which way: "last Friday" is behind, "next Friday" and "coming Friday" are ahead,
    // whatever the field is for. On that same weekday, "next" and "last" mean a week away.
    case 'last': case 'past': return weekdayBehind(today, day);
    case 'next': case 'coming': return weekdayAhead(today, day);
    // "This Friday" and deadlines ("by", "before", "till", "until", "upto") include today.
    case 'this': case 'by': case 'before': case 'till': case 'until': case 'upto': case 'up to':
      return weekdayAheadOrToday(today, day);
    // A bare weekday follows the field. Said on a Friday it means a week from today, because "today"
    // is the word for today.
    default:
      return direction === 'past' ? weekdayBehind(today, day) : direction === 'future' ? weekdayAhead(today, day) : undefined;
  }
}

/**
 * A day and month with no year. The year comes from the field: a future-facing field takes the next
 * such day on or after today, a past-facing one the latest on or before today, and when the label does
 * not say, the one nearest to today. Without a clock there is nothing to anchor the year to.
 */
function yearlessDate(month: number, day: number, now: Date | undefined, direction: DateDirection): string | undefined {
  if (!now) return undefined;
  const today = shiftDays(now, 0);
  if (!today) return undefined;
  const year = now.getFullYear();
  const candidates: string[] = [];
  // Four years either way finds a 29 February.
  for (let y = year - 4; y <= year + 4; y++) {
    const c = iso(y, month, day);
    if (c) candidates.push(c);
  }
  if (direction === 'future') return candidates.find((c) => c >= today);
  if (direction === 'past') return [...candidates].reverse().find((c) => c <= today);
  const at = (c: string) => Date.parse(`${c}T00:00:00Z`);
  let best: string | undefined;
  for (const c of candidates) if (best === undefined || Math.abs(at(c) - at(today)) < Math.abs(at(best) - at(today))) best = c;
  return best;
}

/**
 * YYYY-MM-DD from ISO, day-first D/M/Y (Indian default), a day and month ("14 November", "Nov 14"), or
 * a relative phrase: today, tomorrow, yesterday, day after tomorrow, a weekday name, and Hindi or
 * Hinglish aaj, kal and parso. Anything else is dropped; the engine's own date parser is not used,
 * because it reads a day and month with no year as the year 2001.
 *
 * `now` is injected so results are repeatable; its local calendar day is "today". Without `now`, the
 * words that need a clock (relative days, and dates with no year) are dropped, so text read from a
 * photo is never resolved against the time of the scan.
 */
export function toIsoDate(raw: unknown, now?: Date, opts: DateOptions = {}): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim().toLowerCase().replace(/[.,!?।]+$/u, '').replace(/\s+/g, ' ');
  if (!t) return undefined;
  const direction = opts.direction ?? 'future';
  if (now) {
    const offset = relativeDayOffset(t, now, direction);
    if (offset !== undefined) return shiftDays(now, offset);
  }
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  // Day and month, no year: day first, like the dotted form above.
  m = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) return yearlessDate(+m[2], +m[1], now, direction);
  const named = t.replace(/(\d)(?:st|nd|rd|th)\b/g, '$1').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const namedDate = (monthName: string, dayText: string, yearText: string | undefined) =>
    yearText ? iso(+yearText, MONTHS[monthName], +dayText) : yearlessDate(MONTHS[monthName], +dayText, now, direction);
  const dayFirst = DAY_MONTH.exec(named);
  if (dayFirst) return namedDate(dayFirst[2], dayFirst[1], dayFirst[3]);
  const monthFirst = MONTH_DAY.exec(named);
  return monthFirst ? namedDate(monthFirst[1], monthFirst[2], monthFirst[3]) : undefined;
}

export const normText = (s: string) =>
  s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

// ─── Which way does a date field point? ──────────────────────────────────────
// A word in the label that says the date is still to come beats a word that says it happened, so
// "Paid until", "Sale ends" and "Purchase order delivery" read forward. Labels are split into whole
// words, so "Prepaid" is not "paid". Devanagari and Roman-script Hindi words are included.
const FUTURE_WORDS: ReadonlySet<string> = new Set([
  'due', 'deadline', 'delivery', 'deliver', 'until', 'till', 'ends', 'end', 'expected', 'expires', 'expiry',
  'expiration', 'renew', 'renewal', 'appointment', 'scheduled', 'schedule', 'upcoming', 'next', 'reminder',
  'देय', 'डिलीवरी', 'अंतिम', 'तक', 'समाप्ति', 'अगला', 'अगली', 'नियत', 'अपॉइंटमेंट',
]);
const PAST_WORDS: ReadonlySet<string> = new Set([
  'paid', 'purchase', 'purchased', 'purchases', 'bought', 'sold', 'sale', 'sales', 'expense', 'expenses', 'spent',
  'received', 'joined', 'born', 'birth', 'completed', 'created', 'started', 'entry', 'logged', 'recorded',
  'visited', 'delivered', 'taken', 'given', 'issued',
  'भुगतान', 'खरीद', 'खरीदा', 'खरीदी', 'खर्च', 'बिक्री', 'बेचा', 'प्राप्त', 'मिला', 'जन्म', 'दर्ज', 'लिया', 'दिया',
  'kharcha', 'kharch', 'kharid', 'kharida', 'bhugtan', 'janam', 'janm', 'bikri',
]);

/**
 * The direction of a date field from its label, and its id when known. A bare "Date", "दिनांक" or
 * "तारीख" says nothing, so it is 'unknown'.
 */
export function dateDirection(label: string, id?: string): DateDirection {
  const words = normText(`${label} ${id ? id.replace(/_/g, ' ') : ''}`).split(' ');
  if (words.some((w) => FUTURE_WORDS.has(w))) return 'future';
  if (words.some((w) => PAST_WORDS.has(w))) return 'past';
  return 'unknown';
}

export function matchOption(options: readonly string[], raw: unknown): string | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const s = String(raw);
  return options.find((o) => o === s) ?? options.find((o) => normText(o) === normText(s));
}

export interface CoerceHints {
  /** The field's id. Its words help tell which way a date field points when the label is just "Date". */
  id?: string;
}

/**
 * Coerces one value to the field's type, or drops it. `now` is the caller's clock: leave it out when
 * the value was read from a photo or produced by a model, and relative dates ("Friday", "kal") are
 * dropped instead of being resolved against the time of the scan.
 */
export function coerceFieldValue(def: KalamField, raw: unknown, now?: Date, hints: CoerceHints = {}): RecordValue | undefined {
  if (raw === null || raw === undefined) return undefined;
  switch (def.type) {
    case 'text': {
      const s = typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? String(raw).trim() : '';
      return s ? s.slice(0, def.maxLength ?? 5000) : undefined;
    }
    case 'number': {
      const n = toNumber(raw);
      if (n === undefined || (def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) return undefined;
      return def.decimals !== undefined ? Number(n.toFixed(def.decimals)) : n;
    }
    case 'boolean':
      return toBoolean(raw);
    case 'date':
      return toIsoDate(raw, now, { direction: dateDirection(def.label, hints.id) });
    case 'enum':
      return matchOption(def.options, raw);
    case 'image':
      return undefined; // a model never fills a photo
  }
}

/** Coerces every known key of `raw`; unknown keys and unfit values are dropped. */
export function coerceRecord(defs: Readonly<Record<string, KalamField>>, raw: unknown, now?: Date): Record<string, RecordValue> {
  const out: Record<string, RecordValue> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const def = defs[k];
    if (!def || !Object.prototype.hasOwnProperty.call(defs, k)) continue;
    const c = coerceFieldValue(def, v, now, { id: k });
    if (c !== undefined) out[k] = c;
  }
  return out;
}

/** Field definitions edited by a screen's inputs (collection defs, or synthesised for transient forms). */
export function screenFieldDefs(spec: KalamSpec, screen: KalamScreen): Record<string, KalamField> {
  const col = screen.form ? spec.collections[screen.form] : undefined;
  const out: Record<string, KalamField> = {};
  for (const c of screen.children) {
    if (!('field' in c) || !c.field) continue;
    const fromCol = col?.fields[c.field];
    if (fromCol) {
      out[c.field] = fromCol;
      continue;
    }
    switch (c.type) {
      case 'number':
      case 'counter':
        out[c.field] = { type: 'number', label: c.label };
        break;
      case 'textInput':
        out[c.field] = { type: 'text', label: c.label };
        break;
      case 'date':
        out[c.field] = { type: 'date', label: c.label };
        break;
      case 'toggle':
        out[c.field] = { type: 'boolean', label: c.label };
        break;
      case 'choice':
        out[c.field] = c.options?.length ? { type: 'enum', label: c.label, options: c.options } : { type: 'text', label: c.label };
        break;
    }
  }
  return out;
}

/** JSON Schema fragment for a field's wire value (used to build model output schemas). */
export function fieldJsonSchema(def: KalamField): Record<string, unknown> {
  switch (def.type) {
    case 'number':
      return { type: 'number', description: def.label + (def.unit ? ` (${def.unit})` : '') };
    case 'boolean':
      return { type: 'boolean', description: def.label };
    case 'enum':
      return { type: 'string', enum: [...def.options], description: def.label };
    case 'date':
      return { type: 'string', description: `${def.label} as YYYY-MM-DD` };
    case 'text':
    case 'image':
      return { type: 'string', description: def.label };
  }
}
