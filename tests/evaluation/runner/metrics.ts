/**
 * Aggregates case results into the per-dataset metrics and the machine-readable report of docs/13 §19.
 * Metrics stay separate (docs/13 §6.6: never one blended accuracy number) and modalities are never merged.
 */
import { latencyStats, median, percentile, rate, round } from './stats';
import {
  DATASETS,
  type CaseResult,
  type Dataset,
  type DatasetMetrics,
  type EvalMode,
  type EvalReport,
  type GateResult,
  type GateThresholds,
  type HumanReviewSummary,
  type HybridSummary,
  type Rate,
  type ScenarioStatus,
} from './types';

/** Initial regression floors for CI. Targets are higher (docs/07 §20.4: template apps 100% valid). */
export const DEFAULT_THRESHOLDS: GateThresholds = {
  templateValidity: 1,
  textComplexity: 0.8,
  textRoute: 0.9,
  sketchRoute: 1,
  sketchExtraction: 1,
  modalityRoute: 0.85,
  offlineGraceful: 1,
  runtime: 1,
};

/** docs/13 §18.1. Scored 0 (wrong), 1 (partly right) or 2 (right) by a person, one score per criterion. */
export const HUMAN_RUBRIC: readonly string[] = [
  'Intent correctness',
  'Screen structure',
  'Component selection',
  'Field correctness',
  'Action correctness',
  'Data model correctness',
  'Visual similarity',
  'Formula correctness',
  'Accessibility',
  'Runtime functionality',
];

const count = <T>(xs: readonly T[], pred: (x: T) => boolean): number => xs.filter(pred).length;
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export function summarizeDataset(all: readonly CaseResult[], dataset: Dataset): DatasetMetrics {
  const rs = all.filter((r) => r.dataset === dataset);
  const okRate = (get: (r: CaseResult) => { ok: boolean } | undefined): Rate => {
    const has = rs.map(get).filter((c): c is { ok: boolean } => !!c);
    return rate(
      count(has, (c) => c.ok),
      has.length,
    );
  };

  const confusion: Record<string, Record<string, number>> = {};
  for (const r of rs) {
    const want = String(r.checks.complexity.expected);
    const got = String(r.checks.complexity.actual);
    confusion[want] ??= {};
    confusion[want][got] = (confusion[want][got] ?? 0) + 1;
  }

  const template = rs.filter((r) => r.build.stage === 'template');
  const cloudRoute = rs.filter((r) => r.classification.route === 'cloud');
  const cloud = rs.filter((r) => r.build.stage === 'cloud');
  const withSpec = rs.filter((r) => r.semantic);
  const sem = withSpec.map((r) => r.semantic!);
  const nonAmbiguous = rs.filter((r) => !r.ambiguous);
  const offline = rs.map((r) => r.offline).filter((o): o is NonNullable<typeof o> => !!o);
  const smoke = rs.map((r) => r.runtime).filter((o): o is NonNullable<typeof o> => !!o);

  const metrics: DatasetMetrics = {
    cases: rs.length,
    ambiguousCases: count(rs, (r) => r.ambiguous),
    classifier: {
      complexity: okRate((r) => r.checks.complexity),
      complexityExcludingAmbiguous: rate(
        count(nonAmbiguous, (r) => r.checks.complexity.ok),
        nonAmbiguous.length,
      ),
      route: okRate((r) => r.checks.route),
      template: okRate((r) => r.checks.template),
      taskType: okRate((r) => r.checks.taskType),
      multimodal: okRate((r) => r.checks.multimodal),
      lowConfidence: okRate((r) => r.checks.lowConfidence),
      confusion,
    },
    build: {
      templateRoute: {
        attempted: template.length,
        built: count(template, (r) => r.build.ok),
        valid: rate(
          count(template, (r) => r.build.valid),
          template.length,
        ),
        described: rate(
          count(template, (r) => r.build.describeOk),
          template.length,
        ),
      },
      cloudRequired: {
        cases: cloudRoute.length,
        skipped: count(cloudRoute, (r) => r.build.stage === 'skipped'),
        attempted: cloud.length,
        offlineGraceful: rate(
          count(offline, (o) => o.graceful),
          offline.length,
        ),
      },
    },
    runtime: rate(
      count(smoke, (s) => s.ok),
      smoke.length,
    ),
    semantic: {
      cases: withSpec.length,
      screens: rate(
        count(sem, (s) => s.screens.ok),
        sem.length,
      ),
      collections: rate(
        count(sem, (s) => s.collections.ok),
        sem.length,
      ),
      fields: rate(sum(sem.map((s) => s.fields.found)), sum(sem.map((s) => s.fields.total))),
      components: rate(sum(sem.map((s) => s.components.found)), sum(sem.map((s) => s.components.total))),
      forbiddenText: rate(
        count(sem, (s) => s.forbiddenText.ok),
        sem.length,
      ),
    },
    review: {
      pending: count(rs, (r) => r.review === 'needs_human_review'),
      reviewed: count(rs, (r) => r.review === 'human_reviewed'),
      needsAssets: count(rs, (r) => !!r.needsAssets),
    },
    latency: {
      classifier: latencyStats(rs.map((r) => r.latencyMs.classify)),
      templateBuild: latencyStats(template.map((r) => r.latencyMs.build)),
      cloudBuild: latencyStats(cloud.map((r) => r.latencyMs.build)),
    },
  };

  const ext = rs.map((r) => r.extraction).filter((x): x is NonNullable<typeof x> => !!x);
  if (ext.length) {
    metrics.extraction = {
      pageCount: rate(
        count(ext, (x) => x.pageCount.ok),
        ext.length,
      ),
      labels: rate(sum(ext.map((x) => x.labels.found)), sum(ext.map((x) => x.labels.total))),
      stamps: rate(sum(ext.map((x) => x.stamps.found)), sum(ext.map((x) => x.stamps.total))),
    };
  }

  if (cloud.length) {
    const valid = (r: CaseResult) => r.build.ok && r.build.valid;
    const firstPass = (r: CaseResult) => r.build.firstPassValid === true;
    const needed = cloud.filter((r) => !firstPass(r));
    const sources: Record<string, number> = {};
    for (const r of cloud) {
      const key = `${r.build.provider ?? 'none'}:${r.build.route ?? 'none'}`;
      sources[key] = (sources[key] ?? 0) + 1;
    }
    metrics.live = {
      attempted: cloud.length,
      firstPassValid: rate(count(cloud, firstPass), cloud.length),
      validAfterRepair: rate(count(cloud, valid), cloud.length),
      repairSuccess: rate(count(needed, valid), needed.length),
      sources,
    };
  }
  return metrics;
}

