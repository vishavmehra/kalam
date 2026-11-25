/**
 * Pure helpers for the performance benchmarks and the bundle budget (docs/13 §17, docs/15 §11.6).
 * Measurement rules (docs/13 §17.1): record the hardware, repeat runs, report median and p95, never one fast run.
 */
import { median, percentile, round } from './stats';

export interface Timing {
  runs: number;
  /** The very first call, before anything is warm. */
  coldMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

/** First sample is the cold start; the rest are warm. Median and p95 use the warm samples. */
export function summarizeSamples(samples: readonly number[]): Timing {
  if (samples.length < 1) throw new Error('need at least one sample');
  const warm = samples.length > 1 ? samples.slice(1) : samples;
  return {
    runs: samples.length,
    coldMs: round(samples[0] ?? 0, 3),
    medianMs: round(median(warm) ?? 0, 3),
    p95Ms: round(percentile(warm, 95) ?? 0, 3),
    maxMs: round(Math.max(...samples), 3),
  };
}

/** Times `fn` `runs` times with the given clock. The first call is reported as the cold start. */
export function timeRuns(fn: () => unknown, runs: number, now: () => number): Timing {
  if (runs < 1) throw new Error('runs must be at least 1');
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = now();
    fn();
    samples.push(now() - t0);
  }
  return summarizeSamples(samples);
}

export interface TimingBudget {
  p95Ms: number;
}

/** Returns one plain sentence per budget that was missed. A benchmark with no budget is not checked. */
export function checkTimingBudgets(timings: Record<string, Timing>, budgets: Record<string, TimingBudget>): string[] {
  const out: string[] = [];
  for (const [name, t] of Object.entries(timings)) {
    const b = budgets[name];
    if (b && t.p95Ms > b.p95Ms) out.push(`${name}: p95 ${t.p95Ms} ms is over the ${b.p95Ms} ms budget`);
  }
  return out;
}

export interface BundleFile {
  path: string;
  bytes: number;
  gzipBytes: number;
}

export interface BundleBudgets {
  /** All JavaScript the build ships, uncompressed. */
  totalJsBytes: number;
  totalJsGzipBytes: number;
  /** The largest single chunk. */
  largestChunkBytes: number;
  /** Everything the first screen loads: the entry chunk plus the shared chunk. Lazy chunks are excluded. */
  initialJsBytes: number;
}

export interface BundleReport {
  totalJsBytes: number;
  totalJsGzipBytes: number;
  largest: { path: string; bytes: number } | null;
  initialJsBytes: number;
  violations: string[];
}

const mb = (n: number): string => `${(n / 1_048_576).toFixed(2)} MB`;

/**
 * `initialPattern` picks the chunks every visit loads (default: the entry chunk and the shared `__common` chunk,
 * which is how Expo's web export splits routes). Chunks loaded on demand, such as the 3D hero scene, do not count.
 */
export function checkBundle(
  files: readonly BundleFile[],
  budgets: BundleBudgets,
  initialPattern: RegExp = /(?:^|\/)(?:entry|__common)-[0-9a-f]+\.js$/,
): BundleReport {
  const js = files.filter((f) => f.path.endsWith('.js'));
  const total = js.reduce((s, f) => s + f.bytes, 0);
  const totalGzip = js.reduce((s, f) => s + f.gzipBytes, 0);
  const largest = js.reduce<BundleFile | null>((m, f) => (!m || f.bytes > m.bytes ? f : m), null);
  const initial = js.filter((f) => initialPattern.test(f.path)).reduce((s, f) => s + f.bytes, 0);
  const violations: string[] = [];
  if (total > budgets.totalJsBytes)
    violations.push(`total JavaScript ${mb(total)} is over the ${mb(budgets.totalJsBytes)} budget`);
  if (totalGzip > budgets.totalJsGzipBytes) {
    violations.push(`total JavaScript gzipped ${mb(totalGzip)} is over the ${mb(budgets.totalJsGzipBytes)} budget`);
  }
  if (largest && largest.bytes > budgets.largestChunkBytes) {
    violations.push(
      `largest chunk ${largest.path} (${mb(largest.bytes)}) is over the ${mb(budgets.largestChunkBytes)} budget`,
    );
  }
  if (initial > budgets.initialJsBytes)
    violations.push(`initial JavaScript ${mb(initial)} is over the ${mb(budgets.initialJsBytes)} budget`);
  return {
    totalJsBytes: total,
    totalJsGzipBytes: totalGzip,
    largest: largest ? { path: largest.path, bytes: largest.bytes } : null,
    initialJsBytes: initial,
    violations,
  };
}

export interface SpecSizeBudget {
  /** docs/11 §11.1: a spec is capped at 100 KB. */
  maxBytes: number;
  /** docs/13 §17: generated application size under 1 MB. */
  productTargetBytes: number;
}

export function checkSpecSizes(sizes: Record<string, number>, budget: SpecSizeBudget): string[] {
  const out: string[] = [];
  for (const [id, bytes] of Object.entries(sizes)) {
    if (bytes > budget.maxBytes) out.push(`${id}: ${bytes} bytes is over the ${budget.maxBytes} byte spec cap`);
    else if (bytes > budget.productTargetBytes) out.push(`${id}: ${bytes} bytes is over the 1 MB product target`);
  }
  return out;
}
