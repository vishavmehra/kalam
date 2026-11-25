import { describe, expect, it } from 'vitest';

import { createErrorLog, KNOWN_ERROR_CODES, toErrorCode } from './errors';
import { createTimingLog, TIMING_NAMES } from './timing';

/** A fake clock the test moves by hand. */
function fakeClock() {
  let t = 1_000;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('timing log', () => {
  it('measures a start and stop in milliseconds', () => {
    const c = fakeClock();
    const log = createTimingLog({ clock: c.now, wall: () => 42 });
    const run = log.start('app_open');
    c.advance(125);
    expect(run.stop()).toEqual({ name: 'app_open', ms: 125, at: 42, ok: true });
    expect(log.events()).toHaveLength(1);
  });

  it('a second stop does nothing', () => {
    const c = fakeClock();
    const log = createTimingLog({ clock: c.now });
    const run = log.start('spec_validate');
    c.advance(5);
    run.stop();
    expect(run.stop()).toBeUndefined();
    expect(log.events()).toHaveLength(1);
  });

  it('keeps a count only when it is a small whole number', () => {
    const log = createTimingLog();
    expect(log.record('record_write', 3, { count: 12 })?.count).toBe(12);
    expect(log.record('record_write', 3, { count: -1 })).not.toHaveProperty('count');
    expect(log.record('record_write', 3, { count: 1.5 })).not.toHaveProperty('count');
    expect(log.record('record_write', 3, { count: 'many' as unknown as number })).not.toHaveProperty('count');
  });

  it('ignores bad names and bad durations', () => {
    const log = createTimingLog();
    expect(log.record('open_secret_app' as never, 5)).toBeUndefined();
    expect(log.record('app_open', Number.NaN)).toBeUndefined();
    expect(log.record('app_open', Infinity)).toBeUndefined();
    expect(log.record('app_open', -3)).toBeUndefined();
    expect(log.record('app_open', '5' as unknown as number)).toBeUndefined();
    expect(log.events()).toHaveLength(0);
  });

  it('never accepts content fields: only name, ms, at, ok and count are stored', () => {
    const log = createTimingLog({ wall: () => 7 });
    const sneaky = {
      ok: false,
      count: 2,
      appId: 'app_secret123',
      recordId: 'rec_9',
      value: 'Asha Verma owes 4,500',
      prompt: 'make me an app for my clinic',
      fileName: 'passport-scan.jpg',
    };
    const event = log.record('record_write', 8.26, sneaky);
    expect(event).toEqual({ name: 'record_write', ms: 8.3, at: 7, ok: false, count: 2 });
    const stored = JSON.stringify(log.events()) + JSON.stringify(log.summarize());
    for (const secret of ['app_secret123', 'rec_9', 'Asha', 'clinic', 'passport']) expect(stored).not.toContain(secret);
    for (const e of log.events()) expect(Object.keys(e).sort()).toEqual(['at', 'count', 'name', 'ok', 'ms'].sort());
  });

  it('events are plain data: a name that merely contains content cannot be stored', () => {
    const log = createTimingLog();
    log.record('app_open: Asha clinic' as never, 5);
    log.record('' as never, 5);
    expect(log.events()).toEqual([]);
  });

  it('is a bounded ring that drops the oldest event', () => {
    const log = createTimingLog({ capacity: 3 });
    for (let i = 1; i <= 5; i += 1) log.record('app_open', i);
    expect(log.events().map((e) => e.ms)).toEqual([3, 4, 5]);
  });

  it('time() wraps sync code, async code and failures', async () => {
    const c = fakeClock();
    const log = createTimingLog({ clock: c.now });
    expect(log.time('spec_validate', () => { c.advance(10); return 'ok'; })).toBe('ok');
    await expect(log.time('record_write', async () => { c.advance(20); return 7; })).resolves.toBe(7);
    expect(() => log.time('app_open', () => { c.advance(1); throw new Error('boom'); })).toThrow('boom');
    await expect(log.time('app_open', async () => { c.advance(2); throw new Error('later'); })).rejects.toThrow('later');
    expect(log.events().map((e) => [e.name, e.ms, e.ok])).toEqual([
      ['spec_validate', 10, true], ['record_write', 20, true], ['app_open', 1, false], ['app_open', 2, false],
    ]);
  });

  it('summarizes per name with median, slowest 5 percent and failures', () => {
    const log = createTimingLog();
    for (const ms of [10, 20, 30, 40, 100]) log.record('record_write', ms);
    log.record('record_write', 5, { ok: false });
    log.record('app_open', 300);
    expect(log.summarize()).toEqual([
      { name: 'app_open', runs: 1, failed: 0, medianMs: 300, p95Ms: 300, maxMs: 300 },
      { name: 'record_write', runs: 6, failed: 1, medianMs: 20, p95Ms: 100, maxMs: 100 },
    ]);
    expect(log.summarize().map((s) => s.name)).toEqual(TIMING_NAMES.filter((n) => n !== 'spec_validate'));
  });

  it('tells subscribers when it changes, and stops after unsubscribe', () => {
    const log = createTimingLog();
    let calls = 0;
    const off = log.subscribe(() => { calls += 1; });
    const before = log.version();
    log.record('app_open', 1);
    log.clear();
    expect(calls).toBe(2);
    expect(log.version()).toBe(before + 2);
    off();
    log.record('app_open', 1);
    expect(calls).toBe(2);
  });
});

describe('error codes', () => {
  it('keeps a known code, from a string or from an error object', () => {
    expect(toErrorCode('timeout')).toBe('timeout');
    expect(toErrorCode('SPEC_TOO_LARGE')).toBe('SPEC_TOO_LARGE');
    expect(toErrorCode(Object.assign(new Error('x'), { code: 'record_limit' }))).toBe('record_limit');
    expect(toErrorCode({ code: 'quota' })).toBe('quota');
  });

  it('turns everything else into other, so a message can never leak', () => {
    expect(toErrorCode('Could not save the order for Asha Verma')).toBe('other');
    expect(toErrorCode(new Error('prompt: make a clinic app'))).toBe('other');
    expect(toErrorCode({ code: 'asha' })).toBe('other');
    expect(toErrorCode(undefined)).toBe('other');
    expect(toErrorCode(null)).toBe('other');
    expect(toErrorCode(42)).toBe('other');
  });

  it('lists every AI error code from the contract', () => {
    for (const code of ['offline', 'consent_denied', 'model_unavailable', 'not_configured', 'timeout', 'invalid_output',
      'provider_error', 'quota', 'unsupported_modality', 'cancelled', 'app_check_failed', 'bad_request']) {
      expect(KNOWN_ERROR_CODES).toContain(code);
    }
  });

  it('keeps recent errors newest first, bounded, with only a code and a time', () => {
    const log = createErrorLog(3, () => 9);
    for (const c of ['timeout', 'offline', 'quota', 'Customer Asha failed']) log.note(c);
    expect(log.recent()).toEqual([{ code: 'other', at: 9 }, { code: 'quota', at: 9 }, { code: 'offline', at: 9 }]);
    expect(JSON.stringify(log.recent())).not.toContain('Asha');
    log.clear();
    expect(log.recent()).toEqual([]);
  });
});
