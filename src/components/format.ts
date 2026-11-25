/** Locale-light time formatting (Hermes lacks Intl.RelativeTimeFormat on some Android builds). */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "Just now", "5 min ago", "3 h ago", "Yesterday", "4 days ago", else a short date. */
export function relativeTime(ts: number, now = Date.now()): string {
  const d = Math.max(0, now - ts);
  if (d < MIN) return 'Just now';
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  if (d < 2 * DAY) return 'Yesterday';
  if (d < 7 * DAY) return `${Math.floor(d / DAY)} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 * DAY ? 'numeric' : undefined });
}

/** "412 ms" / "2.4 s". */
export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '-';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/** "14:05" today, otherwise "12 Nov, 14:05". */
export function clockTime(ts: number, now = Date.now()): string {
  const date = new Date(ts);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return new Date(now).toDateString() === date.toDateString()
    ? time
    : `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

/**
 * "1 app" / "4 apps" with the language's plural rules (docs/10 §13.4). Falls back to one/other
 * when Intl.PluralRules is missing (some Hermes builds).
 */
export function countLabel(n: number, one: string, other: string, lang = 'en'): string {
  let form: string = n === 1 ? 'one' : 'other';
  try { form = new Intl.PluralRules(lang).select(n); } catch { /* keep the simple rule */ }
  return `${n.toLocaleString(lang)} ${form === 'one' ? one : other}`;
}
