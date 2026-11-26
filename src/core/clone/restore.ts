/**
 * Time Machine restore, step by step (docs/14 §11.5 and §11.6): look first, then confirm, then save as a new version.
 *
 *  1. `previewRestore` rebuilds the older design, checks it, and lists in plain words what restoring would change.
 *  2. The person confirms with the text it provides.
 *  3. `confirmRestore` hands back exactly what to save: the older design as a NEW version. History is kept, later
 *     versions stay, and no entry is touched (structure and entries are separate, §11.6).
 *
 * The plain-English change lines come from src/core/history; the rebuilding comes from src/core/versioning.
 */
import type { AppVersion } from '../contracts';
import { diffVersions, summarizeChanges, topImpact, type ChangeEntry, type ChangeImpact } from '../history';
import type { KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { cloneSpec, materialize, sameDesign } from '../versioning';

export const RESTORE_COPY = {
  title: (n: number): string => `Restore version ${n}?`,
  message: (n: number): string =>
    `Version ${n} becomes your current design, saved as a new version. Your history and your saved entries are kept.`,
  messageWithUndo: (n: number, back: number): string =>
    `Version ${n} becomes your current design, saved as a new version. You can go back to version ${back} afterwards. Your history and your saved entries are kept.`,
  confirm: 'Restore',
  cancel: 'Keep my current design',
  nothing: 'Nothing differs from your current design.',
  small: 'Only small settings differ from your current design.',
  current: 'This is your current design.',
  draft: 'Keep or discard the proposed change before restoring an older version.',
  gone: 'This version can no longer be rebuilt from the history on this device.',
  unsafe: 'This version no longer passes the safety checks, so it cannot be restored.',
  summary: (n: number): string => `Restored version ${n}`,
  listEntries: (n: number, list: string): string =>
    `${n === 1 ? '1 saved entry' : `${n} saved entries`} in ${list} stay on this device and show again if the list comes back.`,
} as const;

export interface RestorePreview {
  /** True when this version can be restored right now. */
  ok: boolean;
  target: number;
  current: number;
  /** The design that would become current. Present only when it was rebuilt and passed the checks. */
  spec?: KalamSpec;
  /** What restoring would change, in plain words, in the order of the history. */
  changes: ChangeEntry[];
  /** One line for a heading. */
  headline: string;
  impact: ChangeImpact;
  /** True when how saved entries are read would change. Their values are never changed or deleted. */
  affectsEntries: boolean;
  /** Plain sentences about saved entries, shown when `affectsEntries`. */
  entryNotes: string[];
  /** Why this version cannot be restored, in plain words. Empty when `ok`. */
  problems: string[];
  confirm: { title: string; message: string; confirmLabel: string; cancelLabel: string };
}

export interface PreviewOptions {
  /** Saved entries per list right now, to say how many stay behind when a list is not in the older design. */
  recordCounts?: Readonly<Record<string, number>>;
  /** A proposed change is waiting. Restoring would drop it, so it is refused until the person keeps or discards it. */
  hasDraft?: boolean;
}

/** materialize() puts patch values into the document by reference; rebuilding from copies keeps stored history intact. */
function rebuild(versions: readonly AppVersion[], n: number): KalamSpec | undefined {
  const copy = versions.map((v) => (v.patch ? { ...v, patch: JSON.parse(JSON.stringify(v.patch)) as AppVersion['patch'] } : v));
  const spec = materialize(copy, n);
  return spec ? cloneSpec(spec) : undefined;
}

export function previewRestore(
  versions: readonly AppVersion[], target: number, current: number, options: PreviewOptions = {},
): RestorePreview {
  const base = (problems: string[], extra: Partial<RestorePreview> = {}): RestorePreview => ({
    ok: false, target, current, changes: [], headline: '', impact: 'cosmetic', affectsEntries: false, entryNotes: [],
    problems,
    confirm: {
      title: RESTORE_COPY.title(target), message: RESTORE_COPY.message(target),
      confirmLabel: RESTORE_COPY.confirm, cancelLabel: RESTORE_COPY.cancel,
    },
    ...extra,
  });
  if (target === current) return base([RESTORE_COPY.current], { headline: RESTORE_COPY.current });
  if (options.hasDraft) return base([RESTORE_COPY.draft]);

  const spec = rebuild(versions, target);
  const now = rebuild(versions, current);
  if (!spec || !now) return base([RESTORE_COPY.gone]);
  // An invalid older version can never become the active design (docs/14 §11.7).
  if (!validateSpec(spec).ok) return base([RESTORE_COPY.unsafe]);
  // The database saves no new version for an identical design, so there is nothing to offer (and nothing to claim).
  if (sameDesign(spec, now)) return base([RESTORE_COPY.nothing], { headline: RESTORE_COPY.nothing });

  const changes = diffVersions(versions, current, target) ?? [];
  const impact = topImpact(changes);
  const notes = [...new Set(changes.filter((c) => c.impact === 'data' && c.note).map((c) => c.note as string))];
  // Entries of a list that the older design does not have: say how many stay behind (nothing is deleted).
  const gone = Object.keys(now.collections).filter((id) => !Object.prototype.hasOwnProperty.call(spec.collections, id));
  for (const id of gone) {
    const n = options.recordCounts?.[id] ?? 0;
    if (n > 0) notes.push(RESTORE_COPY.listEntries(n, `“${now.collections[id]?.label ?? id}”`));
  }
  const newest = Math.max(...versions.map((v) => v.version));
  return base([], {
    ok: true,
    spec,
    changes,
    headline: changes.length ? summarizeChanges(changes) : RESTORE_COPY.small,
    impact,
    affectsEntries: impact === 'data' || gone.length > 0,
    entryNotes: notes,
    confirm: {
      title: RESTORE_COPY.title(target),
      message: current === newest ? RESTORE_COPY.messageWithUndo(target, current) : RESTORE_COPY.message(target),
      confirmLabel: RESTORE_COPY.confirm,
      cancelLabel: RESTORE_COPY.cancel,
    },
  });
}

/** What to hand to `AppRepository.save({ ...app, spec }, change)`. */
export interface RestoreRequest {
  spec: KalamSpec;
  change: { summary: string; source: 'restore'; origin: 'user' };
}

/** The confirmed restore. Undefined for a preview that is not `ok`, so nothing invalid can be saved by mistake. */
export function confirmRestore(preview: RestorePreview): RestoreRequest | undefined {
  if (!preview.ok || !preview.spec) return undefined;
  return { spec: cloneSpec(preview.spec), change: { summary: RESTORE_COPY.summary(preview.target), source: 'restore', origin: 'user' } };
}

/**
 * Undo for a restore (docs/00 §24.7 "Undo"): the version that was current just before the latest restore, which is
 * the one right below it. Undefined when the newest version is not a restore or that version is gone.
 */
export function undoRestoreTarget(versions: readonly AppVersion[]): number | undefined {
  const newest = [...versions].sort((a, b) => b.version - a.version)[0];
  if (!newest || newest.source !== 'restore') return undefined;
  const before = newest.version - 1;
  return versions.some((v) => v.version === before) && rebuild(versions, before) ? before : undefined;
}
