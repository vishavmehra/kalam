/** Locale-light time formatting (Hermes lacks Intl.RelativeTimeFormat on some Android builds). */
import { getActiveLanguage, t } from '@/i18n/active';
import { createFormatter } from '@/i18n/format';

/**
 * "Just now", "5 min ago", "Yesterday", "4 days ago", else a short date, in Kalam's language (the `time.*`
 * keys when the runtime has no relative-time formatter). React screens can use `useFormat().relativeTime`.
 */
export function relativeTime(ts: number, now = Date.now()): string {
  return createFormatter(getActiveLanguage(), { translate: t }).relativeTime(ts, now);
}

/** "412 ms" / "2.4 s" in Kalam's language (`time.ms`, `time.seconds`), or "Not timed" when there is no value. */
export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return t('time.notTimed');
  const f = createFormatter(getActiveLanguage());
  if (ms < 1000) return t('time.ms', { value: f.integer(ms) });
  const digits = ms < 10_000 ? 1 : 0;
  return t('time.seconds', { value: f.number(ms / 1000, { minimumFractionDigits: digits, maximumFractionDigits: digits }) });
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
