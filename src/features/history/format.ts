/** Date and time wording for the history screens. Pure, so it runs under Vitest. */
import { copy } from './copy';

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** `Today`, `Yesterday`, or a short date such as `12 Nov` (with the year when it is not this year). */
export function formatDayHeading(dayStart: number, now: number, lang: string): string {
  const today = startOfDay(now);
  if (dayStart === today) return copy.timeline.today;
  const d = new Date(today);
  if (dayStart === new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime()) return copy.timeline.yesterday;
  const sameYear = new Date(dayStart).getFullYear() === d.getFullYear();
  try {
    return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(dayStart);
  } catch {
    return new Date(dayStart).toDateString();
  }
}

/** `3:42 pm` in the app's language. */
export function formatClock(ts: number, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(ts);
  } catch {
    return new Date(ts).toLocaleTimeString();
  }
}

/** `12 Nov, 3:42 pm` */
export function formatWhen(ts: number, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(ts);
  } catch {
    return new Date(ts).toLocaleString();
  }
}
