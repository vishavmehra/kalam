#!/usr/bin/env node
/**
 * Merges the scores a person exported from tests/evaluation/review/index.html into the run report and prints the
 * docs/13 metrics: semantic accuracy (from the person's scores), first-pass and post-repair validity, field and
 * control accuracy, reference integrity, latency, and how often the AI pre-score agreed with the person.
 *
 *   node scripts/eval-merge-scores.mjs kalam-scores-<run>.json            finds the report by its run id
 *   node scripts/eval-merge-scores.mjs report.json kalam-scores-<run>.json
 *   options: --out-dir DIR  --json (print the final report instead of the summary)
 *
 * No model is called. Writes <report name>-final.json next to the report.
 *
 * A scores file may carry "reviewerType" (default "human"). Anything else, such as "ai-delegated" for an AI reviewer
 * the owner delegated scoring to, is written into the final report and relabels the person-worded summary, so AI
 * scores are never presented as human ones.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORTS = join(ROOT, 'tests', 'evaluation', 'reports');
const argv = process.argv.slice(2);
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out-dir');
const outIdx = argv.indexOf('--out-dir');

const fail = (msg) => {
  console.error(`${msg}\nUsage: node scripts/eval-merge-scores.mjs [report.json] scores.json`);
  return 2;
};

function findReport(evaluationId) {
  if (!existsSync(REPORTS)) return undefined;
  const names = readdirSync(REPORTS).filter(
    (f) => f.startsWith(evaluationId) && f.endsWith('.json') && !f.endsWith('-final.json'),
  );
  // Prefer the pre-scored report: it carries the AI scores.
  const best = names.find((f) => f.endsWith('-prescored.json')) ?? names[0];
  return best ? join(REPORTS, best) : undefined;
}

/** "human" unless the scores file names another reviewer type. */
export const reviewerTypeOf = (scores) =>
  typeof scores?.reviewerType === 'string' && scores.reviewerType.trim() ? scores.reviewerType.trim() : 'human';

/** Rewords the person-worded labels from runner.formatFinal and the caveats when the reviewer is not a person. */
export function relabelForReviewer(text, reviewerType) {
  if (reviewerType === 'human') return text;
  return text
    .replaceAll('person scored', 'reviewer scored')
    .replaceAll('against the person', 'against the reviewer')
    .replaceAll('Human scores judge', 'Reviewer scores judge')
    .replaceAll('counted as a human score', 'counted as a reviewer score');
}

/** Records the reviewer type on the final report and, for a non-human reviewer, says so first in the caveats. */
export function markReviewer(final, reviewerType) {
  if (reviewerType === 'human') return { ...final, reviewerType };
  const who = final.reviewer ?? 'a reviewer who is not a person';
  return {
    ...final,
    reviewerType,
    caveats: [
      `Scores are from ${who} (reviewer type "${reviewerType}"), not from a person. Fields named human* and "semantic accuracy" hold these scores, so they are not human-evaluated.`,
      ...final.caveats.map((c) => relabelForReviewer(c, reviewerType)),
    ],
  };
}

async function main() {
  if (positional.length === 0) return fail('Give the scores file exported from the scoring page.');
  const scoresPath = resolve(positional[positional.length - 1]);
  if (!existsSync(scoresPath)) return fail(`Cannot find ${scoresPath}.`);
  const scores = JSON.parse(readFileSync(scoresPath, 'utf8'));
  const reportPath = positional.length > 1 ? resolve(positional[0]) : findReport(scores.evaluationId);
  if (!reportPath || !existsSync(reportPath)) {
    return fail(`Cannot find the report for run ${scores.evaluationId}. Pass its path as the first argument.`);
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));

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
    const runner = await vite.ssrLoadModule('/tests/evaluation/runner/index.ts');
    const reviewerType = reviewerTypeOf(scores);
    let final;
    try {
      final = markReviewer(runner.mergeScores(report, scores), reviewerType);
    } catch (e) {
      if (e instanceof runner.ScoresError) return fail(e.message);
      throw e;
    }
    const outDir = outIdx >= 0 ? resolve(ROOT, argv[outIdx + 1]) : dirname(reportPath);
    const outFile = join(outDir, `${basename(reportPath).replace(/(-prescored)?\.json$/, '')}-final.json`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outFile, `${JSON.stringify(final, null, 2)}\n`);
    if (argv.includes('--json')) console.log(JSON.stringify(final, null, 2));
    else {
      console.log(relabelForReviewer(runner.formatFinal(final), reviewerType));
      console.log(`\nFinal report written to ${outFile.replace(ROOT, '').replace(/^[\/]/, '')}`);
    }
    return 0;
  } finally {
    await vite.close();
  }
}

// Run only from the command line, so the helpers above can be imported by a test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(String(e?.stack ?? e?.message ?? e).slice(0, 800));
      process.exitCode = 2;
    },
  );
}
