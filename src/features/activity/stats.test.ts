import { describe, expect, it } from 'vitest';

import type { InferenceEvent } from '@/core/contracts';

import { humanizeTask, median, percent, percentile, summarize } from './stats';

const ev = (p: Partial<InferenceEvent>): InferenceEvent => ({
  id: Math.random().toString(36), at: 0, taskId: 't', taskType: 'create_app', route: 'cloud', provider: 'firebase',
  source: 'cloud', latencyMs: 100, success: true, fallbackUsed: false, ...p,
});

describe('activity stats', () => {
  it('median handles empty, odd, even and non-finite input', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([Number.NaN, 5])).toBe(5);
  });

  it('summarizes by source in fixed order with medians, fallbacks, failures and ranked escalations', () => {
    const s = summarize([
      ev({ source: 'on_device', latencyMs: 300 }),
      ev({ source: 'on_device', latencyMs: 500, success: false }),
      ev({ source: 'cloud', latencyMs: 1200, fallbackUsed: true, escalationReason: 'complex app' }),
      ev({ source: 'cloud', latencyMs: 1800, escalationReason: 'complex app' }),
      ev({ source: 'cloud', latencyMs: 900, escalationReason: 'on-device unavailable' }),
      ev({ source: 'deterministic', latencyMs: 2 }),
    ]);
    expect(s.total).toBe(6);
    expect(s.bySource.map((b) => [b.source, b.count, b.succeeded, b.medianLatencyMs])).toEqual([
      ['on_device', 2, 1, 400],
      ['cloud', 3, 3, 1200],
      ['deterministic', 1, 1, 2],
    ]);
    expect(s.fallbacks).toBe(1);
    expect(s.failures).toBe(1);
    expect(s.escalations).toEqual([{ reason: 'complex app', count: 2 }, { reason: 'on-device unavailable', count: 1 }]);
  });

  it('formats tasks and percentages', () => {
    expect(humanizeTask('extract_template_params')).toBe('Extract template params');
    expect(percent(1, 3)).toBe('33%');
    expect(percent(1, 500)).toBe('<1%');
    expect(percent(0, 0)).toBe('0%');
  });
});

describe('latency percentiles and usage ledger', () => {
  it('uses nearest rank for p95', () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([10], 95)).toBe(10);
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19);
  });

  it('adds up retries, tokens and cache hits from events that report them', () => {
    const s = summarize([ev({ retries: 2, tokens: { input: 100, output: 40 } }), ev({ cacheHit: true }), ev({})]);
    expect([s.retries, s.tokensIn, s.tokensOut, s.cacheHits]).toEqual([2, 100, 40, 1]);
    expect(s.bySource.find((b) => b.source === 'cloud')?.p95LatencyMs).toBe(100);
  });
});
