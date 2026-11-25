import { describe, expect, it } from 'vitest';
import type { InferenceEvent } from '../contracts';
import { hybridMetrics, percentile, WEEK_MS, weeklyCounts } from './metrics';

let n = 0;
const ev = (e: Partial<InferenceEvent>): InferenceEvent => ({
  id: `e${n++}`, at: 0, taskId: 't', taskType: 'classify', route: 'on_device', provider: 'firebase', source: 'on_device',
  latencyMs: 100, success: true, fallbackUsed: false, platform: 'web', ...e,
});

describe('percentile (nearest rank)', () => {
  it('handles empty, single and ordered sets', () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([7], 95)).toBe(7);
    const v = Array.from({ length: 100 }, (_, i) => 100 - i); // 100..1, unsorted on purpose
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile(v, 100)).toBe(100);
    expect(percentile([3, Number.NaN, 1], 50)).toBe(1);
  });
});

describe('hybridMetrics (docs/13 §9.2)', () => {
  const events: InferenceEvent[] = [
    ev({ latencyMs: 100 }),
    ev({ latencyMs: 300 }),
    ev({ success: false, errorCode: 'invalid_output', latencyMs: 5000 }),
    ev({ source: 'cloud', route: 'cloud', latencyMs: 2000, tokens: { input: 100, output: 40 }, retries: 2 }),
    ev({ source: 'cloud', route: 'cloud', latencyMs: 4000, tokens: { input: 50 }, platform: 'android',
      escalationReason: 'on-device failed (timeout); one Firebase cloud fallback', retries: 1, fallbackUsed: true }),
    ev({ source: 'cloud', route: 'cloud', provider: 'none', success: false, errorCode: 'offline', platform: 'android' }),
    ev({ source: 'cloud', route: 'cloud', success: false, errorCode: 'cancelled', platform: 'android' }),
    ev({ latencyMs: 1, cacheHit: true }),
    ev({ source: 'deterministic', route: 'template', provider: 'deterministic', latencyMs: 2 }),
  ];
  const m = hybridMetrics(events);

  it('splits model runs by the source that really ran, with p50 and p95 of successful runs', () => {
    expect(m.onDevice).toEqual({ runs: 3, succeeded: 2, p50Ms: 100, p95Ms: 300 });
    expect(m.cloud).toEqual({ runs: 3, succeeded: 2, p50Ms: 2000, p95Ms: 4000 });
  });

  it('counts cloud fallbacks, cache hits, retries, cancels and tokens', () => {
    expect(m.cloudFallbacks).toEqual({ runs: 1, succeeded: 1 });
    expect(m.cacheHits).toBe(1);
    expect(m.retries).toBe(3);
    expect(m.cancelled).toBe(1);
    expect(m.tokens).toEqual({ input: 150, output: 40 });
  });

  it('gives the failure rate per platform, leaving out cache hits and template decisions', () => {
    expect(m.byPlatform).toEqual([
      { platform: 'web', requests: 4, failed: 1 },
      { platform: 'android', requests: 3, failed: 2 },
    ]);
  });

  it('is all zeros for no events', () => {
    expect(hybridMetrics([])).toMatchObject({
      onDevice: { runs: 0, succeeded: 0, p50Ms: null, p95Ms: null }, cacheHits: 0, retries: 0, byPlatform: [],
    });
  });
});

describe('weeklyCounts (docs/00 §13.2, docs/01 §10.3)', () => {
  it('counts the last seven days of real on-device actions and cloud runs', () => {
    const now = 10 * WEEK_MS;
    const recent = now - 1000;
    const counts = weeklyCounts([
      ev({ at: recent }),
      ev({ at: recent, taskType: 'summarize' }),
      ev({ at: recent, taskType: 'create_app', source: 'on_device' }), // not a user-facing action
      ev({ at: recent, success: false }),
      ev({ at: recent, cacheHit: true }),
      ev({ at: now - WEEK_MS - 1 }), // older than a week
      ev({ at: recent, source: 'cloud', route: 'cloud', taskType: 'create_app' }),
      ev({ at: recent, source: 'deterministic', route: 'template', provider: 'deterministic' }),
    ], now);
    expect(counts).toEqual({ since: now - WEEK_MS, onDevice: 2, cloud: 1 });
  });
});
