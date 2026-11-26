import { describe, expect, it } from 'vitest';
import type { InferenceEvent } from '../contracts';
import { hybridMetrics, percentile, WEEK_MS, weeklyCounts } from './metrics';

let n = 0;
const ev = (e: Partial<InferenceEvent>): InferenceEvent => ({
  id: `e${n}`, at: 0, taskId: `t${n++}`, taskType: 'classify', route: 'on_device', provider: 'firebase', source: 'on_device',
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
    // The one cloud fallback: the failed device attempt and the cloud call share a taskId.
    ev({ taskId: 'fb', platform: 'android', success: false, errorCode: 'timeout', latencyMs: 9000 }),
    ev({ taskId: 'fb', source: 'cloud', route: 'cloud', latencyMs: 4000, tokens: { input: 50, output: Number.NaN }, platform: 'android', fallbackUsed: true }),
    ev({ source: 'cloud', route: 'cloud', provider: 'none', success: false, errorCode: 'offline', platform: 'android' }),
    ev({ source: 'cloud', route: 'cloud', success: false, errorCode: 'cancelled', platform: 'android' }),
    ev({ latencyMs: 1, cacheHit: true }),
    ev({ source: 'deterministic', route: 'template', provider: 'deterministic', latencyMs: 2 }),
  ];
  const m = hybridMetrics(events);

  it('splits model runs by the source that really ran, counting failed device attempts before a fallback', () => {
    expect(m.onDevice).toEqual({ runs: 4, succeeded: 2, p50Ms: 100, p95Ms: 300 });
    expect(m.cloud).toEqual({ runs: 2, succeeded: 2, p50Ms: 2000, p95Ms: 4000 });
  });

  it('counts cloud fallbacks by taskId, cache hits, retries, cancels, client stops and finite tokens', () => {
    expect(m.cloudFallbacks).toEqual({ runs: 1, succeeded: 1 });
    expect(m.cacheHits).toBe(1);
    expect(m.retries).toBe(2);
    expect(m.cancelled).toBe(1);
    expect(m.clientStops).toBe(1);
    expect(m.tokens).toEqual({ input: 150, output: 40 });
  });

  it('gives the failure rate per platform over the same model runs, leaving out cancels and stops', () => {
    expect(m.byPlatform).toEqual([
      { platform: 'web', requests: 4, failed: 1 },
      { platform: 'android', requests: 2, failed: 1 },
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
    expect(counts).toEqual({ since: now - WEEK_MS, onDevice: 2, cloud: 1, truncated: false });
  });

  it('says when the capped event list does not reach back a whole week', () => {
    const now = 10 * WEEK_MS;
    const full = Array.from({ length: 500 }, () => ev({ at: now - 1000 }));
    expect(weeklyCounts(full, now, 500).truncated).toBe(true);
    expect(weeklyCounts(full, now).truncated).toBe(false); // no limit given: cannot tell
    expect(weeklyCounts([...full.slice(1), ev({ at: now - WEEK_MS - 1 })], now, 500).truncated).toBe(false);
    expect(weeklyCounts(full.slice(0, 10), now, 500).truncated).toBe(false);
  });
});
