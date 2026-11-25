#!/usr/bin/env node
/**
 * Kalam evaluation runner (docs/13 §6-9, §19). Runs the golden set (tests/evaluation/golden) through
 * the real classifier, template pipeline, validateSpec, describeSpec and drawing summary, and writes a
 * dated, machine-readable metrics report to tests/evaluation/reports/.
 *
 *   node scripts/eval.mjs                        deterministic stages only: no model, no cost
 *   node scripts/eval.mjs --check                same, exit 1 when a quality floor is missed (CI)
 *   node scripts/eval.mjs --live --budget 6      also compile cloud-route cases with real Firebase AI Logic
 *   node scripts/eval.mjs --help
 *
 * Live mode is never the default. It needs --budget N, a hard cap on model requests enforced on `fetch`
 * itself (requests past the cap get a synthetic 429 and never leave the machine). Every real request
 * costs money. Config values and keys are never printed. Node has no Gemini Nano and no canvas, so a
 * live sketch compiles from the Drawing Studio summary (stamps and text), not from a rasterised page.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GOLDEN = join(ROOT, 'tests', 'evaluation', 'golden');
const argv = process.argv.slice(2);

const sha12 = (...texts) => {
  const h = createHash('sha256');
  for (const t of texts) h.update(t);
  return h.digest('hex').slice(0, 12);
};
const pct = (r) => (r.rate === null ? '  n/a' : `${(r.rate * 100).toFixed(1).padStart(5)}%`);
const frac = (r) => `${r.correct}/${r.total}`;
const ms = (n) => (n === null || n === undefined ? 'n/a' : `${n} ms`);

// ─── Config (live mode only) ──────────────────────────────────────────────────────────────
/** Public client config from .env.local, or from the environment (CI). Only EXPO_PUBLIC_* values. */
function loadEnv() {
  const env = {};
  const file = join(ROOT, '.env.local');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('EXPO_PUBLIC_') && v && !env[k]) env[k] = v;
  return env;
}

/** Counts every model request and refuses the ones past the cap (hard spend limit, on the wire). */
function installSpendCap(budget, scrub) {
  const http = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!/:(stream)?generateContent\b/i.test(String(url))) return realFetch(url, init);
    if (http.filter((h) => !h.refused).length >= budget) {
      http.push({ refused: true });
      return new Response(JSON.stringify({ error: { code: 429, message: 'eval budget reached' } }), { status: 429 });
    }
    const entry = { model: String(url).match(/models\/([^:/]+)/)?.[1] };
    http.push(entry);
    const res = await realFetch(url, init);
    entry.status = res.status;
    return res;
  };
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level].bind(console);
    console[level] = (...a) => original(...a.map((x) => (typeof x === 'string' ? scrub(x) : x)));
  }
  return { used: () => http.filter((h) => !h.refused).length };
}

async function initFirebase(env) {
  const missing = ['API_KEY', 'PROJECT_ID', 'APP_ID'].map((k) => `EXPO_PUBLIC_FIREBASE_${k}`).filter((k) => !env[k]);
  if (missing.length) throw new Error(`Live mode needs ${missing.join(', ')} in .env.local or the environment.`);
  const { initializeApp } = await import('firebase/app');
  const { CustomProvider, getToken, initializeAppCheck } = await import('firebase/app-check');
  const app = initializeApp({
    apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.EXPO_PUBLIC_FIREBASE_APP_ID,
  });
  let appCheck = 'not_configured';
  if (env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN) {
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN;
    const check = initializeAppCheck(app, {
      provider: new CustomProvider({ getToken: () => Promise.reject(new Error('unused')) }),
    });
    try {
      await getToken(check);
      appCheck = 'debug_token_exchanged';
    } catch {
      appCheck = 'debug_token_rejected';
    }
  }
  return { app, appCheck };
}

