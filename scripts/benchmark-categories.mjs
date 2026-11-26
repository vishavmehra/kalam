#!/usr/bin/env node
/**
 * The 12-category benchmark and provider comparison of docs/07 section 20.1 and 20.2 (D07-044), assembled from runs that already exist.
 * It calls no model and spends nothing: it reads the evidence files the other scripts wrote and lays them side by side, category by category,
 * never as one blended number (docs/07 section 20.4).
 *
 *   node scripts/benchmark-categories.mjs [--live-report tests/evaluation/reports/<live report>.json] [--write]
 *
 * Sources: docs/evidence/local-ready-<task>-web-<date>.json (Gemini Nano, offline, scripts/local-ready.mjs), docs/evidence/provider-<task>-cloud-<date>.json
 * (the same cases through Firebase cloud, scripts/local-ready.mjs --provider cloud) and the live eval report of the compiler (scripts/eval.mjs --live).
 * A category with no run says so and why. Nothing is estimated.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EVIDENCE = join(ROOT, 'docs', 'evidence');
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const newest = (re) => readdirSync(EVIDENCE).filter((f) => re.test(f)).sort().at(-1);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/** Nano and cloud records for one task, side by side. */
function localPair(task) {
  const file = (kind) => newest(new RegExp(`^${kind}-${task}-(?:web|cloud)-\\d{4}-\\d{2}-\\d{2}\\.json$`));
  const read = (name) => (name ? json(join(EVIDENCE, name)) : undefined);
  const nano = read(file('local-ready'));
  const cloud = read(file('provider'));
  const row = (e) => e && {
    model: e.record.model, cases: e.record.cases, schemaValid: pct(e.record.schemaValid, e.record.cases), correct: pct(e.record.correct, e.record.cases),
    invented: pct(e.record.hallucinated, e.record.cases), p95Ms: e.record.p95LatencyMs, offline: e.record.offlineOk === true,
    // The gate is the device model's bar (src/core/ai/local-ready.ts); it is shown for the device row only.
    ...(e.modelRequests === undefined ? { gate: e.verdict?.status, gateReasons: e.verdict?.reasons } : { modelRequests: e.modelRequests }), evidence: e.record.evidence,
  };
  return { 'Gemini Nano (Chrome, offline)': row(nano) ?? 'not run', 'Firebase cloud Gemini': row(cloud) ?? 'not run' };
}

