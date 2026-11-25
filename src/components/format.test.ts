import { describe, expect, it } from 'vitest';

import { countLabel, formatLatency } from './format';

describe('format helpers', () => {
  it('uses plural rules for counts', () => {
    expect(countLabel(1, 'app', 'apps')).toBe('1 app');
    expect(countLabel(0, 'app', 'apps')).toBe('0 apps');
    expect(countLabel(1200, 'app', 'apps')).toBe('1,200 apps');
  });

  it('formats latency without dashes', () => {
    expect(formatLatency(412)).toBe('412 ms');
    expect(formatLatency(2400)).toBe('2.4 s');
    expect(formatLatency(undefined)).toBe('-');
  });
});
