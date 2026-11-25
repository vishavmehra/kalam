import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkBundle,
  checkSpecSizes,
  checkTimingBudgets,
  summarizeSamples,
  timeRuns,
  type BundleBudgets,
} from './perf';

const budgetsFile = JSON.parse(readFileSync(new URL('../perf/budgets.json', import.meta.url), 'utf8')) as {
  web: BundleBudgets;
  node: Record<string, { p95Ms: number }>;
  spec: { maxBytes: number; productTargetBytes: number };
  productTargets: Array<{ metric: string; target: string; measuredBy: string }>;
};

describe('timing', () => {
  it('reports the first run as cold and the rest as warm', () => {
    const t = summarizeSamples([50, 2, 4, 3, 100]);
    expect(t).toEqual({ runs: 5, coldMs: 50, medianMs: 3.5, p95Ms: 100, maxMs: 100 });
  });

  it('works with a single sample and rejects none', () => {
    expect(summarizeSamples([7])).toMatchObject({ runs: 1, coldMs: 7, medianMs: 7, p95Ms: 7 });
    expect(() => summarizeSamples([])).toThrow();
    expect(() =>
      timeRuns(
        () => 1,
        0,
        () => 0,
      ),
    ).toThrow(/at least 1/);
  });

  it('times a function with the injected clock', () => {
    let clock = 0;
    const ticks = [1, 1, 1, 1];
    const t = timeRuns(
      () => {
        clock += ticks.shift() ?? 0;
      },
      4,
      () => clock,
    );
    expect(t).toMatchObject({ runs: 4, coldMs: 1, medianMs: 1, maxMs: 1 });
  });

  it('names every benchmark that misses its p95 budget and ignores ones without a budget', () => {
    const slow = { runs: 10, coldMs: 1, medianMs: 1, p95Ms: 99, maxMs: 99 };
    const fast = { runs: 10, coldMs: 1, medianMs: 1, p95Ms: 5, maxMs: 5 };
    expect(
      checkTimingBudgets(
        { classify: slow, validate: fast, extra: slow },
        { classify: { p95Ms: 25 }, validate: { p95Ms: 10 } },
      ),
    ).toEqual(['classify: p95 99 ms is over the 25 ms budget']);
  });
});

describe('bundle budget', () => {
  const file = (path: string, bytes: number, gz = Math.round(bytes / 4)) => ({ path, bytes, gzipBytes: gz });
  const budgets: BundleBudgets = {
    totalJsBytes: 1000,
    totalJsGzipBytes: 300,
    largestChunkBytes: 600,
    initialJsBytes: 700,
  };

  it('sums JavaScript only and counts the entry and shared chunks as the first screen', () => {
    const r = checkBundle(
      [
        file('_expo/static/js/web/entry-abc123.js', 200),
        file('_expo/static/js/web/__common-def456.js', 400),
        file('_expo/static/js/web/hero-scene-0a1b.js', 300),
        file('assets/logo.png', 99999),
      ],
      budgets,
    );
    expect(r).toMatchObject({ totalJsBytes: 900, initialJsBytes: 600, largest: { bytes: 400 } });
    expect(r.violations).toEqual([]);
  });

  it('names each budget that is exceeded', () => {
    const r = checkBundle(
      [file('_expo/static/js/web/entry-abc123.js', 500), file('_expo/static/js/web/__common-def456.js', 700, 320)],
      budgets,
    );
    expect(r.violations.join('\n')).toMatch(/total JavaScript 0\.00 MB is over the 0\.00 MB budget/);
    expect(r.violations).toHaveLength(4);
    expect(r.violations.join('\n')).toMatch(/largest chunk _expo\/static\/js\/web\/__common-def456\.js/);
  });

  it('handles a build with no JavaScript', () => {
    expect(checkBundle([], budgets)).toMatchObject({ totalJsBytes: 0, largest: null, violations: [] });
  });
});

describe('spec size', () => {
  it('flags an app over the 100 KB cap and one over the 1 MB product target', () => {
    const b = { maxBytes: 100, productTargetBytes: 1000 };
    expect(checkSpecSizes({ small: 50, edge: 100 }, b)).toEqual([]);
    expect(checkSpecSizes({ big: 101 }, b)).toEqual(['big: 101 bytes is over the 100 byte spec cap']);
    expect(checkSpecSizes({ huge: 5000 }, { maxBytes: 10_000, productTargetBytes: 1000 })).toEqual([
      'huge: 5000 bytes is over the 1 MB product target',
    ]);
  });
});

describe('budgets.json', () => {
  it('matches the product targets in docs/13 §17', () => {
    expect(budgetsFile.spec.productTargetBytes).toBe(1_048_576);
    expect(budgetsFile.spec.maxBytes).toBe(102_400);
    const metrics = budgetsFile.productTargets.map((t) => t.metric);
    for (const m of [
      'Cold start',
      'Open an app from the shelf',
      'Common on-device AI operation',
      'Application compilation',
      'Generated application size',
      'Initial installation',
    ]) {
      expect(metrics).toContain(m);
    }
  });

  it('says honestly which targets are not measured yet', () => {
    const notMeasured = budgetsFile.productTargets.filter((t) => /not measured|needs/i.test(t.measuredBy));
    expect(notMeasured.length).toBeGreaterThanOrEqual(3);
  });
});
