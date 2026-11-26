#!/usr/bin/env node
/**
 * Kalam Bazaar evaluation metrics (docs/12 §22.5, docs/13 §17). Measures the pure core that the Bazaar depends on:
 * invalid-listing rejection, installation success, damaged-download rejection, preview data safety, update
 * migration, purchase correctness (the plan, not the deployed function), the deterministic safety scan's precision
 * and recall, and in-process latencies. No model, no browser, no network, no Firebase.
 *
 *   node scripts/eval-bazaar.mjs [--runs 30] [--check] [--no-write]
 *
 * --check    exit 1 when a rate is under its floor or the scan's precision or recall is under its regression floor
 * --no-write do not save the JSON report to tests/evaluation/reports
 *
 * Not measured here, on purpose (listed in the report with the reason): listing load latency over the network,
 * offline launch of an installed app, installation on real storage, the deployed purchase function, preview UI
 * startup. docs/12 §22.5: do not present unmeasured performance as achieved results.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const runsArg = argv.indexOf('--runs');
const RUNS = Math.max(5, Number(runsArg >= 0 ? argv[runsArg + 1] : 30) || 30);

const pct = (r) => (r === null ? 'n/a' : `${(r * 100).toFixed(1)}%`);

async function main() {
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
  let report;
  try {
    const { computeBazaarMetrics, failures } = await vite.ssrLoadModule('/tests/evaluation/bazaar/metrics.ts');
    const metrics = await computeBazaarMetrics({ runs: RUNS });
    const cpus = os.cpus();
    report = {
      generatedAt: new Date().toISOString(),
      hardware: { cpu: cpus[0]?.model ?? 'unknown', cores: cpus.length, memoryMb: Math.round(os.totalmem() / 1_048_576), os: `${os.type()} ${os.release()}`, node: process.version },
      runs: RUNS,
      ...metrics,
      failures: failures(metrics),
    };
  } finally {
    await vite.close();
  }

  console.log(`Kalam Bazaar evaluation (${report.generatedAt}, ${report.hardware.cpu}, Node ${report.hardware.node})\n`);
  console.log('Rates');
  for (const r of report.rates) console.log(`  ${pct(r.result.rate).padStart(7)}  ${String(r.result.correct).padStart(5)}/${String(r.result.total).padEnd(5)} ${r.label}`);
  const s = report.scan;
  console.log(`\nDeterministic safety scan (${s.positives} bad, ${s.negatives} fine)`);
  console.log(`  precision ${pct(s.precision)}  recall ${pct(s.recall)}`);
  if (s.missed.length) console.log(`  missed:           ${s.missed.join('; ')}`);
  if (s.wronglyFlagged.length) console.log(`  wrongly flagged:  ${s.wronglyFlagged.join('; ')}`);
  console.log('\nIn-process latency (median, p95), milliseconds');
  for (const l of report.latencies) console.log(`  ${String(l.medianMs).padStart(8)}  ${String(l.p95Ms).padStart(8)}  ${l.label}`);
  console.log('\nNot measured here');
  for (const n of report.notMeasured) console.log(`  - ${n.label}: ${n.why}`);

  if (!flag('--no-write')) {
    const dir = join(ROOT, 'tests', 'evaluation', 'reports');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `bazaar-${report.generatedAt.replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nReport saved to ${file}`);
  }
  if (report.failures.length) {
    console.log(`\nUnder the floor: ${report.failures.join(', ')}`);
    if (flag('--check')) process.exitCode = 1;
  } else {
    console.log('\nEvery rate is at its floor.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
