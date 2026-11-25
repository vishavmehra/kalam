/**
 * Time-zone handling for reminders. A reminder is "9:00 on the day" in the person's own clock, so
 * the scheduler works in wall-clock time and converts to epoch milliseconds through a `Zone`.
 *
 * `localZone` uses the device zone (what ships). `ianaZone('America/New_York')` exists so tests
 * can check time-zone changes and daylight-saving days without depending on the machine's zone.
 * Pure: no React, no platform imports.
 */

export interface WallClock {
  year: number;
  /** 1 to 12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export interface Zone {
  readonly id: string;
  /** Epoch ms of a wall-clock time. A time skipped by daylight saving moves forward; a repeated time uses the first. */
  toEpoch(wall: WallClock): number;
  toWallClock(epoch: number): WallClock;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

export const localZone: Zone = {
  id: 'local',
  toEpoch: (w) => new Date(w.year, w.month - 1, w.day, w.hour, w.minute, 0, 0).getTime(),
  toWallClock: (epoch) => {
    const d = new Date(epoch);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() };
  },
};

const sameWall = (a: WallClock, b: WallClock) =>
  a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;

const wallAsUtc = (w: WallClock) => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);

/** A zone from an IANA name such as `Asia/Kolkata`. Throws on an unknown name. */
export function ianaZone(timeZone: string): Zone {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
  const toWallClock = (epoch: number): WallClock => {
    const out: Record<string, number> = {};
    for (const part of format.formatToParts(new Date(epoch))) {
      if (part.type !== 'literal') out[part.type] = Number(part.value);
    }
    return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute };
  };
  const offsetAt = (epoch: number) => wallAsUtc(toWallClock(epoch)) - Math.floor(epoch / MINUTE) * MINUTE;
  return {
    id: timeZone,
    toWallClock,
    toEpoch(wall) {
      const guess = wallAsUtc(wall);
      // Offsets a day either side of the wall time bracket any single daylight-saving change.
      const candidates = [...new Set([guess - offsetAt(guess - DAY), guess - offsetAt(guess + DAY)])];
      const valid = candidates.filter((c) => sameWall(toWallClock(c), wall));
      return valid.length ? Math.min(...valid) : Math.max(...candidates);
    },
  };
}

// ─── Date-only helpers (record date fields are 'YYYY-MM-DD') ─────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses 'YYYY-MM-DD'. Rejects impossible dates (2026-02-30) and years outside 1970 to 2200. */
export function parseDateOnly(value: unknown): DateParts | undefined {
  if (typeof value !== 'string') return undefined;
  const m = DATE_RE.exec(value);
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1970 || year > 2200) return undefined;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
  return { year, month, day };
}

export function formatDateOnly(d: DateParts): string {
  return `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/** Calendar arithmetic (no clock involved, so daylight saving cannot shift the result). */
export function addDays(d: DateParts, days: number): DateParts {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: DateParts, b: DateParts): number {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY);
}

export function todayParts(now: number, zone: Zone): DateParts {
  const w = zone.toWallClock(now);
  return { year: w.year, month: w.month, day: w.day };
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parses 'HH:MM' (24 hour). */
export function parseTimeOfDay(value: unknown): { hour: number; minute: number } | undefined {
  if (typeof value !== 'string') return undefined;
  const m = TIME_RE.exec(value);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : undefined;
}
