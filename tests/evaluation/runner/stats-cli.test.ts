import { describe, expect, it } from 'vitest';
import { budgetSkipReason, parseArgs, reportFileName, selectCases, UsageError } from './cli';
import { DEFAULT_THRESHOLDS } from './metrics';
import { latencyStats, median, mergeRates, percentile, rate, round } from './stats';
import type { GoldenModalityCase, GoldenSketchCase, GoldenTextCase } from './types';

describe('stats', () => {
  it('rate keeps totals and returns null for an empty population', () => {
    expect(rate(3, 4)).toEqual({ correct: 3, total: 4, rate: 0.75 });
    expect(rate(0, 0)).toEqual({ correct: 0, total: 0, rate: null });
    expect(rate(1, 3).rate).toBe(0.333);
  });

  it('merges rates by summing counts, not averaging rates', () => {
    expect(mergeRates([rate(1, 2), rate(3, 8)])).toEqual({ correct: 4, total: 10, rate: 0.4 });
  });

  it('percentile uses nearest rank', () => {
    const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(100);
    expect(percentile(xs, 10)).toBe(10);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBeNull();
  });

  it('median handles odd, even and empty lists without mutating the input', () => {
    const xs = [3, 1, 2];
    expect(median(xs)).toBe(2);
    expect(xs).toEqual([3, 1, 2]);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('latencyStats summarises a list and tolerates none', () => {
    expect(latencyStats([5, 1, 9])).toEqual({ count: 3, medianMs: 5, p95Ms: 9, maxMs: 9 });
    expect(latencyStats([])).toEqual({ count: 0, medianMs: null, p95Ms: null, maxMs: null });
    expect(round(1.23456, 2)).toBe(1.23);
  });
});

describe('parseArgs', () => {
  it('defaults to a deterministic run that spends nothing and writes a report', () => {
    const a = parseArgs([]);
    expect(a).toMatchObject({ mode: 'deterministic', budget: 0, write: true, check: false, json: false, cases: [] });
    expect(a.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('refuses --live without an explicit budget so nothing is spent by accident', () => {
    expect(() => parseArgs(['--live'])).toThrow(UsageError);
    expect(() => parseArgs(['--live'])).toThrow(/--budget/);
  });

  it('accepts --live with a budget, including 0', () => {
    expect(parseArgs(['--live', '--budget', '6'])).toMatchObject({ mode: 'live', budget: 6 });
    expect(parseArgs(['--budget', '0', '--live'])).toMatchObject({ mode: 'live', budget: 0 });
  });

  it('refuses a budget on a deterministic run and bad budgets', () => {
    expect(() => parseArgs(['--budget', '3'])).toThrow(/only applies with --live/);
    expect(() => parseArgs(['--live', '--budget', '-1'])).toThrow(UsageError);
    expect(() => parseArgs(['--live', '--budget', '2.5'])).toThrow(UsageError);
    expect(() => parseArgs(['--live', '--budget'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--live', '--budget', '--check'])).toThrow(/needs a value/);
  });

  it('parses selection, output and gate flags', () => {
    const a = parseArgs([
      '--only',
      'sketch',
      '--case',
      's01-calculator',
      '--case',
      's02-water-counter',
      '--out-dir',
      'x',
      '--no-write',
      '--check',
      '--json',
    ]);
    expect(a).toMatchObject({
      only: 'sketch',
      cases: ['s01-calculator', 's02-water-counter'],
      outDir: 'x',
      write: false,
      check: true,
      json: true,
    });
  });

  it('parses and range-checks threshold overrides', () => {
    expect(parseArgs(['--min-text-complexity', '0.9']).thresholds.textComplexity).toBe(0.9);
    expect(() => parseArgs(['--min-text-route', '1.5'])).toThrow(/0 to 1/);
    expect(() => parseArgs(['--min-text-route', 'abc'])).toThrow(/0 to 1/);
  });

  it('rejects unknown options and unknown --only values', () => {
    expect(() => parseArgs(['--wat'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['--only', 'telepathy'])).toThrow(
      /must be one of: text, sketch, image, audio, video, mixed/,
    );
    expect(parseArgs(['--only', 'video']).only).toBe('video');
    expect(parseArgs(['--help']).help).toBe(true);
  });
});

describe('selectCases and file names', () => {
  const text = [{ id: 't1' }, { id: 't2' }] as GoldenTextCase[];
  const sketches = [{ id: 's1' }] as GoldenSketchCase[];
  const modalities = [
    { id: 'mi1', modality: 'image' },
    { id: 'ma1', modality: 'audio' },
  ] as GoldenModalityCase[];
  const golden = { text, sketches, modalities };

  it('selects everything by default, one dataset with --only, and named cases', () => {
    expect(selectCases(golden, { cases: [] })).toMatchObject({
      text: [{ id: 't1' }, { id: 't2' }],
      sketches: [{ id: 's1' }],
      modalities: [{ id: 'mi1' }, { id: 'ma1' }],
    });
    const onlyText = selectCases(golden, { only: 'text', cases: [] });
    expect([onlyText.sketches, onlyText.modalities]).toEqual([[], []]);
    const onlySketch = selectCases(golden, { only: 'sketch', cases: [] });
    expect([onlySketch.text, onlySketch.modalities]).toEqual([[], []]);
    expect(selectCases(golden, { only: 'audio', cases: [] }).modalities.map((c) => c.id)).toEqual(['ma1']);
    const named = selectCases(golden, { cases: ['t2', 's1', 'mi1'] });
    expect(named.text.map((c) => c.id)).toEqual(['t2']);
    expect(named.sketches.map((c) => c.id)).toEqual(['s1']);
    expect(named.modalities.map((c) => c.id)).toEqual(['mi1']);
  });

  it('reports unknown case ids and works without modality cases', () => {
    expect(selectCases(golden, { cases: ['nope', 't1'] }).unknown).toEqual(['nope']);
    expect(selectCases({ text, sketches }, { cases: [] }).modalities).toEqual([]);
  });

  it('names reports with the date, time and mode, safe for any file system', () => {
    const name = reportFileName(new Date('2026-11-18T01:30:45.123Z'), 'deterministic');
    expect(name).toBe('eval-2026-11-18T01-30-45-123Z-deterministic.json');
    expect(name).not.toMatch(/[:*?"<>|\\/]/);
  });

  it('stops live compiles once the budget is used', () => {
    expect(budgetSkipReason(0, 3)).toBeUndefined();
    expect(budgetSkipReason(2, 3)).toBeUndefined();
    expect(budgetSkipReason(3, 3)).toMatch(/budget/i);
    expect(budgetSkipReason(0, 0)).toMatch(/budget/i);
  });
});
