/**
 * Application version history (docs/05 §15.3–15.4, docs/09 §17). Pure TypeScript.
 *
 * - Version 1 is a full snapshot; every later version stores an RFC 6902 patch from its predecessor.
 * - A fresh snapshot is written every SNAPSHOT_INTERVAL versions so patch chains stay short.
 * - Retention keeps the newest MAX_VERSIONS entries; the oldest kept entry is rebased into a snapshot
 *   so everything retained stays materialisable.
 * - Restoring = materialize(old) and save it as a NEW version. History and records are never deleted.
 */
import { applyPatch, compare } from 'fast-json-patch';
import type { AppVersion } from '../contracts';
import type { KalamSpec } from '../spec/schema';

export const SNAPSHOT_INTERVAL = 10;
export const MAX_VERSIONS = 20;

export interface VersionChange {
  summary: string;
  source: AppVersion['source'];
}

/** Specs are JSON data, so a JSON round-trip is a complete deep copy (structuredClone is not on Hermes). */
export function cloneSpec(spec: KalamSpec): KalamSpec {
  return JSON.parse(JSON.stringify(spec)) as KalamSpec;
}

/** True when two specs differ only in bookkeeping (`version`, `meta.updatedAt`). */
export function sameDesign(a: KalamSpec, b: KalamSpec): boolean {
  const strip = (s: KalamSpec) => ({ ...s, version: 0, meta: { ...s.meta, updatedAt: 0 } });
  return compare(strip(a), strip(b)).length === 0;
}

/**
 * Builds the entry that turns `previous` (the latest stored version, if any) into `spec`.
 * Versions 1, 11, 21, … are snapshots; the rest are patches.
 */
export function createVersion(
  appId: string,
  previous: { version: number; spec: KalamSpec } | undefined,
  spec: KalamSpec,
  change: VersionChange,
  now: number,
): AppVersion {
  const version = (previous?.version ?? 0) + 1;
  const base = { appId, version, createdAt: now, summary: change.summary, source: change.source };
  if (!previous || (version - 1) % SNAPSHOT_INTERVAL === 0) {
    return { ...base, kind: 'snapshot', snapshot: cloneSpec(spec) };
  }
  return { ...base, kind: 'patch', patch: compare(previous.spec, spec) };
}

/** Rebuilds version `target` from the nearest snapshot at or below it. Undefined if the chain is broken. */
export function materialize(versions: readonly AppVersion[], target: number): KalamSpec | undefined {
  const byNumber = new Map(versions.map((v) => [v.version, v]));
  let base = target;
  while (byNumber.get(base)?.kind === 'patch') base--;
  const snapshot = byNumber.get(base)?.snapshot;
  if (!snapshot) return undefined;
  try {
    let doc = cloneSpec(snapshot);
    for (let n = base + 1; n <= target; n++) {
      const patch = byNumber.get(n)?.patch;
      if (!patch) return undefined;
      doc = applyPatch(doc, patch, false, true).newDocument;
    }
    return doc;
  } catch {
    return undefined; // corrupt patch: report "unavailable" instead of a half-applied spec
  }
}

/**
 * Retention: keep the newest `max` versions. If the oldest kept entry is a patch it is rebased into a
 * snapshot (returned as `rebased`) so the retained history stays self-contained.
 */
export function applyRetention(
  versions: readonly AppVersion[],
  max = MAX_VERSIONS,
): { keep: AppVersion[]; remove: number[]; rebased?: AppVersion } {
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  if (sorted.length <= max) return { keep: sorted, remove: [] };
  const cut = sorted.length - max;
  const oldest = sorted[cut];
  const remove = sorted.slice(0, cut).map((v) => v.version);
  if (oldest.kind === 'snapshot') return { keep: sorted.slice(cut), remove };
  const snapshot = materialize(sorted, oldest.version);
  if (!snapshot) return { keep: sorted, remove: [] }; // never drop history we cannot rebuild
  const rebased: AppVersion = {
    appId: oldest.appId,
    version: oldest.version,
    createdAt: oldest.createdAt,
    summary: oldest.summary,
    source: oldest.source,
    kind: 'snapshot',
    snapshot,
  };
  return { keep: [rebased, ...sorted.slice(cut + 1)], remove, rebased };
}
