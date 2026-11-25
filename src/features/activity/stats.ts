/** Pure aggregation of inference events for the Activity dashboard (no React; unit-tested). */
import type { InferenceEvent, InferenceSource } from '@/core/contracts';

export interface SourceSummary {
  source: InferenceSource;
  count: number;
  succeeded: number;
  medianLatencyMs: number | null;
  /** Slowest 5% boundary (docs/13 §9.2): what a slow day feels like. */
  p95LatencyMs: number | null;
}

export interface ActivitySummary {
  total: number;
  /** In display order: on-device, cloud, deterministic. */
  bySource: SourceSummary[];
  /** Events where a provider fell back (e.g. on-device → cloud). */
  fallbacks: number;
  failures: number;
  /** Why work left the device, most frequent first. */
  escalations: Array<{ reason: string; count: number }>;
  /** Usage ledger (docs/07 §16.4, §19.3), from events that report it. */
  retries: number;
  tokensIn: number;
  tokensOut: number;
  cacheHits: number;
}

export const SOURCE_ORDER: readonly InferenceSource[] = ['on_device', 'cloud', 'deterministic'];

export function median(values: readonly number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Nearest-rank percentile (p in 0..100) of finite values, or null when there are none. */
export function percentile(values: readonly number[], p: number): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const rank = Math.min(v.length, Math.max(1, Math.ceil((p / 100) * v.length)));
  return v[rank - 1];
}

export function summarize(events: readonly InferenceEvent[]): ActivitySummary {
  const bySource = SOURCE_ORDER.map((source): SourceSummary => {
    const es = events.filter((e) => e.source === source);
    return {
      source,
      count: es.length,
      succeeded: es.filter((e) => e.success).length,
      medianLatencyMs: median(es.map((e) => e.latencyMs)),
      p95LatencyMs: percentile(es.map((e) => e.latencyMs), 95),
    };
  });
  const reasons = new Map<string, number>();
  for (const e of events) {
    const r = e.escalationReason?.trim();
    if (r) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  return {
    total: events.length,
    bySource,
    fallbacks: events.filter((e) => e.fallbackUsed).length,
    failures: events.filter((e) => !e.success).length,
    escalations: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    retries: events.reduce((n, e) => n + (e.retries ?? 0), 0),
    tokensIn: events.reduce((n, e) => n + (e.tokens?.input ?? 0), 0),
    tokensOut: events.reduce((n, e) => n + (e.tokens?.output ?? 0), 0),
    cacheHits: events.filter((e) => e.cacheHit).length,
  };
}

/** "extract_template_params" → "Extract template params". */
export function humanizeTask(task: string): string {
  const s = task.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Share of `part` in `whole` as a whole-number percentage string. */
export function percent(part: number, whole: number): string {
  if (!whole) return '0%';
  const p = (part / whole) * 100;
  return `${p > 0 && p < 1 ? '<1' : Math.round(p)}%`;
}
