import { describe, expect, it } from 'vitest';

import { clothForPreset, slipNumber, SOURCE_EXPLAIN, SOURCE_STAMP } from './marks';
import { cloths } from './tokens';

describe('order-book numbering', () => {
  it('pads to two digits by default and keeps longer numbers whole', () => {
    expect(slipNumber(1)).toBe('No. 01');
    expect(slipNumber(417, 4)).toBe('No. 0417');
    expect(slipNumber(123)).toBe('No. 123');
  });
  it('never shows a negative, fractional or broken number', () => {
    expect(slipNumber(-3)).toBe('No. 00');
    expect(slipNumber(7.9)).toBe('No. 07');
    expect(slipNumber(Number.NaN)).toBe('No. 00');
  });
  it('takes the translated prefix and keeps the digits', () => {
    expect(slipNumber(7, 2, 'नं.')).toBe('नं. 07');
    expect(slipNumber(417, 4, 'எண்')).toBe('எண் 0417');
  });
});

describe('source stamps', () => {
  it('say which engine ran, each with its own words', () => {
    expect(SOURCE_STAMP.on_device.kind).toBe('device');
    expect(SOURCE_STAMP.cloud.kind).toBe('cloud');
    expect(SOURCE_STAMP.deterministic.kind).toBe('template');
    const labels = Object.values(SOURCE_STAMP).map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
  it('treat offline as normal (graphite), never as needs-check', () => {
    expect(SOURCE_STAMP.offline.kind).toBe('template');
    expect(Object.values(SOURCE_STAMP).some((s) => s.kind === 'needs')).toBe(false);
  });
  it('explain every source', () => {
    expect(Object.keys(SOURCE_EXPLAIN).sort()).toEqual(Object.keys(SOURCE_STAMP).sort());
  });
});

describe('register cloths', () => {
  it('match each KalamSpec theme preset to its own cloth', () => {
    const presets = ['calm_green', 'warm_paper', 'ocean_blue', 'soft_lavender', 'minimal_neutral', 'high_contrast'];
    const picked = presets.map(clothForPreset);
    for (const c of picked) expect(cloths[c]).toBeDefined();
    expect(new Set(picked).size).toBe(presets.length);
  });
  it('fall back to the green cloth for an unknown or missing theme', () => {
    expect(clothForPreset(undefined)).toBe('green');
    expect(clothForPreset('neon')).toBe('green');
  });
});
