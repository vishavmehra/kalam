/**
 * Hermes (the Android and iOS JS engine) lacks some Intl constructors. `new Intl.ListFormat` in the Drawing Studio
 * crashed the Android release build on open (2026-11-26). App code uses the guarded helpers in src/i18n instead
 * (useFormat().list, relativeTime, graphemes), which fall back when the constructor is missing.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const UNGUARDED = /new\s+Intl\.(ListFormat|RelativeTimeFormat|Segmenter)\s*\(/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('Intl constructors Hermes may lack', () => {
  it('are only built inside the guarded helpers in src/i18n', () => {
    const offenders = [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'modules'))]
      .map((path) => relative(ROOT, path).split(sep).join('/'))
      .filter((path) => !path.startsWith('src/i18n/'))
      .filter((path) => UNGUARDED.test(readFileSync(join(ROOT, path), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