// ─── Hybrid inference accounting (docs/13 §9.2, §9.3) ─────────────────────────────────────────
export interface HybridEventInput {
  route: string;
  /** Where the answer really came from. Absent for deterministic decisions that made no model call. */
  source?: string;
  success: boolean;
  latencyMs?: number;
  fallbackUsed?: boolean;
}

/**
 * Counts events by the source the orchestrator reported and flags any source that cannot be true. A source is
 * never inferred from a preference (docs/13 §9.3), so an on-device claim on a platform without a model is a violation.
 */
export function summarizeHybrid(
  events: readonly HybridEventInput[],
  platform: { onDeviceAvailable: boolean },
): HybridSummary {
  const groups = new Map<string, HybridEventInput[]>();
  const violations: string[] = [];
  events.forEach((e, i) => {
    const key = e.source ?? 'deterministic';
    groups.set(key, [...(groups.get(key) ?? []), e]);
    if (key === 'on_device' && !platform.onDeviceAvailable)
      violations.push(`event ${i + 1}: reports on_device, but this platform has no on-device model`);
    if (e.route === 'cloud' && key === 'on_device')
      violations.push(`event ${i + 1}: route is cloud but the source is on_device`);
  });
  const bySource: HybridSummary['bySource'] = {};
  for (const [key, list] of groups) {
    const ms = list.map((e) => e.latencyMs).filter((n): n is number => typeof n === 'number');
    const p95 = percentile(ms, 95);
    bySource[key] = {
      count: list.length,
      success: count(list, (e) => e.success),
      medianMs: median(ms),
      p95Ms: p95 === null ? null : round(p95, 2),
    };
  }
  return {
    events: events.length,
    modelCalls: count(events, (e) => e.source === 'cloud' || e.source === 'on_device'),
    bySource,
    sourceViolations: violations,
  };
}

