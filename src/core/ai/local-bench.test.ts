import { describe, expect, it } from 'vitest';
import type { StructuredRequest } from '../contracts';
import { p95, runLocalBenchmark, type BenchCase, type BenchMeta } from './local-bench';

const meta: BenchMeta = { task: 'classify', platform: 'web', model: 'stub', date: '2026-11-26', evidence: 'docs/evidence/x.json', offlineOk: true };
const request = (): StructuredRequest<{ v: string }> => ({
  taskType: 'classify', prompt: 'p', jsonSchema: {}, mode: 'only_on_device',
  parse: (raw) => (typeof (raw as { v?: unknown })?.v === 'string' ? { success: true, data: { v: (raw as { v: string }).v } } : { success: false, error: 'bad' }),
});
const cases = (n: number): Array<BenchCase<{ v: string }>> =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, request: request(), judge: (o) => (o.v === 'ok' ? 'right' : o.v === 'made-up' ? 'invented' : 'wrong') }));

describe('runLocalBenchmark', () => {
  it('counts schema failures, wrong answers and invented content, and rules on the gate', async () => {
    const replies = ['{"v":"ok"}', '{"v":"nope"}', '{"v":"made-up"}', 'not json', '{"x":1}'];
    let i = 0;
    const run = await runLocalBenchmark(meta, cases(25), async () => ({ text: replies[i++ % 5], ms: 100 + i }));
    expect(run.record).toMatchObject({ cases: 25, schemaValid: 15, correct: 5, hallucinated: 5, offlineOk: true });
    expect(run.verdict.status).toBe('failed');
    expect(run.outcomes.filter((o) => o.outcome === 'invalid')).toHaveLength(10);
  });

  it('is ready when a model does well and the offline run was checked', async () => {
    const run = await runLocalBenchmark(meta, cases(30), async () => ({ text: '{"v":"ok"}', ms: 800 }));
    expect(run.verdict).toEqual({ status: 'ready', reasons: [] });
    expect(run.record.p95LatencyMs).toBe(800);
  });

  it('treats a throwing or erroring model as a schema failure and never as ready', async () => {
    const run = await runLocalBenchmark(meta, cases(20), async (_r) => { throw new Error('model gone'); });
    expect(run.record.schemaValid).toBe(0);
    expect(run.verdict.status).toBe('failed');
    const errored = await runLocalBenchmark(meta, cases(20), async () => ({ text: '{"v":"ok"}', ms: 5, error: 'AbortError' }));
    expect(errored.record.schemaValid).toBe(0);
  });

  it('cannot be ready without the offline check', async () => {
    const { offlineOk: _o, ...noOffline } = meta;
    const run = await runLocalBenchmark(noOffline, cases(25), async () => ({ text: '{"v":"ok"}', ms: 5 }));
    expect(run.verdict.status).toBe('unproven');
  });

  it('p95 is the nearest rank', () => {
    expect(p95([])).toBe(0);
    expect(p95(Array.from({ length: 100 }, (_, i) => i + 1))).toBe(95);
    expect(p95([7])).toBe(7);
  });
});
