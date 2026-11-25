#!/usr/bin/env node
/**
 * Deterministic performance benchmarks (docs/13 §17, docs/15 §11.6). Measures the pure TypeScript core that every
 * creation and every runtime screen depends on: classifier, template build, validateSpec, describeSpec, drawing
 * summary and formula evaluation, plus the JSON size of every built app (docs/13 §17: under 1 MB, docs/11 §11.1:
 * 100 KB cap). Repeats each measurement, reports the cold first run and the warm median and p95, and records the
 * hardware (docs/13 §17.1). No model, no browser, no network.
 *
 *   node scripts/bench.mjs [--runs 200] [--check] [--no-write]
 *
 * Not measured here, on purpose: cold start, shelf open time, LCP and drawing latency (need a browser; the CI perf
 * job runs Lighthouse), Android timings (need a device) and AI latency (the live eval report).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const runsArg = argv.indexOf('--runs');
const RUNS = Math.max(5, Number(runsArg >= 0 ? argv[runsArg + 1] : 200) || 200);
const readJson = (...p) => JSON.parse(readFileSync(join(ROOT, ...p), 'utf8'));

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
  try {
    const load = (p) => vite.ssrLoadModule(p);
    const [
      runner,
      smoke,
      { classifyRequest },
      { createApplicationPipeline },
      { validateSpec },
      { describeSpec },
      { summarizeDrawing },
    ] = await Promise.all([
      load('/tests/evaluation/runner/index.ts'),
      load('/tests/evaluation/runner/runtime-smoke.ts'),
      load('/src/core/classifier/index.ts'),
      load('/src/core/pipeline/create-application.ts'),
      load('/src/core/spec/validate.ts'),
      load('/src/core/spec/describe.ts'),
      load('/src/features/drawing/model/summarize.ts'),
    ]);
    const budgets = readJson('tests', 'evaluation', 'perf', 'budgets.json');
    const text = readJson('tests', 'evaluation', 'golden', 'text-requests.json').cases;
    const sketches = readJson('tests', 'evaluation', 'golden', 'sketches.json').cases;
    const now = () => performance.now();

    // Build every template-route golden app once, through the real pipeline with no model reachable.
    const ai = runner.createOfflineAI();
    const create = createApplicationPipeline({ ai, specialistConsent: () => false });
    const requests = text.map((c) => runner.textCaseInput(c));
    const specs = [];
    for (const input of requests) {
      const c = classifyRequest(input);
      if (runner.routeOf(c) !== 'template') continue;
      const res = await create(input);
      if (res.ok && res.spec) specs.push(res.spec);
    }
    if (specs.length === 0) throw new Error('No template apps were built; cannot benchmark.');
    const docs = sketches.map((c) => runner.buildSketchDocument(c));
    // A heavy page: 8 pages of 40 stamps each (the Studio allows 8 pages).
    const stress = {
      id: 'stress',
      title: 'Stress',
      createdAt: 0,
      updatedAt: 0,
      pages: Array.from({ length: 8 }, (_, p) => ({
        id: `p${p}`,
        title: `Page ${p + 1}`,
        width: 400,
        height: 800,
        elements: Array.from({ length: 40 }, (_, i) => ({
          id: `e${p}_${i}`,
          kind: 'stamp',
          x: 20 + (i % 4) * 90,
          y: 10 + Math.floor(i / 4) * 70,
          w: 80,
          h: 60,
          component: 'textInput',
          label: `Field ${i}`,
        })),
      })),
    };

    const bench = (fn) => {
      const samples = [];
      for (let i = 0; i < RUNS; i += 1) {
        const t0 = now();
        fn(i);
        samples.push(now() - t0);
      }
      return runner.summarizeSamples(samples);
    };
    const timings = {
      classify: bench((i) => classifyRequest(requests[i % requests.length])),
      validateSpec: bench((i) => validateSpec(specs[i % specs.length])),
      describeSpec: bench((i) => describeSpec(specs[i % specs.length])),
      summarizeDrawing: bench((i) => summarizeDrawing(docs[i % docs.length])),
      summarizeDrawingStress: bench(() => summarizeDrawing(stress)),
      formulas: bench((i) => smoke.runtimeSmoke(specs[i % specs.length])),
    };
    // Template build is async (the whole pipeline: classify, template, validate, describe).
    const tpl = [];
    const templateInputs = requests.filter((r) => runner.routeOf(classifyRequest(r)) === 'template');
    for (let i = 0; i < Math.min(RUNS, 100); i += 1) {
      const t0 = now();
      await create(templateInputs[i % templateInputs.length]);
      tpl.push(now() - t0);
    }
    timings.templateBuild = runner.summarizeSamples(tpl);

    const sizes = Object.fromEntries(specs.map((s) => [s.name, Buffer.byteLength(JSON.stringify(s))]));
    const failures = [
      ...runner.checkTimingBudgets(timings, budgets.node),
      ...runner.checkSpecSizes(sizes, budgets.spec),
    ];
    const cpus = os.cpus();
    const report = {
      schema: 'kalam-bench-report/1',
      createdAt: new Date().toISOString(),
      machine: {
        cpu: cpus[0]?.model?.trim(),
        logicalCpus: cpus.length,
        memoryMb: Math.round(os.totalmem() / 1_048_576),
        os: `${os.type()} ${os.release()}`,
        node: process.version,
      },
      method: `${RUNS} runs per measurement in one process. coldMs is the first run; median and p95 use the warm runs. The machine was shared with other work, so treat absolute numbers as an upper bound.`,
      timingsMs: timings,
      specBytes: { count: specs.length, max: Math.max(...Object.values(sizes)), byApp: sizes },
      budgets: { node: budgets.node, spec: budgets.spec },
      budgetFailures: failures,
      notMeasured: budgets.productTargets,
    };

    console.log(
      `Kalam benchmarks: ${report.machine.cpu}, ${report.machine.logicalCpus} CPUs, ${report.machine.os}, node ${report.machine.node}`,
    );
    for (const [name, t] of Object.entries(timings)) {
      console.log(
        `  ${name.padEnd(24)} cold ${String(t.coldMs).padStart(8)} ms   median ${String(t.medianMs).padStart(8)} ms   p95 ${String(t.p95Ms).padStart(8)} ms   (${t.runs} runs)`,
      );
    }
    console.log(
      `  built apps: ${specs.length}, largest spec ${report.specBytes.max} bytes (cap ${budgets.spec.maxBytes}, product target ${budgets.spec.productTargetBytes})`,
    );
    if (failures.length) for (const f of failures) console.log(`  OVER BUDGET: ${f}`);
    else console.log('  Within budget.');
    if (!flag('--no-write')) {
      const dir = join(ROOT, 'tests', 'evaluation', 'reports');
      mkdirSync(dir, { recursive: true });
      const out = join(dir, `bench-${report.createdAt.replace(/[:.]/g, '-')}.json`);
      writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`  Report written to tests/evaluation/reports/${out.split(/[\\/]/).pop()}`);
    }
    return flag('--check') && failures.length ? 1 : 0;
  } finally {
    await vite.close();
  }
}

main().then(
  (c) => {
    process.exitCode = c;
  },
  (e) => {
    console.error(String(e?.stack ?? e).slice(0, 800));
    process.exitCode = 2;
  },
);
