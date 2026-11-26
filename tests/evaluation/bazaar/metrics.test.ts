import { describe, expect, it } from 'vitest';

import { computeBazaarMetrics, failures, NOT_MEASURED } from './metrics';

describe('Bazaar evaluation metrics (docs/12 §22.5)', () => {
  it('measures the core correctly: no rate falls under its floor and the scan keeps its precision', async () => {
    const m = await computeBazaarMetrics({ runs: 5 });
    expect(failures(m)).toEqual([]);
  }, 60_000);

  it('reports every rate with its corpus size, so a rate is never given without a count', async () => {
    const m = await computeBazaarMetrics({ runs: 5 });
    const ids = m.rates.map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'invalid_listing_rejection',
        'valid_listing_acceptance',
        'install_success',
        'tamper_rejection',
        'remix_license',
        'preview_safety',
        'update_migration',
        'update_diff',
        'compat_gate',
        'purchase_correctness',
      ]),
    );
    for (const r of m.rates) {
      expect(r.result.total, r.id).toBeGreaterThan(0);
      expect(r.what.length, r.id).toBeGreaterThan(20);
    }
    expect(m.latencies.map((l) => l.id)).toEqual([
      'search_latency',
      'preview_startup',
      'install_prepare',
      'publish_prepare',
    ]);
    for (const l of m.latencies) expect(l.medianMs, l.id).not.toBeNull();
  }, 60_000);

  it('reports the scan misses instead of hiding them', async () => {
    const { scan } = await computeBazaarMetrics({ runs: 5 });
    expect(scan.positives).toBeGreaterThan(0);
    expect(scan.negatives).toBeGreaterThan(0);
    expect(scan.truePositives + scan.missed.length).toBe(scan.positives);
    expect(scan.falsePositives).toBe(scan.wronglyFlagged.length);
  }, 60_000);

  it('lists what it could not measure, with a reason', () => {
    expect(NOT_MEASURED.length).toBeGreaterThanOrEqual(4);
    for (const n of NOT_MEASURED) expect(n.why.length, n.id).toBeGreaterThan(20);
  });
});
