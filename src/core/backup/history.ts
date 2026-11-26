/**
 * Imported version history is rebuilt, never trusted as stored (docs/09 §17, docs/11 §12.7).
 * Every version is materialised from the file's rows, stripped of claims and validated; patches
 * between consecutive valid versions are recomputed, with snapshots at the usual interval and after
 * any gap. When the newest valid version is not the app's current design, the history is dropped and
 * the current design becomes one snapshot. Version numbers, dates and summaries are kept.
 */
import { compare } from 'fast-json-patch';
import type { AppVersion } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { cloneSpec, materialize, MAX_VERSIONS, sameDesign, SNAPSHOT_INTERVAL } from '../versioning';
import { validateImportedSpec } from './sanitize';
import { versionRowShape } from './schemas';

export interface RebuiltHistory {
  versions: AppVersion[];
  /** Rows from the file that were not restored. */
  skipped: number;
  /** False when the file's history could not be used and only the current design was kept. */
  historyKept: boolean;
}

export function rebuildHistory(
  appId: string,
  rawRows: readonly unknown[],
  current: KalamSpec,
  fallbackTime: number,
): RebuiltHistory {
  const rows: AppVersion[] = [];
  const seen = new Set<number>();
  for (const raw of rawRows) {
    const shape = versionRowShape.safeParse(raw);
    if (!shape.success || shape.data.appId !== appId || seen.has(shape.data.version)) continue;
    seen.add(shape.data.version);
    // Patch ops are shape-checked above; fast-json-patch also refuses prototype paths when applying.
    rows.push(shape.data as AppVersion);
  }
  rows.sort((a, b) => a.version - b.version);

  const valid: Array<{ row: AppVersion; spec: KalamSpec }> = [];
  for (const row of rows) {
    const raw = materialize(rows, row.version);
    const spec = raw && raw.id === appId && raw.version === row.version ? validateImportedSpec(raw) : undefined;
    if (spec) valid.push({ row, spec });
  }

  const newest = valid.at(-1);
  if (!newest || newest.row.version !== current.version || !sameDesign(newest.spec, current)) {
    const snapshot: AppVersion = {
      appId, version: current.version, createdAt: fallbackTime, kind: 'snapshot', snapshot: cloneSpec(current),
      summary: 'Imported from backup', source: 'import',
    };
    return { versions: [snapshot], skipped: rawRows.length, historyKept: false };
  }

  const kept = valid.slice(-MAX_VERSIONS);
  kept[kept.length - 1] = { row: newest.row, spec: current };
  const versions: AppVersion[] = [];
  let prev: { version: number; spec: KalamSpec } | undefined;
  for (const { row, spec } of kept) {
    const base = {
      appId, version: row.version, createdAt: row.createdAt || fallbackTime, summary: row.summary, source: row.source,
      ...(row.origin ? { origin: row.origin } : {}),
    };
    const chained = prev !== undefined && prev.version === row.version - 1 && (row.version - 1) % SNAPSHOT_INTERVAL !== 0;
    versions.push(
      chained && prev
        ? { ...base, kind: 'patch', patch: compare(prev.spec, spec) }
        : { ...base, kind: 'snapshot', snapshot: cloneSpec(spec) },
    );
    prev = { version: row.version, spec };
  }
  return { versions, skipped: rawRows.length - versions.length, historyKept: true };
}