/** What this run really exercised of docs/13 §9.1, and what it did not. Never claims a scenario it did not run. */
export function scenarioStatuses(
  mode: EvalMode,
  results: readonly CaseResult[],
  hybrid: HybridSummary,
): ScenarioStatus[] {
  const offline = results.map((r) => r.offline).filter((o): o is NonNullable<typeof o> => !!o);
  const cloudOk = count(results, (r) => r.build.stage === 'cloud' && r.build.ok);
  const needsNano =
    'Needs Gemini Nano in Chrome (CDP 9333). Not available in Node; see scripts/verify-firebase-ai.mjs and the browser hybrid spec.';
  const mocksOnly =
    'Covered by unit tests with mocked providers (src/core/ai/orchestrator.test.ts). Mocks do not prove real local inference.';
  return [
    { id: 'A', title: 'Local model available', status: 'not_run', evidence: needsNano },
    {
      id: 'B',
      title: 'Local model unavailable, cloud fallback',
      status: mode === 'live' && cloudOk > 0 ? 'exercised' : 'not_run',
      evidence:
        mode === 'live' && cloudOk > 0
          ? `${cloudOk} real cloud compile(s) from Node, which exposes no on-device model; sources: ${Object.keys(hybrid.bySource).join(', ') || 'none'}.`
          : 'Needs a live run (--live --budget N).',
    },
    { id: 'C', title: 'Local model failure, retry and fallback', status: 'not_run', evidence: mocksOnly },
    { id: 'D', title: 'Local-only mode never routes to cloud', status: 'not_run', evidence: mocksOnly },
    {
      id: 'E',
      title: 'Offline: saved apps work, AI fails gracefully',
      status: offline.length > 0 ? 'exercised' : 'not_run',
      evidence:
        offline.length > 0
          ? `${count(offline, (o) => o.graceful)} of ${offline.length} cloud-route request(s) failed with a plain message and no model call; template apps built with the model unreachable.`
          : 'No cloud-route case was run offline.',
    },
  ];
}

export function summarizeHumanReview(
  results: readonly CaseResult[],
  handDrawn?: HumanReviewSummary['handDrawnPhotos'],
): HumanReviewSummary {
  return {
    rubric: [...HUMAN_RUBRIC],
    scale:
      '0 = wrong, 1 = partly right, 2 = right, scored per criterion by a person who has not seen the model output first',
    pending: results.filter((r) => r.review === 'needs_human_review').map((r) => r.id),
    reviewed: results.filter((r) => r.review === 'human_reviewed').map((r) => r.id),
    needsAssets: results.filter((r) => r.needsAssets).map((r) => ({ id: r.id, asset: r.needsAssets as string })),
    ...(handDrawn ? { handDrawnPhotos: handDrawn } : {}),
  };
}

const stageOf = (failure: string): string => /^[a-z]+/.exec(failure)?.[0] ?? 'other';

export interface ReportInput {
  mode: EvalMode;
  datasetVersion: string;
  results: readonly CaseResult[];
  platform: string;
  promptVersion: string;
  datasetHash: string;
  cloudCalls: number;
  createdAt: Date;
  /** Orchestrator events (live) or recorded deterministic decisions (offline). */
  events?: readonly HybridEventInput[];
  handDrawnPhotos?: HumanReviewSummary['handDrawnPhotos'];
  notes?: string[];
}

