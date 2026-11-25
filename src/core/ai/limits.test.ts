import { afterEach, describe, expect, it, vi } from 'vitest';
import { backoffDelay, createTokenBuckets, MAX_RATE_WAIT_MS, rateLimitFor, RETRY_LIMITS, sleep } from './limits';

afterEach(() => {
  vi.useRealTimers();
});

describe('backoffDelay: exponential backoff with full jitter', () => {
  it('draws a wait between 0 and min(cap, 500 ms x 2^attempt)', () => {
    expect(backoffDelay(0, () => 0)).toBe(0);
    expect(backoffDelay(0, () => 0.999)).toBe(499);
    expect(backoffDelay(0, () => 1)).toBe(500);
    expect(backoffDelay(1, () => 1)).toBe(1000);
    expect(backoffDelay(2, () => 0.5)).toBe(1000);
    expect(backoffDelay(3, () => 1)).toBe(4000);
  });

  it('never waits longer than the cap', () => {
    expect(backoffDelay(4, () => 1)).toBe(8000);
    expect(backoffDelay(20, () => 1)).toBe(8000);
    expect(backoffDelay(20, () => 1, 100, 300)).toBe(300);
  });
});

describe('retry budget', () => {
  it('retries rate limits, service errors and network drops twice, a timeout once, nothing else', () => {
    expect(RETRY_LIMITS).toEqual({ quota: 2, provider_error: 2, offline: 2, timeout: 1 });
  });
});

describe('token bucket per task', () => {
  it('lets a burst up to capacity through, then queues callers behind the refill', () => {
    let t = 0;
    const b = createTokenBuckets(() => t, () => ({ capacity: 2, perMinute: 60 })); // one token a second
    expect(b.reserve('classify')).toBe(0);
    expect(b.reserve('classify')).toBe(0);
    expect(b.reserve('classify')).toBe(1000);
    expect(b.reserve('classify')).toBe(2000); // waits behind the caller before it
    expect(b.reserve('classify', 2500)).toBe(-1); // 3000 ms is too long: refused, nothing taken
    t = 3000;
    expect(b.reserve('classify')).toBe(0);
  });

  it('refills over time but never above capacity', () => {
    let t = 0;
    const b = createTokenBuckets(() => t, () => ({ capacity: 2, perMinute: 60 }));
    b.reserve('summarize');
    b.reserve('summarize');
    t = 60_000; // a minute is 60 tokens, capped at 2
    expect(b.reserve('summarize')).toBe(0);
    expect(b.reserve('summarize')).toBe(0);
    expect(b.reserve('summarize')).toBe(1000);
  });

  it('keeps a separate bucket for each task', () => {
    const b = createTokenBuckets(() => 0, () => ({ capacity: 1, perMinute: 1 }));
    expect(b.reserve('classify')).toBe(0);
    expect(b.reserve('classify')).toBe(-1);
    expect(b.reserve('translate')).toBe(0);
  });

  it('gives compile, repair and safety tasks tighter limits than AI blocks', () => {
    for (const task of ['create_app', 'plan_app', 'modify_app', 'interpret_sketch', 'repair_spec', 'safety_review'] as const) {
      expect(rateLimitFor(task)).toEqual({ capacity: 6, perMinute: 6 });
    }
    for (const task of ['classify', 'summarize', 'translate', 'voice_action', 'generate_patch', 'verify_ai_block'] as const) {
      expect(rateLimitFor(task)).toEqual({ capacity: 20, perMinute: 30 });
    }
    expect(MAX_RATE_WAIT_MS).toBe(5000);
  });

  it('with the real limits, the seventh compile in a burst is refused instead of waiting ten seconds', () => {
    const b = createTokenBuckets(() => 0);
    for (let i = 0; i < 6; i++) expect(b.reserve('create_app')).toBe(0);
    expect(b.reserve('create_app')).toBe(-1);
    // An AI block burst waits two seconds per extra call, up to the five second ceiling.
    for (let i = 0; i < 20; i++) b.reserve('summarize');
    expect(b.reserve('summarize')).toBe(2000);
    expect(b.reserve('summarize')).toBe(4000);
    expect(b.reserve('summarize')).toBe(-1);
  });
});

describe('sleep', () => {
  it('resolves after the delay', async () => {
    vi.useFakeTimers();
    let done = false;
    void sleep(1000).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('resolves at once when the signal aborts, or was aborted already, and for no delay', async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    let done = false;
    void sleep(60_000, ac.signal).then(() => { done = true; });
    ac.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    await expect(sleep(60_000, ac.signal)).resolves.toBeUndefined();
    await expect(sleep(0)).resolves.toBeUndefined();
  });
});
