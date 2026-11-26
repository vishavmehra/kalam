/** View logic for the history components, kept pure so it is tested without rendering. */
import type { AppVersion } from '@/core/contracts';
import { diffVersions, topImpact, type ChangeEntry, type TimelineEntry } from '@/core/history';

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The words shown for one timeline entry. The summary saved with the version comes first because it is what the
 * person asked for. The line built from the real differences follows when it adds something.
 */
export function entryLines(e: Pick<TimelineEntry, 'summary' | 'headline' | 'changes'>): { primary: string; secondary?: string } {
  const stored = e.summary.trim();
  const generated = e.headline.trim();
  if (!stored) return { primary: generated };
  if (!e.changes || !e.changes.length || !generated || norm(generated) === norm(stored)) return { primary: stored };
  return { primary: stored, secondary: generated };
}

export interface VersionDiff {
  version: number;
  isCurrent: boolean;
  /** What this version changed compared with the one before it. */
  made: ChangeEntry[] | 'earliest' | 'unavailable';
  /** What restoring this version would change in the current design. Undefined for the current version. */
  restore?: ChangeEntry[] | 'unavailable';
  /** True when restoring would change how saved entries are read (a field removed, a type changed). */
  touchesEntries: boolean;
}

export function versionDiff(versions: readonly AppVersion[], version: number, current: number): VersionDiff {
  const oldest = Math.min(...versions.map((v) => v.version));
  const made = version <= oldest ? 'earliest' : (diffVersions(versions, version - 1, version) ?? 'unavailable');
  if (version === current) return { version, isCurrent: true, made, touchesEntries: false };
  const restore = diffVersions(versions, current, version) ?? 'unavailable';
  return {
    version,
    isCurrent: false,
    made,
    restore,
    touchesEntries: Array.isArray(restore) && topImpact(restore) === 'data',
  };
}