/** docs/13 §19: one machine-readable document per run, with no private user data. */
export function buildReport(input: ReportInput): EvalReport {
  const { results, mode } = input;
  const datasets: EvalReport['datasets'] = {};
  for (const d of DATASETS) {
    if (results.some((r) => r.dataset === d)) datasets[d] = summarizeDataset(results, d);
  }
  const liveCases = results.filter((r) => r.build.stage === 'cloud');
  const built = results.filter((r) => r.build.stage !== 'skipped');
  const timed = (built.length ? built : results).map((r) => r.latencyMs.total);
  const models = [...new Set(results.map((r) => r.build.model).filter((m): m is string => !!m))].sort();
  const stamp = input.createdAt.toISOString().replace(/[:.]/g, '-');
  const p95 = percentile(timed, 95);
  const notes = [...(input.notes ?? [])];
  if (mode === 'deterministic') {
    notes.push('Deterministic run: no model was called. Cloud-route requests were classified but not compiled.');
  }
  const pendingSketches = results.filter((r) => r.dataset === 'sketch' && r.review === 'needs_human_review').length;
  if (pendingSketches > 0) {
    notes.push(
      `${pendingSketches} golden sketch(es) have machine-authored expectations that no person has reviewed yet (docs/13 §7.3).`,
    );
  }
  const hybrid = summarizeHybrid(input.events ?? [], { onDeviceAvailable: false });
  const failuresByStage: Record<string, number> = {};
  for (const r of results)
    for (const f of r.failures) failuresByStage[stageOf(f)] = (failuresByStage[stageOf(f)] ?? 0) + 1;
  const passes = results.flatMap((r) => r.build.attempts ?? []);
  const failedPasses = passes.filter((a) => a.stage !== 'ok');
  const tally = (keys: string[]) => keys.reduce<Record<string, number>>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});
  const compileFailures = passes.length
    ? {
        passes: passes.length,
        byStage: tally(failedPasses.map((a) => `${a.pass}:${a.stage}`)),
        byCode: tally(
          failedPasses.flatMap((a) =>
            a.issues.length ? a.issues.map((i) => i.split(' ')[0]) : [a.errorCode ?? 'unknown'],
          ),
        ),
      }
    : undefined;

  return {
    schema: 'kalam-eval-report/1',
    evaluationId: `eval-${stamp}-${mode}`,
    createdAt: input.createdAt.toISOString(),
    mode,
    datasetVersion: input.datasetVersion,
    platform: input.platform,
    models,
    promptVersion: input.promptVersion,
    datasetHash: input.datasetHash,
    inferenceSource: mode === 'live' ? 'cloud' : 'deterministic',
    cloudCalls: input.cloudCalls,
    totalCases: results.length,
    datasets,
    firstPassValid: liveCases.length
      ? rate(
          count(liveCases, (r) => r.build.firstPassValid === true),
          liveCases.length,
        ).rate
      : null,
    validAfterRepair: liveCases.length
      ? rate(
          count(liveCases, (r) => r.build.ok && r.build.valid),
          liveCases.length,
        ).rate
      : null,
    latency: { medianMs: median(timed), p95Ms: p95 === null ? null : round(p95, 2) },
    failures: results
      .filter((r) => r.failures.length > 0)
      .map((r) => ({ id: r.id, dataset: r.dataset, reasons: r.failures })),
    failuresByStage,
    ...(compileFailures ? { compileFailures } : {}),
    hybrid,
    scenarios: scenarioStatuses(mode, results, hybrid),
    humanReview: summarizeHumanReview(results, input.handDrawnPhotos),
    cases: [...results],
    notes,
  };
}

/** Gate for CI: floors per dataset, never a blended score. Returns the reasons it failed. */
export function evaluateGate(report: EvalReport, t: GateThresholds = DEFAULT_THRESHOLDS): GateResult {
  const reasons: string[] = [];
  const need = (label: string, r: Rate | undefined, min: number) => {
    if (!r || r.total === 0 || r.rate === null) return;
    if (r.rate < min)
      reasons.push(
        `${label} ${(r.rate * 100).toFixed(1)}% (${r.correct}/${r.total}) is below ${(min * 100).toFixed(0)}%`,
      );
  };
  const text = report.datasets.text;
  const sketch = report.datasets.sketch;
  need('text complexity accuracy', text?.classifier.complexity, t.textComplexity);
  need('text route accuracy', text?.classifier.route, t.textRoute);
  need('sketch route accuracy', sketch?.classifier.route, t.sketchRoute);
  need('sketch label extraction', sketch?.extraction?.labels, t.sketchExtraction);
  need('sketch stamp extraction', sketch?.extraction?.stamps, t.sketchExtraction);
  for (const d of DATASETS) {
    const m = report.datasets[d];
    need(`${d} template-route validity`, m?.build.templateRoute.valid, t.templateValidity);
    need(`${d} offline failure handling`, m?.build.cloudRequired.offlineGraceful, t.offlineGraceful);
    need(`${d} runtime smoke`, m?.runtime, t.runtime);
    if (d !== 'text' && d !== 'sketch') need(`${d} route accuracy`, m?.classifier.route, t.modalityRoute);
  }
  if (report.hybrid.sourceViolations.length)
    reasons.push(`inference source reported wrongly: ${report.hybrid.sourceViolations[0]}`);
  return { pass: reasons.length === 0, reasons };
}