// ─── Output ───────────────────────────────────────────────────────────────────────────────
function printSummary(report, written, gate, args) {
  const line = (s = '') => console.log(s);
  line(
    `Kalam evaluation: ${report.mode} run, dataset ${report.datasetVersion} (${report.datasetHash}), prompt ${report.promptVersion}`,
  );
  line(`Cases: ${report.totalCases}. Model requests made: ${report.cloudCalls}.`);
  for (const [name, d] of Object.entries(report.datasets)) {
    const c = d.classifier;
    line('');
    line(`[${name}] ${d.cases} cases (${d.ambiguousCases} ambiguous)`);
    line(
      `  complexity ${pct(c.complexity)} ${frac(c.complexity)}   without ambiguous ${pct(c.complexityExcludingAmbiguous)} ${frac(c.complexityExcludingAmbiguous)}`,
    );
    line(
      `  route      ${pct(c.route)} ${frac(c.route)}   task type ${pct(c.taskType)} ${frac(c.taskType)}   multimodal ${pct(c.multimodal)} ${frac(c.multimodal)}`,
    );
    if (c.template.total) line(`  template   ${pct(c.template)} ${frac(c.template)}`);
    if (c.lowConfidence.total) line(`  low confidence flagged ${pct(c.lowConfidence)} ${frac(c.lowConfidence)}`);
    const t = d.build.templateRoute;
    if (t.attempted)
      line(
        `  template apps: built ${t.built}/${t.attempted}, valid ${pct(t.valid)} ${frac(t.valid)}, described ${pct(t.described)} ${frac(t.described)}`,
      );
    line(
      `  cloud-route cases: ${d.build.cloudRequired.cases} (${d.build.cloudRequired.skipped} not run, ${d.build.cloudRequired.attempted} compiled)`,
    );
    if (d.semantic.cases) {
      const s = d.semantic;
      line(
        `  semantics over ${s.cases} built apps: screens ${pct(s.screens)}, collections ${pct(s.collections)}, fields ${pct(s.fields)} ${frac(s.fields)}, components ${pct(s.components)} ${frac(s.components)}, no leaked text ${pct(s.forbiddenText)}`,
      );
    }
    if (d.extraction)
      line(
        `  drawing summary: pages ${pct(d.extraction.pageCount)}, labels ${pct(d.extraction.labels)} ${frac(d.extraction.labels)}, stamps ${pct(d.extraction.stamps)} ${frac(d.extraction.stamps)}`,
      );
    if (d.build.cloudRequired.offlineGraceful.total)
      line(
        `  offline: cloud-route requests failing gracefully ${pct(d.build.cloudRequired.offlineGraceful)} ${frac(d.build.cloudRequired.offlineGraceful)}`,
      );
    if (d.runtime.total)
      line(`  runtime smoke (formulas and filters on empty and sample data): ${pct(d.runtime)} ${frac(d.runtime)}`);
    line(
      `  human review: ${d.review.pending} pending, ${d.review.reviewed} reviewed, ${d.review.needsAssets} need a real asset`,
    );
    if (d.live)
      line(
        `  live: first pass valid ${pct(d.live.firstPassValid)} ${frac(d.live.firstPassValid)}, valid after repair ${pct(d.live.validAfterRepair)} ${frac(d.live.validAfterRepair)}`,
      );
    line(
      `  latency: classifier median ${ms(d.latency.classifier.medianMs)} (p95 ${ms(d.latency.classifier.p95Ms)}), template build median ${ms(d.latency.templateBuild.medianMs)} (p95 ${ms(d.latency.templateBuild.p95Ms)})`,
    );
    if (d.latency.cloudBuild.count)
      line(`  cloud build median ${ms(d.latency.cloudBuild.medianMs)} (p95 ${ms(d.latency.cloudBuild.p95Ms)})`);
    const miss = Object.entries(c.confusion).flatMap(([want, got]) =>
      Object.entries(got)
        .filter(([g]) => g !== want)
        .map(([g, n]) => `${want}->${g} x${n}`),
    );
    if (miss.length) line(`  complexity misses: ${miss.join(', ')}`);
  }
  line('');
  line(
    `Inference sources: ${report.hybrid.events} event(s), ${report.hybrid.modelCalls} model call(s), ${report.hybrid.sourceViolations.length} wrong source report(s).`,
  );
  line(
    `Scenarios: ${report.scenarios.map((x) => `${x.id} ${x.status === 'exercised' ? 'run' : 'not run'}`).join(', ')}`,
  );
  line(
    `Human review: ${report.humanReview.pending.length} case(s) still need a person, ${report.humanReview.reviewed.length} reviewed. ${report.humanReview.handDrawnPhotos ? `Hand-drawn photo sketches: ${report.humanReview.handDrawnPhotos.present} of ${report.humanReview.handDrawnPhotos.required}.` : ''}`,
  );
  if (report.failures.length) {
    line('');
    line(`Cases with at least one failed check (${report.failures.length}):`);
    for (const f of report.failures) line(`  ${f.id}\n    ${f.reasons.join('\n    ')}`);
  }
  line('');
  line(
    gate.pass
      ? 'Quality floors: met.'
      : `Quality floors: NOT met${args.check ? '' : ' (informational, run with --check to fail on this)'}`,
  );
  for (const r of gate.reasons) line(`  - ${r}`);
  if (written) line(`Report written to ${written}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────────────────
async function main() {
  const { createServer } = await import('vite');
  // Vite's SSR loader runs the app's TypeScript (with the `@/` alias) exactly as written; no build step.
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
    const runner = await load('/tests/evaluation/runner/index.ts');

    let args;
    try {
      args = runner.parseArgs(argv);
    } catch (e) {
      if (e instanceof runner.UsageError) {
        console.error(`${e.message}\nRun with --help for options.`);
        return 2;
      }
      throw e;
    }
    if (args.help) {
      console.log(runner.USAGE);
      return 0;
    }

    // ── Dataset ──
    const files = ['dataset.json', 'text-requests.json', 'sketches.json', 'modalities.json'].map((f) =>
      readFileSync(join(GOLDEN, f), 'utf8'),
    );
    const [meta, textFile, sketchFile, modalityFile] = files.map((t) => JSON.parse(t));
    const [
      { classifyRequest },
      templates,
      { createApplicationPipeline },
      { validateSpec },
      { describeSpec },
      { summarizeDrawing },
      smoke,
    ] = await Promise.all([
      load('/src/core/classifier/index.ts'),
      load('/src/core/templates/index.ts'),
      load('/src/core/pipeline/create-application.ts'),
      load('/src/core/spec/validate.ts'),
      load('/src/core/spec/describe.ts'),
      load('/src/features/drawing/model/summarize.ts'),
      load('/tests/evaluation/runner/runtime-smoke.ts'),
    ]);
    const problems = runner.validateGolden({
      text: textFile.cases,
      sketches: sketchFile.cases,
      modalities: modalityFile.cases,
      templateIds: templates.listTemplates().map((t) => t.id),
    });
    if (problems.length) {
      console.error(`The golden files have problems:\n  ${problems.join('\n  ')}`);
      return 2;
    }
    const picked = runner.selectCases(
      { text: textFile.cases, sketches: sketchFile.cases, modalities: modalityFile.cases },
      args,
    );
    if (picked.unknown.length) {
      console.error(`Unknown case id(s): ${picked.unknown.join(', ')}`);
      return 2;
    }
    if (picked.text.length + picked.sketches.length + picked.modalities.length === 0) {
      console.error('No cases selected.');
      return 2;
    }

    // ── Wiring ──
    const notes = [];
    let ai;
    let spend = { used: () => 0 };
    let firebase;
    let liveEvents;
    const offline = runner.createOfflineAI();
    ai = offline;
    if (args.mode === 'live' && args.budget > 0) {
      const env = loadEnv();
      for (const [k, v] of Object.entries(env)) if (k.startsWith('EXPO_PUBLIC_')) process.env[k] = v;
      const secrets = Object.values(env).filter((v) => v && v.length >= 12);
      const scrub = (s) => secrets.reduce((acc, v) => acc.split(v).join('<redacted>'), String(s ?? ''));
      spend = installSpendCap(args.budget, scrub);
      firebase = await initFirebase(env);
      const [{ createFirebaseProvider }, { createOrchestrator }, { DEFAULT_SETTINGS }] = await Promise.all([
        load('/src/infrastructure/firebase/firebase-provider.ts'),
        load('/src/core/ai/orchestrator.ts'),
        load('/src/core/contracts/index.ts'),
      ]);
      const events = [];
      liveEvents = events;
      let settings = { ...DEFAULT_SETTINGS, onboarded: true };
      ai = createOrchestrator({
        firebase: createFirebaseProvider(),
        // No specialist providers in evaluation: Firebase only, as in the judging build.
        specialist: {
          name: 'claude',
          isConfigured: () => false,
          onDeviceStatus: async () => ({ platform: 'other', apiExposed: false, availability: 'unavailable' }),
          generateStructured: async () => ({
            success: false,
            provider: 'none',
            source: 'cloud',
            latencyMs: 0,
            fallbackUsed: false,
            errorCode: 'not_configured',
          }),
        },
        events: {
          add: async (e) => {
            events.push(e);
          },
          list: async () => events,
          clear: async () => {
            events.length = 0;
          },
        },
        settings: { get: async () => settings, update: async (p) => (settings = { ...settings, ...p }) },
        network: { online: () => true, subscribe: () => () => {} },
      });
      notes.push(
        `Backend ${env.EXPO_PUBLIC_AI_BACKEND || 'google'}${env.EXPO_PUBLIC_AI_LOCATION ? `/${env.EXPO_PUBLIC_AI_LOCATION}` : ''}. App Check: ${firebase.appCheck}.`,
      );
      notes.push(
        'Live sketches compile from the Drawing Studio summary (stamps and text). Node cannot rasterise a page, so no image was sent.',
      );
    } else if (args.mode === 'live') {
      notes.push('Budget was 0: live mode ran without any model request, so cloud-route cases were not compiled.');
    }

    const deps = {
      classify: classifyRequest,
      createApplication: createApplicationPipeline({ ai, specialistConsent: () => false }),
      validate: validateSpec,
      describe: describeSpec,
      summarizeDrawing,
      runtimeSmoke: smoke.runtimeSmoke,
      now: () => performance.now(),
    };
    const opts = {
      mode: args.mode,
      beforeCloud: () => runner.budgetSkipReason(spend.used(), args.budget),
      httpCalls: () => spend.used(),
    };

    // ── Run ──
    const results = [];
    for (const c of picked.text) results.push(await runner.evaluateTextCase(c, deps, opts));
    for (const c of picked.sketches) results.push(await runner.evaluateSketchCase(c, deps, opts));
    for (const c of picked.modalities) results.push(await runner.evaluateModalityCase(c, sketchFile.cases, deps, opts));

    const createdAt = new Date();
    const report = runner.buildReport({
      mode: args.mode,
      datasetVersion: meta.datasetVersion,
      results,
      platform: `node-${process.version.replace(/^v/, '')}-${process.platform}`,
      promptVersion: `compiler-prompt@${sha12(readFileSync(join(ROOT, 'src', 'core', 'compiler', 'prompt.ts'), 'utf8'))}`,
      datasetHash: sha12(...files),
      cloudCalls: spend.used(),
      createdAt,
      // Live: what the orchestrator really reported. Deterministic: the decisions the pipeline recorded.
      events: (liveEvents ?? offline.events()).map((e) => ({
        route: e.route,
        source: e.source,
        success: e.success,
        latencyMs: e.latencyMs,
        fallbackUsed: e.fallbackUsed,
      })),
      handDrawnPhotos: meta.handDrawnPhotos,
      notes,
    });

    // The template route must never reach a model (docs/07 §20.4: deterministic first).
    const gate = runner.evaluateGate(report, args.thresholds);
    if (args.mode === 'deterministic' && offline.runCalls() > 0) {
      gate.pass = false;
      gate.reasons.push(`A model was called ${offline.runCalls()} time(s) during a deterministic run.`);
    }

    let written;
    if (args.write) {
      const dir = args.outDir ? join(ROOT, args.outDir) : join(ROOT, 'tests', 'evaluation', 'reports');
      mkdirSync(dir, { recursive: true });
      written = join(dir, runner.reportFileName(createdAt, args.mode));
      writeFileSync(written, `${JSON.stringify(report, null, 2)}\n`);
    }
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else printSummary(report, written ? written.replace(ROOT, '').replace(/^[\\/]/, '') : undefined, gate, args);
    return args.check && !gate.pass ? 1 : 0;
  } finally {
    await vite.close();
  }
}

// exitCode (not process.exit) avoids a libuv handle-closing assertion on Windows with pending fetch handles.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(String(e?.stack ?? e?.message ?? e).slice(0, 800));
    process.exitCode = 2;
  },
);
