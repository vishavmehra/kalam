/**
 * The measuring half of the local-ready gate (docs/07 §6.7, §20): runs one task's cases through whatever model
 * answers (a callback) and turns the answers into a `LocalBenchmark` record. It knows nothing about Chrome, the SDK or
 * the network, so tests drive it with a stub and scripts/local-ready.mjs drives it with the real device model.
 * The request is the real one the app would send, and the answer goes through the same parser the app uses.
 */
import type { StructuredRequest } from '../contracts';
import { evaluateGate, localBenchmarkSchema, type GateResult, type LocalBenchmark, type LocalGate, type LocalTask, LOCAL_GATES } from './local-ready';

export type Verdict = 'right' | 'wrong' | 'invented';

export interface BenchCase<T> {
  id: string;
  request: StructuredRequest<T>;
  /** Judges a schema-valid answer. */
  judge: (output: T) => Verdict;
}

/** What the model returned for one case. `text` is its raw reply. */
export interface BenchAnswer { text?: string; ms: number; error?: string }

export interface BenchMeta {
  task: LocalTask;
  platform: LocalBenchmark['platform'];
  model: string;
  date: string;
  evidence: string;
  /** Pass true only when the run really had the network off. */
  offlineOk?: boolean;
}

export interface CaseOutcome { id: string; outcome: 'invalid' | Verdict; ms: number; error?: string }

/** Nearest-rank 95th percentile. */
export function p95(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

export async function runLocalBenchmark<T>(
  meta: BenchMeta,
  cases: readonly BenchCase<T>[],
  answer: (request: StructuredRequest<T>) => Promise<BenchAnswer>,
  gates: Readonly<Record<LocalTask, LocalGate>> = LOCAL_GATES,
): Promise<{ record: LocalBenchmark; verdict: GateResult; outcomes: CaseOutcome[] }> {
  const outcomes: CaseOutcome[] = [];
  for (const c of cases) {
    const a = await answer(c.request).catch((e: unknown): BenchAnswer => ({ ms: 0, error: e instanceof Error ? e.message : 'failed' }));
    let outcome: CaseOutcome['outcome'] = 'invalid';
    if (a.text !== undefined && !a.error) {
      try {
        const parsed = c.request.parse(JSON.parse(a.text));
        if (parsed.success) outcome = c.judge(parsed.data);
      } catch {
        // not JSON: counts as schema-invalid
      }
    }
    outcomes.push({ id: c.id, outcome, ms: a.ms, ...(a.error ? { error: a.error.slice(0, 120) } : {}) });
  }
  const valid = outcomes.filter((o) => o.outcome !== 'invalid');
  const record = localBenchmarkSchema.parse({
    task: meta.task, platform: meta.platform, model: meta.model, date: meta.date, cases: cases.length,
    schemaValid: valid.length, correct: valid.filter((o) => o.outcome === 'right').length,
    hallucinated: valid.filter((o) => o.outcome === 'invented').length,
    p95LatencyMs: p95(outcomes.map((o) => o.ms)), ...(meta.offlineOk === undefined ? {} : { offlineOk: meta.offlineOk }),
    evidence: meta.evidence,
  });
  return { record, verdict: evaluateGate(record, gates), outcomes };
}
