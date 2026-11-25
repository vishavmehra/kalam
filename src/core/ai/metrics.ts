/**
 * Hybrid AI metrics from recorded inference events (docs/13 §9.2 and §22, docs/15 §11.4) and the
 * weekly AI counter (docs/00 §13.2, docs/01 §10.3). Pure functions over InferenceEvent rows, for the
 * Activity dashboard and the shelf. Answers reused from the cache are counted apart and kept out of
 * latency figures; deterministic decisions are not model runs.
 *
 * One definition of a model run is used everywhere: a provider was called, the answer was not reused,
 * and the person did not cancel it. Cancels and stops before any call (consent, offline, rate limit,
 * oversized input) are reported separately. A failed on-device attempt followed by the one cloud
 * fallback is two events with the same taskId (orchestrator.ts), so it counts as an on-device run.
 */
import type { InferenceEvent } from '../contracts';
import { TASK_POLICIES } from './routing';

export interface SourceStats {
  /** Model calls that ran on this source. */
  runs: number;
  succeeded: number;
  /** Latency of successful runs. */
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface HybridMetrics {
  onDevice: SourceStats;
  cloud: SourceStats;
  /** The one cloud fallback after an on-device failure (lead decision 2), and how many worked. */
  cloudFallbacks: { runs: number; succeeded: number };
  cacheHits: number;
  retries: number;
  cancelled: number;
  /** Runs Kalam stopped before calling any model: consent, offline, client rate limit, input too large. */
  clientStops: number;
  tokens: { input: number; output: number };
  /** Failure rate per platform, over the same model runs as onDevice and cloud. */
  byPlatform: Array<{ platform: string; requests: number; failed: number }>;
}

/** Nearest-rank percentile; null when there are no values. */
export function percentile(values: readonly number[], p: number): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))] ?? null;
}

const reachedModel = (e: InferenceEvent) => !e.cacheHit && e.provider !== 'none' && e.provider !== 'deterministic';
const isModelRun = (e: InferenceEvent) => reachedModel(e) && e.errorCode !== 'cancelled';
const count = (n?: number) => (n !== undefined && Number.isFinite(n) ? n : 0);

function sourceStats(runs: readonly InferenceEvent[], source: 'on_device' | 'cloud'): SourceStats {
  const mine = runs.filter((e) => e.source === source);
  const ok = mine.filter((e) => e.success).map((e) => e.latencyMs);
  return { runs: mine.length, succeeded: ok.length, p50Ms: percentile(ok, 50), p95Ms: percentile(ok, 95) };
}

export function hybridMetrics(events: readonly InferenceEvent[]): HybridMetrics {
  const runs = events.filter(isModelRun);
  const failedLocally = new Set(runs.filter((e) => e.source === 'on_device' && !e.success).map((e) => e.taskId));
  const fallbacks = runs.filter((e) => e.source === 'cloud' && failedLocally.has(e.taskId));
  const platforms = new Map<string, { requests: number; failed: number }>();
  for (const e of runs) {
    const p = platforms.get(e.platform ?? 'unknown') ?? { requests: 0, failed: 0 };
    p.requests += 1;
    if (!e.success) p.failed += 1;
    platforms.set(e.platform ?? 'unknown', p);
  }
  return {
    onDevice: sourceStats(runs, 'on_device'),
    cloud: sourceStats(runs, 'cloud'),
    cloudFallbacks: { runs: fallbacks.length, succeeded: fallbacks.filter((e) => e.success).length },
    cacheHits: events.filter((e) => e.cacheHit).length,
    retries: events.reduce((n, e) => n + count(e.retries), 0),
    cancelled: events.filter((e) => e.errorCode === 'cancelled').length,
    clientStops: events.filter((e) => !e.cacheHit && e.provider === 'none' && e.errorCode !== 'cancelled').length,
    tokens: events.reduce(
      (t, e) => ({ input: t.input + count(e.tokens?.input), output: t.output + count(e.tokens?.output) }),
      { input: 0, output: 0 },
    ),
    byPlatform: [...platforms.entries()].map(([platform, v]) => ({ platform, ...v })),
  };
}

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * AI actions in the last seven days from real events: successful on-device actions the person asked
 * for (the same tasks as settings.onDeviceActionCount) and successful cloud runs. Cache hits are not
 * new actions.
 * ponytail: counts only what the event table still holds (it keeps the newest 500 rows, and clearing
 * Activity empties it). Pass the `list()` limit and `truncated` says the week is cut short, so the UI
 * can say "at least". An uncapped per-day counter needs a settings field (C1 CONTRACT CHANGE REQUEST).
 */
export function weeklyCounts(
  events: readonly InferenceEvent[],
  now: number,
  listLimit?: number,
): { since: number; onDevice: number; cloud: number; truncated: boolean } {
  const since = now - WEEK_MS;
  const recent = events.filter((e) => e.at >= since && e.success && !e.cacheHit);
  const oldest = events.reduce((min, e) => Math.min(min, e.at), Number.POSITIVE_INFINITY);
  return {
    since,
    onDevice: recent.filter((e) => e.source === 'on_device' && TASK_POLICIES[e.taskType]?.userFacing).length,
    cloud: recent.filter((e) => e.source === 'cloud').length,
    truncated: listLimit !== undefined && events.length >= listLimit && oldest > since,
  };
}
