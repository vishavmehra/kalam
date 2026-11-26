#!/usr/bin/env node
/**
 * Kalam evaluation runner (docs/13 §6-9, §19). Runs the golden set (tests/evaluation/golden) through
 * the real classifier, template pipeline, validateSpec, describeSpec and drawing summary, and writes a
 * dated, machine-readable metrics report to tests/evaluation/reports/.
 *
 *   node scripts/eval.mjs                        deterministic stages only: no model, no cost
 *   node scripts/eval.mjs --check                same, exit 1 when a quality floor is missed (CI)
 *   node scripts/eval.mjs --live --budget 6      also compile cloud-route cases with real Firebase AI Logic
 *   node scripts/eval.mjs --live --budget 40 --photos   run the sketch cases that have a real photo (see --help)
 *   node scripts/eval.mjs --live --budget 12 --video-frames   run the video cases from stills of the sketch photos as frames
 *   node scripts/eval.mjs --help
 *
 * Every case keeps its built spec, a plain-language summary and the automatic checks, so the report can be
 * opened in tests/evaluation/review/index.html. Next steps: scripts/eval-judge.mjs (AI pre-scores), then
 * scripts/eval-merge-scores.mjs (the person's scores).
 *
 * Live mode is never the default. It needs --budget N, a hard cap on model requests enforced on `fetch`
 * itself (requests past the cap get a synthetic 429 and never leave the machine). Every real request
 * costs money. Config values and keys are never printed. Node has no Gemini Nano and no canvas, so a
 * live sketch compiles from the Drawing Studio summary (stamps and text), not from a rasterised page.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnv, initFirebase, installSpendCap, loadEnv, sumUsage } from './lib/eval-live.mjs';

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
  if (report.usage)
    line(
      `Model usage: ${report.usage.httpCalls} request(s), ${report.usage.inputTokens} input tokens, ${report.usage.outputTokens} output tokens (${
        Object.entries(report.usage.byModel)
          .map(([m, u]) => `${m}: ${u.inputTokens} in, ${u.outputTokens} out`)
          .join('; ') || 'no tokens reported'
      }).`,
    );
  line(
    `Scenarios: ${report.scenarios.map((x) => `${x.id} ${x.status === 'exercised' ? 'run' : 'not run'}`).join(', ')}`,
  );
  line(
    `Human review: ${report.humanReview.pending.length} case(s) still need a person, ${report.humanReview.reviewed.length} reviewed. ${report.humanReview.handDrawnPhotos ? `Hand-drawn photo sketches: ${report.humanReview.handDrawnPhotos.present} of ${report.humanReview.handDrawnPhotos.required}.` : ''}`,
  );
  if (report.compileFailures) {
    const cf = report.compileFailures;
    const list = (m) =>
      Object.entries(m)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} x${n}`)
        .join(', ') || 'none';
    line(`Cloud compile passes: ${cf.passes}. Not valid, by stage: ${list(cf.byStage)}. By code: ${list(cf.byCode)}.`);
  }
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
    /** Every model run in order, with the provider's own error text (scrubbed), so a failed case can be explained. */
    const runLog = [];
    const offline = runner.createOfflineAI();
    ai = offline;
    if (args.mode === 'live' && args.budget > 0) {
      const env = loadEnv(ROOT);
      const scrub = applyEnv(env);
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
        // Evaluation must reach the model for every case: no client token bucket, no reused answers.
        rateLimit: false,
        cacheResults: false,
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
      const baseRun = ai.run.bind(ai);
      ai.run = async (req, ctx) => {
        const res = await baseRun(req, ctx);
        runLog.push({
          taskType: ctx.taskType,
          success: res.success,
          errorMessage: res.success ? undefined : scrub(res.errorMessage ?? '').slice(0, 600),
        });
        return res;
      };
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
      captureDetail: true,
    };

    // ── Real photos of hand-drawn sketches (optional) ──
    const photoDir = args.photosDir ? resolve(ROOT, args.photosDir) : join(GOLDEN, 'sketch-photos');
    const photoFiles = new Map(); // case id -> file name
    if (existsSync(photoDir)) {
      for (const f of readdirSync(photoDir)) {
        const m = f.match(/^(.+).(jpe?g|png)$/i);
        const id = m?.[1].toLowerCase();
        const known = id && sketchFile.cases.find((c) => c.id.toLowerCase() === id);
        if (known) photoFiles.set(known.id, f);
      }
    }
    const photos = new Map();
    if (args.photos) {
      if (photoFiles.size === 0) {
        console.error(
          `No sketch photos found in ${photoDir}. Name each photo after its case, for example s01-calculator.jpg.`,
        );
        return 2;
      }
      for (const [id, file] of photoFiles) {
        const bytes = readFileSync(join(photoDir, file));
        const info = runner.imageInfo(new Uint8Array(bytes));
        if (!info) {
          console.error(
            `${file} is not a readable JPEG or PNG. Phone photos in HEIC format must be saved as JPEG first.`,
          );
          return 2;
        }
        if (bytes.length > 15 * 1024 * 1024) {
          console.error(`${file} is ${(bytes.length / 1048576).toFixed(1)} MB. Please use a photo under 15 MB.`);
          return 2;
        }
        photos.set(id, { file, bytes: bytes.length, ...info, base64: bytes.toString('base64') });
      }
      picked.text = [];
      picked.modalities = [];
      picked.sketches = picked.sketches.filter((c) => photos.has(c.id));
      if (picked.sketches.length === 0) {
        console.error('None of the selected sketch cases has a photo.');
        return 2;
      }
      notes.push(`Sketch cases were run from ${photos.size} real photo(s), sent as images with no drawing summary.`);
    } else if (photoFiles.size) {
      notes.push(`${photoFiles.size} sketch photo(s) were found but not used. Run with --photos to use them.`);
    }

    // ── Video cases from stills (Node cannot decode a video) ──
    // Each video case is shown a few of the golden sketch photos as its frames, in order, with the time of each frame. The compiler gets
    // exactly what the app sends for a video: up to 6 images, their times and a summary. Real frame extraction from a video file
    // (the <video> element on the web, expo-video-thumbnails on a phone) is not exercised here.
    const FRAME_STILLS = {
      'mv01-video-tap-counter': ['s02-water-counter', 's21-habit-tracker', 's24-workout-log'],
      'mv02-video-inventory-walkthrough': ['s19-household-inventory', 's25-shop-sales-stock', 's04-expense-tracker'],
      'mv03-video-plus-instruction': ['s15-todo-priority', 's03-shopping-list', 's14-packing-checklist'],
      'mv04-video-multi-role-tour': ['s10-clinic-six-screens', 's20-appointment-register', 's17-visitor-register'],
      'mv05-video-whiteboard-flow': ['s07-kirana-credit-book', 's23-fee-ledger', 's08-student-attendance'],
    };
    const videoFrames = new Map();
    if (args.videoFrames) {
      for (const [id, stills] of Object.entries(FRAME_STILLS)) {
        const c = modalityFile.cases.find((x) => x.id === id);
        if (!c?.video) continue;
        const step = c.video.durationSec / (stills.length + 1);
        videoFrames.set(id, stills.map((name, i) => {
          const bytes = readFileSync(join(photoDir, `${name}.jpg`));
          const info = runner.imageInfo(new Uint8Array(bytes));
          const sec = Math.round(step * (i + 1));
          return {
            id: `frame_${id}_${i + 1}`, mimeType: 'image/jpeg', base64: bytes.toString('base64'), width: info?.width ?? 0, height: info?.height ?? 0,
            source: 'video_frame', label: `Frame at ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, atSec: sec,
          };
        }));
      }
      picked.text = [];
      picked.sketches = [];
      picked.modalities = picked.modalities.filter((c) => videoFrames.has(c.id));
      if (!picked.modalities.length) {
        console.error('No video case was selected.');
        return 2;
      }
      notes.push(`Video cases were run from ${picked.modalities.length} set(s) of stills of the golden sketch photos, sent as the video frames with their times. They are not frames of a recorded video.`);
    }

    // ── Run ──
    const results = [];
    const total = picked.text.length + picked.sketches.length + picked.modalities.length;
    /** Runs one case and, in live mode, attributes the model requests and tokens its events show to it. */
    const runCase = async (run) => {
      const e0 = liveEvents?.length ?? 0;
      const l0 = runLog.length;
      const h0 = spend.used();
      const r = await run();
      if (liveEvents) {
        const evs = liveEvents.slice(e0).filter((e) => e.source !== 'deterministic');
        const logs = runLog.slice(l0);
        const sum = (k) => evs.reduce((n, e) => n + (e.tokens?.[k] ?? 0), 0);
        if (evs.length || spend.used() > h0) {
          r.usage = {
            httpCalls: spend.used() - h0,
            inputTokens: sum('input'),
            outputTokens: sum('output'),
            events: evs.map((e, i) => ({
              taskType: e.taskType,
              ...(e.model ? { model: e.model } : {}),
              source: e.source,
              success: e.success,
              latencyMs: e.latencyMs,
              ...(e.errorCode ? { errorCode: e.errorCode } : {}),
              ...(logs[i]?.errorMessage ? { errorMessage: logs[i].errorMessage } : {}),
              ...(e.tokens?.input !== undefined ? { inputTokens: e.tokens.input } : {}),
              ...(e.tokens?.output !== undefined ? { outputTokens: e.tokens.output } : {}),
            })),
          };
        }
      }
      results.push(r);
      if (args.mode === 'live') {
        const b = r.build;
        console.log(
          `[${results.length}/${total}] ${r.id}: ${b.stage}${b.stage === 'skipped' ? '' : b.ok ? (b.valid ? ' valid' : ' INVALID') : ' FAILED'}${b.route ? ` (${b.route})` : ''}, ${r.latencyMs.total} ms, requests so far ${spend.used()}/${args.budget}`,
        );
      }
    };
    for (const c of picked.text) await runCase(() => runner.evaluateTextCase(c, deps, opts));
    for (const c of picked.sketches) await runCase(() => runner.evaluateSketchCase(c, deps, opts, photos.get(c.id)));
    for (const c of picked.modalities)
      await runCase(() => runner.evaluateModalityCase(c, sketchFile.cases, deps, opts, videoFrames.get(c.id)));

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
      handDrawnPhotos: meta.handDrawnPhotos ? { ...meta.handDrawnPhotos, present: photoFiles.size } : undefined,
      notes,
    });
    if (args.mode === 'live') {
      report.usage = sumUsage(
        results.flatMap((r) =>
          (r.usage?.events ?? []).map((e) => ({
            model: e.model,
            inputTokens: e.inputTokens,
            outputTokens: e.outputTokens,
            httpCalls: 1,
          })),
        ),
      );
      report.usage.httpCalls = spend.used();
    }

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
