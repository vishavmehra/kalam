/** Test helper: loads KalamSpec fixtures from this folder (Node only; used by *.test.ts). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./', import.meta.url));

export function loadFixtures(kind: 'valid' | 'invalid'): Array<{ name: string; json: Record<string, unknown> }> {
  const dir = join(ROOT, kind);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ name: f.replace(/\.json$/, ''), json: JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown> }));
}

export function loadFixture(kind: 'valid' | 'invalid', name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, kind, `${name}.json`), 'utf8')) as Record<string, unknown>;
}
