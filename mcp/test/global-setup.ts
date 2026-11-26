import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Builds dist/server.js before the tests, so the stdio test runs the current source: never a stale or missing bundle. */
export default function setup(): void {
  execFileSync(process.execPath, ['build.mjs'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe' });
}
