#!/usr/bin/env node
/**
 * Web bundle budget check (docs/13 §17.2, docs/15 §11.6): total, gzipped, largest-chunk and first-screen JavaScript
 * of a production web build, against tests/evaluation/perf/budgets.json. Reads the build only; nothing is started.
 *
 *   node scripts/check-bundle-size.mjs [distDir] [--write] [--no-fail]
 *
 * Exit 1 when a budget is exceeded (unless --no-fail). --write saves a dated report to tests/evaluation/reports/.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const dist = resolve(args.find((a) => !a.startsWith('--')) ?? join(ROOT, 'dist'));
const write = args.includes('--write');
const noFail = args.includes('--no-fail');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

async function main() {
  try {
    statSync(dist);
  } catch {
    console.error(`No build found at ${dist}. Run "npm run build:web" first.`);
    return 2;
  }
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    resolve: { alias: { '@': join(ROOT, 'src') } },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { checkBundle } = await vite.ssrLoadModule('/tests/evaluation/runner/perf.ts');
    const budgets = JSON.parse(readFileSync(join(ROOT, 'tests', 'evaluation', 'perf', 'budgets.json'), 'utf8')).web;
    const all = walk(dist);
    const files = all
      .filter((f) => f.endsWith('.js'))
      .map((f) => {
        const buf = readFileSync(f);
        return {
          path: relative(dist, f).split(sep).join('/'),
          bytes: buf.length,
          gzipBytes: gzipSync(buf, { level: 9 }).length,
        };
      });
    const report = checkBundle(files, budgets);
    const totalDist = all.reduce((s, f) => s + statSync(f).size, 0);
    const mb = (n) => `${(n / 1_048_576).toFixed(2)} MB`;
    console.log(`Web bundle: ${dist}`);
    console.log(
      `  JavaScript ${mb(report.totalJsBytes)} (gzip ${mb(report.totalJsGzipBytes)}), first screen ${mb(report.initialJsBytes)}, whole build ${mb(totalDist)}`,
    );
    for (const f of [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 6))
      console.log(`  ${mb(f.bytes).padStart(9)}  gzip ${mb(f.gzipBytes).padStart(9)}  ${f.path}`);
    if (report.violations.length) for (const v of report.violations) console.log(`  OVER BUDGET: ${v}`);
    else console.log('  Within budget.');
    if (write) {
      const dir = join(ROOT, 'tests', 'evaluation', 'reports');
      mkdirSync(dir, { recursive: true });
      const out = join(dir, `bundle-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      writeFileSync(
        out,
        `${JSON.stringify({ schema: 'kalam-bundle-report/1', createdAt: new Date().toISOString(), budgets, totalDistBytes: totalDist, ...report, files }, null, 2)}\n`,
      );
      console.log(`  Report written to ${relative(ROOT, out)}`);
    }
    return report.violations.length && !noFail ? 1 : 0;
  } finally {
    await vite.close();
  }
}

main().then(
  (c) => {
    process.exitCode = c;
  },
  (e) => {
    console.error(String(e?.stack ?? e).slice(0, 600));
    process.exitCode = 2;
  },
);