/** Compiler categories from a live eval report: cases by dataset and by the complexity the golden label expects. */
function compilerRows(report) {
  const pick = (datasets, level) => report.cases.filter((c) => datasets.includes(c.dataset) && (level ? c.detail?.expected?.complexity === level : true));
  const stats = (cs) => {
    const cloud = cs.filter((c) => c.build.stage === 'cloud');
    const template = cs.filter((c) => c.build.stage === 'template');
    const med = (xs) => (xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
    return {
      cases: cs.length,
      templates: { built: template.length, valid: template.filter((c) => c.build.valid).length },
      cloud: {
        compiled: cloud.length, validFirstPass: cloud.filter((c) => c.build.firstPassValid === true).length,
        validAfterRepair: cloud.filter((c) => c.build.ok && c.build.valid).length, medianMs: med(cloud.map((c) => Math.round(c.latencyMs.build))),
      },
      notRun: cs.filter((c) => c.build.stage === 'skipped').length,
    };
  };
  return {
    simple: stats(pick(['text', 'audio'], 'simple')),
    medium: stats(pick(['text', 'audio'], 'medium')),
    complex: stats(pick(['text', 'audio'], 'complex')),
    sketch: stats(pick(['sketch'])),
  };
}

const liveName = opt('live-report', 'tests/evaluation/reports/eval-2026-11-25T14-53-06-271Z-live-prescored.json');
const livePath = join(ROOT, liveName);
const live = existsSync(livePath) ? json(livePath) : undefined;
const c = live ? compilerRows(live) : undefined;
const missingLive = 'The live eval report is not on this machine (tests/evaluation/reports is not committed). Run scripts/eval.mjs --live or pass --live-report.';

const compilerEntry = (n, title, key, note) => ({
  n, title,
  providers: c
    ? { 'Deterministic templates': c[key].templates.built ? `${c[key].templates.valid} of ${c[key].templates.built} valid, no model` : 'not used for this category',
        'Firebase cloud Gemini (compile and one repair pass)': c[key].cloud.compiled ? c[key].cloud : 'not run',
        'Gemini Nano': 'not tried: the device model is not assumed able to build apps (docs/07 section 4.5)' }
    : missingLive,
  note,
});
const notRun = (n, title, why) => ({ n, title, providers: 'not run', note: why });
const task = (n, title, t, note) => ({ n, title, providers: localPair(t), note });

/** Category 12 from the Chrome matrix (scenario H): the cloud wrote the test cases and Gemini Nano ran the AI step on the device. */
function matrixCheck() {
  const name = newest(/^web-matrix-\d{4}-\d{2}-\d{2}\.json$/);
  const h = name ? json(join(EVIDENCE, name)).result?.scenarios?.find((s) => s.id === 'H') : undefined;
  if (!h) return notRun(12, 'AI-block verification', 'No live run of the build-time check is recorded. The check is covered by unit tests with stored cases (src/core/pipeline/verify-blocks.test.ts).');
  const o = h.observed;
  return {
    n: 12, title: 'AI-block verification',
    providers: { 'Cloud writes the test cases, Gemini Nano runs the step (Chrome)': { pass: h.pass, status: o.status, testCount: o.testCount, passCount: o.passCount, judgeUsed: o.judgeUsed, evidence: `docs/evidence/${name}, scenario H` } },
    note: 'One classify step, model-written test inputs. Open-ended steps (summarise, translate) are graded by a cloud judge and are not in this run.',
  };
}

const categories = [
  compilerEntry(1, 'Simple application generation', 'simple', 'Text and voice requests the golden set labels simple. Templates build them with no model; two cases are too vague or need the cloud and were not built.'),
  compilerEntry(2, 'Medium application generation', 'medium', 'Text and voice requests labelled medium.'),
  compilerEntry(3, 'Complex application generation', 'complex', 'Text and voice requests labelled complex.'),
  compilerEntry(4, 'Sketch understanding', 'sketch', 'Synthetic sketches (stamps and text). Hand-drawn photographs are not in the set.'),
  notRun(5, 'Image field extraction', 'Needs real photographs of slips and receipts. The set holds synthetic placeholders that are never sent to a model, and the device model is not assumed to read images (capabilities.ts).'),
  task(6, 'Voice action interpretation', 'voice_action', 'Spoken commands the app\'s own phrases do not match; five more commands of the 28 never reach a model because the phrases answer them.'),
  notRun(7, 'Small edits', 'No case set yet. The deterministic edit parser answers most small edits with no model; the device path has tests but no benchmark.'),
  notRun(8, 'Structural edits', 'No case set yet. Structural edits always go to the cloud; they are covered by unit tests only.'),
  task(9, 'Classification', 'classify', 'The complexity tie-break between two levels, over the labelled request sets (84 cases). The same gate also covers AI steps that classify text.'),
  task(10, 'Summarisation', 'summarize', 'Invented order-book notes of one or two sentences, summarised in 25 words or fewer.'),
  task(11, 'Translation', 'translate', 'English to Spanish and Japanese, the only languages besides English the Chrome Prompt API speaks. Hindi and the other app languages always go to the cloud.'),
  matrixCheck(),
];

const out = {
  kind: 'benchmark-categories',
  createdAt: new Date().toISOString(),
  source: { liveReport: live ? { promptVersion: live.promptVersion, datasetHash: live.datasetHash, createdAt: live.createdAt } : 'missing', gates: 'src/core/ai/local-ready.ts LOCAL_GATES' },
  howToRead: 'Each category is reported on its own. Rates are of the cases run. A category marked not run has no number here.',
  categories,
};

const cell = (v) => (typeof v === 'string' ? v : v.cases && v.correct !== undefined ? `${v.correct}% right, ${v.schemaValid}% valid, p95 ${v.p95Ms} ms${v.gate ? `, device gate ${v.gate}` : ''}` : JSON.stringify(v));
for (const k of categories) {
  console.log(`${String(k.n).padStart(2)}. ${k.title}`);
  if (typeof k.providers === 'string') console.log(`    ${k.providers}`);
  else for (const [name, v] of Object.entries(k.providers)) console.log(`    ${name}: ${cell(v)}`);
}
if (argv.includes('--write')) {
  const file = join(EVIDENCE, `benchmark-categories-${new Date().toLocaleDateString('sv-SE')}.json`);
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Written to ${file}`);
}
