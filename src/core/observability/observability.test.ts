import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { AIErrorCode } from '@/core/contracts';

import { createErrorLog, KNOWN_ERROR_CODES, toErrorCode } from './errors';
import { createTimingLog, TIMING_NAMES } from './timing';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const source = (file: string) => readFileSync(`${ROOT}${file}`, 'utf8');
const found = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((m) => m[1]);

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

  it('keeps a ring for each name, so a burst of one name cannot push out the others', () => {
    const log = createTimingLog({ capacity: 3 });
    log.record('app_open', 100);
    log.record('record_write', 7);
    for (let i = 1; i <= 20; i += 1) log.record('spec_validate', i);
    expect(log.events().filter((e) => e.name === 'spec_validate').map((e) => e.ms)).toEqual([18, 19, 20]);
    expect(log.summarize().map((s) => [s.name, s.runs])).toEqual([['app_open', 1], ['spec_validate', 3], ['record_write', 1]]);
    // Oldest first across names.
    expect(log.events()[0].name).toBe('app_open');
    expect(log.events()[1].name).toBe('record_write');
  });

  it('keeps at least one event even when asked for none', () => {
    for (const capacity of [0, -4, Number.NaN]) {
      const log = createTimingLog({ capacity });
      for (let i = 1; i <= 5; i += 1) log.record('app_open', i);
      expect(log.events().length).toBeGreaterThanOrEqual(1);
      expect(log.events().length).toBeLessThanOrEqual(50);
    }
    const one = createTimingLog({ capacity: 0 });
    one.record('app_open', 1);
    one.record('app_open', 2);
    expect(one.events().map((e) => e.ms)).toEqual([2]);
  });

  it('a subscriber that throws does not break the work being timed', async () => {
    const log = createTimingLog();
    log.subscribe(() => { throw new Error('bad subscriber'); });
    await expect(log.time('record_write', async () => 42)).resolves.toBe(42);
    expect(log.time('spec_validate', () => 'ok')).toBe('ok');
    expect(log.record('app_open', 3)).toBeDefined();
    expect(log.events()).toHaveLength(3);
    expect(() => log.clear()).not.toThrow();
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
    expect(log.summarize().map((s) => s.name)).toEqual(['app_open', 'record_write']);
    expect(TIMING_NAMES).toContain('spec_validate');
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

  it('lists every AI error code from the contract (a new contract code fails this file to compile)', () => {
    // Record<AIErrorCode, true> has no missing key and no extra key only while it matches the contract.
    const aiCodes: Record<AIErrorCode, true> = {
      offline: true, consent_denied: true, model_unavailable: true, not_configured: true, timeout: true,
      invalid_output: true, provider_error: true, quota: true, unsupported_modality: true, cancelled: true,
      app_check_failed: true, bad_request: true,
    };
    for (const code of Object.keys(aiCodes)) expect(KNOWN_ERROR_CODES).toContain(code);
  });

  it('has no repeated code', () => {
    expect(new Set(KNOWN_ERROR_CODES).size).toBe(KNOWN_ERROR_CODES.length);
  });

  it('lists every code the validator, the edit patcher, storage, backup and sharing raise', () => {
    const raised = [
      ...found(source('src/core/spec/validate.ts'), /\.error\(\s*'([A-Z_]+)'/g),
      ...found(source('src/core/spec/validate.ts'), /return '([A-Z_]+)'/g),
      ...found(source('src/core/edit/apply.ts'), /opError\([^,]+,\s*'([A-Z_]+)'/g),
      ...found(source('src/infrastructure/storage/storage-limits.ts'), /readonly code = '([a-z_]+)'/g),
      ...found(source('src/infrastructure/storage/migrations.ts'), /readonly code = '([a-z_]+)'/g),
      ...found(source('src/core/share/service.ts'), /readonly code = '([a-z_]+)'/g),
      ...found(source('src/core/backup/errors.ts').split('const MESSAGES')[0], /\|\s*'([a-z_]+)'/g),
    ];
    // A scan that finds nothing would pass for the wrong reason.
    expect(raised.length).toBeGreaterThan(30);
    expect(raised.filter((code) => !(KNOWN_ERROR_CODES as readonly string[]).includes(code))).toEqual([]);
  });

  it('knows a typed error by its class name, without ever reading its message', () => {
    for (const [name, code] of [['InvalidSpecError', 'invalid_spec'], ['RecordValidationError', 'record_invalid'], ['ShareStoreError', 'share_store']]) {
      const error = Object.assign(new Error('Invalid record: name: Asha Verma is not a number'), { name });
      expect(toErrorCode(error)).toBe(code);
    }
    expect(toErrorCode(Object.assign(new Error('x'), { name: 'TypeError' }))).toBe('other');
    expect(toErrorCode(Object.assign(new Error('x'), { name: 'toString' }))).toBe('other');
    expect(toErrorCode(Object.assign(new Error('x'), { name: 'constructor' }))).toBe('other');
  });

  it('knows the codes that real classes in the app carry', () => {
    for (const code of ['PATCH_INVALID', 'PATCH_TOO_LARGE', 'shared_record_read_only', 'media_permission', 'video_too_long']) {
      expect(toErrorCode({ code })).toBe(code);
    }
  });

  it('a subscriber that throws does not break noting an error', () => {
    const log = createErrorLog();
    log.subscribe(() => { throw new Error('bad subscriber'); });
    expect(log.note('timeout')).toBe('timeout');
    expect(log.recent()).toHaveLength(1);
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
