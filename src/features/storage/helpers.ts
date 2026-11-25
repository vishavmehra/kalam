/** Pure helpers for the Storage and Backup panels (tested in helpers.test.ts). */
import { MIN_PASSPHRASE_LENGTH } from '@/core/backup';

/** "512 bytes", "12 KB", "3.4 MB", "1.2 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export type PassphraseLevel = 'too_short' | 'weak' | 'fair' | 'strong';

const COMMON = ['password', 'passphrase', 'kalam', 'qwerty', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey', 'dragon'];
const RUNS = /0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|abcd|bcde|cdef|wxyz/;

/**
 * Rough guess of how hard a passphrase is to guess offline. A hint, not a guarantee: it rewards length
 * and variety and halves the score for common words, long repeats and keyboard runs.
 */
export function passphraseStrength(passphrase: string): { level: PassphraseLevel; hint: string } {
  const text = typeof passphrase.normalize === 'function' ? passphrase.normalize('NFC') : passphrase;
  const chars = Array.from(text);
  if (chars.length < MIN_PASSPHRASE_LENGTH) {
    return { level: 'too_short', hint: `Use at least ${MIN_PASSPHRASE_LENGTH} characters. Four or more words you will remember work well.` };
  }
  let pool = 0;
  if (/[a-z]/.test(text)) pool += 26;
  if (/[A-Z]/.test(text)) pool += 26;
  if (/[0-9]/.test(text)) pool += 10;
  if (/[^A-Za-z0-9\s]/.test(text)) pool += 33;
  if (/\s/.test(text)) pool += 1;
  let bits = chars.length * Math.log2(Math.max(pool, 2));
  if (new Set(chars).size <= 3) bits = Math.min(bits, 20);
  const lower = text.toLowerCase();
  if (COMMON.some((w) => lower.includes(w)) || /(.)\1{3,}/u.test(text) || RUNS.test(lower)) bits /= 2;
  if (bits < 50) return { level: 'weak', hint: 'Easy to guess. Add more words, or mix in numbers.' };
  if (bits < 75) return { level: 'fair', hint: 'Fair. One or two more words would make it much harder to guess.' };
  return { level: 'strong', hint: 'Strong. Write it down and keep it away from the backup file.' };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** kalam-backup-2026-11-18.kalambackup */
export function backupFileName(now = Date.now()): string {
  const d = new Date(now);
  return `kalam-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.kalambackup`;
}
