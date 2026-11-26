#!/usr/bin/env node
/**
 * AI pre-scores for a Kalam evaluation report (docs/13 §6.5, §18.2). For every case that built an app it asks one
 * question through Firebase AI Logic: does this app do what the person asked? The answer is Zod-validated JSON
 * (correct, partly or wrong, short reasons, a confidence). Deterministic facts (fields, controls, actions, formulas)
 * were already checked by scripts/eval.mjs and are shown to the judge as given.
 *
 *   node scripts/eval-judge.mjs --budget 75                 newest live report in tests/evaluation/reports
 *   node scripts/eval-judge.mjs path/to/report.json --budget 75
 *   node scripts/eval-judge.mjs --reassess [report.json]    no model: keep the AI scores already in the report and
 *                                                           recompute which cases may need a closer look
 *   node scripts/eval-judge.mjs --budget 0                  no model, no AI scores (the page still works)
 *   options: --case ID (repeatable)  --concurrency N (default 3)  --out-dir DIR
 *
 * --budget N is the hard cap on model requests, enforced on `fetch` (requests past it never leave the machine).
 * Every real request costs money. The AI pre-score is advice. It is never written as a human score.
 * Config values and keys are never printed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnv, initFirebase, installSpendCap, loadEnv } from './lib/eval-live.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORTS = join(ROOT, 'tests', 'evaluation', 'reports');
const argv = process.argv.slice(2);

const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flagValues = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));
const valueFlags = new Set(['--budget', '--case', '--concurrency', '--out-dir']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !valueFlags.has(argv[i - 1]));

function usageError(msg) {
  console.error(`${msg}\nRun: node scripts/eval-judge.mjs [report.json] --budget N`);
  return 2;
}

function newestLiveReport() {
  if (!existsSync(REPORTS)) return undefined;
  const files = readdirSync(REPORTS)
    .filter((f) => /^eval-.*-live\.json$/.test(f))
    .map((f) => join(REPORTS, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0];
}

async function main() {
  const reassess = argv.includes('--reassess');
  const budgetArg = reassess ? (flagValue('--budget') ?? '0') : flagValue('--budget');
  if (budgetArg === undefined)
    return usageError('--budget N is required (the most model requests to make). Nothing was run.');
  const budget = Number(budgetArg);
  if (!Number.isInteger(budget) || budget < 0) return usageError('--budget must be a whole number, 0 or more.');
  const concurrency = Math.max(1, Math.min(6, Number(flagValue('--concurrency') ?? 3) || 3));
  const only = new Set(flagValues('--case'));

  const reportPath = positional[0] ? resolve(positional[0]) : newestLiveReport();
  if (!reportPath || !existsSync(reportPath))
    return usageError('No report found. Run scripts/eval.mjs --live first, or pass a report path.');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (report.schema !== 'kalam-eval-report/1') return usageError('That file is not a Kalam evaluation report.');
  if (!report.cases.some((c) => c.detail))
    return usageError('This report has no case detail. Re-run scripts/eval.mjs to make one.');

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
    const runner = await load('/tests/evaluation/runner/index.ts');

    const targets = report.cases.filter((c) => (only.size ? only.has(c.id) : true));
    const buildable = reassess ? [] : targets.filter((c) => c.detail?.spec);
    const judged = new Map(); // id -> AIPreScore
    for (const c of targets) {
      if (!c.detail?.spec) {
        judged.set(c.id, {
          score: null,
          reasons: [],
          confidence: null,
          note: c.detail?.notBuilt ?? 'Nothing was built for this case, so there is nothing to score.',
        });
      }
    }

    if (reassess) for (const c of targets) if (c.aiPreScore && c.detail?.spec) judged.set(c.id, c.aiPreScore);
    const prev = report.judge;
    let spend = { used: () => 0, refused: () => 0 };
    let model = '';
    if (budget > 0 && buildable.length) {
      const env = loadEnv(ROOT);
      const scrub = applyEnv(env);
      spend = installSpendCap(budget, scrub);
      const firebase = await initFirebase(env);
      const [{ createFirebaseProvider }, { toJsonSchema }, { zodParser }, { modelForRole }] = await Promise.all([
        load('/src/infrastructure/firebase/firebase-provider.ts'),
        load('/src/core/ai/json-schema.ts'),
        load('/src/core/compiler/ir.ts'),
        load('/src/core/ai/model-config.ts'),
      ]);
      model = modelForRole('judge');
      const provider = createFirebaseProvider();
      const jsonSchema = toJsonSchema(runner.judgeSchema);
      const parse = zodParser(runner.judgeSchema);
      console.log(
        `Judging ${buildable.length} built app(s) with ${model}, at most ${budget} request(s). App Check: ${firebase.appCheck}.`,
      );

      const askOnce = async (c) => {
        const tokens = { input: 0, output: 0 };
        const res = await provider.generateStructured({
          taskType: 'classify',
          system: runner.JUDGE_SYSTEM,
          prompt: runner.buildJudgePrompt(c.detail),
          jsonSchema,
          parse,
          mode: 'only_in_cloud',
          role: 'judge',
          temperature: 0,
          maxOutputTokens: 2048,
          timeoutMs: 60_000,
          onUsage: (u) => {
            tokens.input += u.input ?? 0;
            tokens.output += u.output ?? 0;
          },
        });
        return { res, tokens };
      };

      const judgeCase = async (c) => {
        const before = spend.used();
        const total = { input: 0, output: 0 };
        const started = Date.now();
        let last;
        // One retry for a transient or malformed answer. The spend cap still applies to both.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const { res, tokens } = await askOnce(c);
          total.input += tokens.input;
          total.output += tokens.output;
          last = res;
          if (res.success) break;
          if (res.errorCode === 'quota' && spend.used() >= budget) break;
          if (!['invalid_output', 'provider_error', 'timeout', 'quota'].includes(res.errorCode)) break;
        }
        const common = {
          model: last?.model ?? model,
          httpCalls: spend.used() - before,
          inputTokens: total.input,
          outputTokens: total.output,
          latencyMs: Date.now() - started,
        };
        if (last?.success && last.output) {
          judged.set(c.id, {
            score: last.output.score,
            reasons: last.output.reasons,
            confidence: last.output.confidence,
            ...common,
          });
        } else {
          judged.set(c.id, {
            score: null,
            reasons: [],
            confidence: null,
            ...common,
            note: `The AI judge did not answer (${last?.errorCode ?? 'error'}).${last?.errorMessage ? ` ${scrub(last.errorMessage).slice(0, 200)}` : ''}`,
          });
        }
        console.log(
          `[${judged.size}/${targets.length}] ${c.id}: ${judged.get(c.id).score ?? 'no score'}${judged.get(c.id).confidence !== null ? ` (confidence ${judged.get(c.id).confidence})` : ''}, requests so far ${spend.used()}/${budget}`,
        );
      };

      // Small worker pool: judge calls are short and independent.
      const queue = [...buildable];
      await Promise.all(
        Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
          for (let c = queue.shift(); c; c = queue.shift()) {
            if (spend.used() >= budget) {
              judged.set(c.id, {
                score: null,
                reasons: [],
                confidence: null,
                note: `Judge request budget used up (${budget}).`,
              });
              continue;
            }
            await judgeCase(c);
          }
        }),
      );
    } else {
      for (const c of buildable) {
        judged.set(c.id, { score: null, reasons: [], confidence: null, note: 'No model was asked (budget 0).' });
      }
    }

    // ── Write the pre-scored report ──
    const dist = { correct: 0, partly: 0, wrong: 0 };
    let failed = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    for (const c of report.cases) {
      const ai = judged.get(c.id);
      if (!ai) continue;
      c.aiPreScore = ai;
      c.mayDisagree = runner.assessDisagreement(c, c.detail?.spec ? ai : undefined);
      if (!c.detail?.spec) c.mayDisagree = { flag: false, reasons: [] };
      if (ai.score) dist[ai.score] += 1;
      else if (c.detail?.spec) failed += 1;
      inputTokens += ai.inputTokens ?? 0;
      outputTokens += ai.outputTokens ?? 0;
    }
    report.judge = {
      model: reassess ? (prev?.model ?? 'none') : model || 'none',
      budget: reassess ? (prev?.budget ?? 0) : budget,
      httpCalls: reassess ? (prev?.httpCalls ?? 0) : spend.used(),
      inputTokens: reassess ? (prev?.inputTokens ?? 0) : inputTokens,
      outputTokens: reassess ? (prev?.outputTokens ?? 0) : outputTokens,
      scored: dist.correct + dist.partly + dist.wrong,
      failed,
      notBuilt: report.cases.filter((c) => !c.detail?.spec).length,
      distribution: dist,
      flaggedMayDisagree: report.cases.filter((c) => c.mayDisagree?.flag).length,
    };
    report.notes = [
      ...report.notes.filter((n) => !n.startsWith('AI pre-scores')),
      `AI pre-scores by ${report.judge.model} (${report.judge.httpCalls} request(s)). They are advice for the person scoring and are not human scores.`,
    ];
    const outDir = flagValue('--out-dir') ? resolve(ROOT, flagValue('--out-dir')) : REPORTS;
    const outFile = join(outDir, `${basename(reportPath).replace(/(-prescored)?\.json$/, '')}-prescored.json`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);

    const j = report.judge;
    console.log('');
    console.log(`AI pre-scores for ${report.evaluationId}`);
    console.log(`Requests: ${j.httpCalls} of ${j.budget}. Tokens: ${j.inputTokens} in, ${j.outputTokens} out.`);
    console.log(
      `Scored ${j.scored}: correct ${dist.correct}, partly ${dist.partly}, wrong ${dist.wrong}. No answer: ${j.failed}. Nothing built: ${j.notBuilt}.`,
    );
    console.log(`Cases where a person may disagree: ${j.flaggedMayDisagree}.`);
    const worry = report.cases
      .filter(
        (c) =>
          c.aiPreScore?.score === 'wrong' ||
          (c.aiPreScore?.score === 'partly' && (c.aiPreScore.confidence ?? 1) >= 0.7),
      )
      .map((c) => `  ${c.id}: ${c.aiPreScore.score} (${c.aiPreScore.confidence}) ${c.aiPreScore.reasons[0] ?? ''}`);
    if (worry.length) console.log(`Most likely wrong or partly:\n${worry.join('\n')}`);
    console.log(`Report written to ${outFile.replace(ROOT, '').replace(/^[\\/]/, '')}`);
    return 0;
  } finally {
    await vite.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(String(e?.stack ?? e?.message ?? e).slice(0, 800));
    process.exitCode = 2;
  },
);
