/** Test helper: loads KalamSpec fixtures from this folder (Node only; used by *.test.ts). */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// From the string, not `new URL(...)`: under a jsdom test environment the global URL is jsdom's.
const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * `set: 'v11'` reads tests/fixtures/specs/v11/<kind>: format 1.1 documents, kept apart so suites
 * that walk the 1.0 folders are not handed component types they do not know yet.
 */
export function loadFixtures(kind: 'valid' | 'invalid', set?: 'v11'): Array<{ name: string; json: Record<string, unknown> }> {
  const dir = set ? join(ROOT, set, kind) : join(ROOT, kind);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ name: f.replace(/\.json$/, ''), json: JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown> }));
}

export function loadFixture(kind: 'valid' | 'invalid', name: string, set?: 'v11'): Record<string, unknown> {
  return JSON.parse(readFileSync(join(set ? join(ROOT, set) : ROOT, kind, `${name}.json`), 'utf8')) as Record<string, unknown>;
}
