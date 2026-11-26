import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FONT_NOTICES, OSS_NOTICES } from './oss-notices-data';

describe('open-source notices (D01-042)', () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as { dependencies: Record<string, string> };

  it('lists every shipped dependency, sorted, each with a version and a licence', () => {
    expect(OSS_NOTICES.map((n) => n.name)).toEqual(Object.keys(pkg.dependencies).sort((a, b) => a.localeCompare(b)));
    for (const n of OSS_NOTICES) {
      expect(n.version, n.name).toMatch(/^\d+\.\d+\.\d+/);
      expect(n.license.length, n.name).toBeGreaterThan(1);
      expect(n.license, n.name).not.toMatch(/unlicensed/i);
    }
  });

  it('names the bundled font families and their makers', () => {
    expect(FONT_NOTICES.length).toBeGreaterThanOrEqual(4);
    for (const f of FONT_NOTICES) expect(f.by.length).toBeGreaterThan(2);
  });
});
