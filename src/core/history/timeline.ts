/**
 * Time Machine data (docs/14 §11.2 and §11.3): a category for every version and the full history grouped by day.
 * Pure functions over AppVersion from the contracts. Nothing here reads or writes storage.
 */
import type { AppVersion } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { materialize } from '../versioning';
import { describeSpecChanges } from './describe';
import { describePatch } from './patch';
import { summarizeChanges } from './summary';
import { categoriesOf, topImpact, type ChangeCategory, type ChangeEntry, type ChangeImpact } from './types';

export type VersionEvent = 'created' | 'edited' | 'restored' | 'imported';
const EVENT_OF: Record<AppVersion['source'], VersionEvent> = {
  create: 'created', edit: 'edited', restore: 'restored', import: 'imported',
};

/**
 * Who made the change (docs/14 §11.3). A stored `origin` is shown as it is. Versions saved before the field
 * existed have none, so the one fact they do carry is used: an import is known to be an import. Nothing else
 * is guessed.
 */
export type VersionOrigin = 'user' | 'ai' | 'import' | 'marketplace';
const ORIGINS: readonly string[] = ['user', 'ai', 'import', 'marketplace'];
export function originOf(v: AppVersion): VersionOrigin | undefined {
  const o: unknown = v.origin;
  if (typeof o === 'string' && ORIGINS.includes(o)) return o as VersionOrigin;
  return v.source === 'import' ? 'import' : undefined;
}

/**
 * A copy of the stored versions that is safe to replay. materialize() applies each stored patch with
 * fast-json-patch, which puts an added value into the document by reference. A later patch that edits that value
 * then rewrites the earlier patch (and every spec built from it). Replaying copies keeps the stored history intact.
 */
function replayable(versions: readonly AppVersion[]): AppVersion[] {
  return versions.map((v) => (v.patch ? { ...v, patch: JSON.parse(JSON.stringify(v.patch)) as AppVersion['patch'] } : v));
}
/** Rebuilds one version without touching `versions`. */
const rebuild = (versions: readonly AppVersion[], target: number): KalamSpec | undefined => materialize(replayable(versions), target);

/**
 * Categories of one version, in display order.
 *  - With the specs before and after: exact, from the diff.
 *  - With only the version: from its stored patch. Snapshots (the first version, every tenth one, and the oldest
 *    kept version) carry no change, so only creation and import are known and anything else returns an empty list.
 */
export function categorizeVersion(version: AppVersion, specs?: { before?: KalamSpec; after?: KalamSpec }): ChangeCategory[] {
  if (specs?.before && specs.after) return categoriesOf(describeSpecChanges(specs.before, specs.after));
  if (version.kind === 'patch' && version.patch) return categoriesOf(describePatch(version.patch));
  return version.source === 'create' || version.source === 'import' ? ['structure'] : [];
}

export interface TimelineEntry {
  version: number;
  createdAt: number;
  /** The summary stored with the version. */
  summary: string;
  /** One readable line built from the real differences. Equals `summary` when the differences are not known. */
  headline: string;
  event: VersionEvent;
  origin?: VersionOrigin;
  categories: ChangeCategory[];
  /** Strongest impact among the changes. Undefined when the changes are not known. */
  impact?: ChangeImpact;
  /** Full list of changes against the previous version. Undefined for the oldest kept version. */
  changes?: ChangeEntry[];
  current: boolean;
}

export interface TimelineDay {
  /** Local calendar day, `2026-11-24`. */
  key: string;
  /** Local midnight of that day, in ms. */
  start: number;
  /** Newest first. */
  entries: TimelineEntry[];
}

export interface TimelineOptions {
  /** Version number of the app right now. Default: the highest version. */
  current?: number;
}

function localDay(ts: number): { key: string; start: number } {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { key, start: new Date(y, m, day).getTime() };
}

/** Every version as a timeline entry, grouped by local day, newest first. */
export function buildTimeline(versions: readonly AppVersion[], options: TimelineOptions = {}): TimelineDay[] {
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  const current = options.current ?? sorted[sorted.length - 1]?.version;
  const entries: TimelineEntry[] = [];
  let previous: { version: number; spec: KalamSpec } | undefined;

  for (const v of sorted) {
    const spec = rebuild(sorted, v.version);
    const before = previous && previous.version === v.version - 1 ? previous.spec : undefined;
    const changes = before && spec ? describeSpecChanges(before, spec) : undefined;
    const known = changes ?? (v.kind === 'patch' && v.patch ? describePatch(v.patch) : undefined);
    entries.push({
      version: v.version,
      createdAt: v.createdAt,
      summary: v.summary,
      headline: changes ? (changes.length ? summarizeChanges(changes) : v.summary || 'No visible changes') : v.summary,
      event: EVENT_OF[v.source],
      origin: originOf(v),
      categories: categorizeVersion(v, { before, after: spec }),
      impact: known ? topImpact(known) : undefined,
      changes,
      current: v.version === current,
    });
    previous = spec ? { version: v.version, spec } : undefined;
  }

  const days = new Map<string, TimelineDay>();
  for (const e of entries.reverse()) {
    const { key, start } = localDay(e.createdAt);
    const day = days.get(key) ?? { key, start, entries: [] };
    day.entries.push(e);
    days.set(key, day);
  }
  return [...days.values()].sort((a, b) => b.start - a.start);
}

/** Keeps only versions that touched one of the chosen categories. An empty choice keeps everything. */
export function filterTimeline(days: readonly TimelineDay[], categories: readonly ChangeCategory[]): TimelineDay[] {
  if (!categories.length) return [...days];
  return days
    .map((d) => ({ ...d, entries: d.entries.filter((e) => e.categories.some((c) => categories.includes(c))) }))
    .filter((d) => d.entries.length > 0);
}

/**
 * What differs between two stored versions, as plain lines that turn `from` into `to`.
 * Undefined when either version can no longer be rebuilt from the stored history.
 */
export function diffVersions(versions: readonly AppVersion[], from: number, to: number): ChangeEntry[] | undefined {
  const a = rebuild(versions, from);
  const b = rebuild(versions, to);
  return a && b ? describeSpecChanges(a, b) : undefined;
}
