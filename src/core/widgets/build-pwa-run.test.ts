/**
 * scripts/build-pwa.mjs builds only when it is the script being run, not when a test imports its helpers. The check has to
 * hold when the repo is reached through a link, or `npm run build:web` would silently build no manifest and no worker.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../scripts/build-pwa.mjs', import.meta.url));
const SCRIPT_URL = pathToFileURL(SCRIPT).href;
const { isDirectRun } = (await import(/* @vite-ignore */ SCRIPT_URL)) as { isDirectRun(argv1: string | undefined, metaUrl: string): boolean };

const temp = mkdtempSync(join(tmpdir(), 'kalam-pwa-run-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe('is this script the one being run', () => {
  it('says yes for its own path and no for anything else', () => {
    expect(isDirectRun(SCRIPT, SCRIPT_URL)).toBe(true);
    expect(isDirectRun(fileURLToPath(import.meta.url), SCRIPT_URL)).toBe(false);
    expect(isDirectRun(undefined, SCRIPT_URL)).toBe(false);
    expect(isDirectRun(join(temp, 'missing.mjs'), SCRIPT_URL)).toBe(false);
  });

  it('says yes when the script is reached through a link, and the build really runs', () => {
    const scripts = join(temp, 'scripts-link');
    try {
      symlinkSync(fileURLToPath(new URL('../../../scripts/', import.meta.url)), scripts, 'junction');
    } catch {
      return; // This machine cannot make links (no permission): nothing to check here.
    }
    const viaLink = join(scripts, 'build-pwa.mjs');
    expect(isDirectRun(viaLink, SCRIPT_URL)).toBe(true);
    // Run for real against a folder with no build in it: it must say so and fail, not exit 0 having done nothing.
    const empty = join(temp, 'dist');
    mkdirSync(empty);
    const run = spawnSync(process.execPath, [viaLink, empty], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('build-pwa:');
  });
});
