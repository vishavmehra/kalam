/** Small pure statistics helpers for the evaluation report. */
import type { LatencyStats, Rate } from './types';

export const round = (n: number, digits = 3): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

export function rate(correct: number, total: number): Rate {
  return { correct, total, rate: total === 0 ? null : round(correct / total) };
}

/** Sum two or more rates over the same population type. */
export function mergeRates(rates: readonly Rate[]): Rate {
  return rate(
    rates.reduce((s, r) => s + r.correct, 0),
    rates.reduce((s, r) => s + r.total, 0),
  );
}

/** Nearest-rank percentile (p in 0..100). Returns null for an empty list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] ?? null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return m === undefined ? null : round(m, 2);
}

export function latencyStats(values: readonly number[]): LatencyStats {
  if (values.length === 0) return { count: 0, medianMs: null, p95Ms: null, maxMs: null };
  const p95 = percentile(values, 95);
  return {
    count: values.length,
    medianMs: median(values),
    p95Ms: p95 === null ? null : round(p95, 2),
    maxMs: round(Math.max(...values), 2),
  };
}
