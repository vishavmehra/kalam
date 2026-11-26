/**
 * Merges the human scores from the scoring page into a run report and produces the docs/13 §6.6 numbers.
 * Pure: no I/O. Modalities and metrics are never blended into one number (docs/13 §6.6, §7.4).
 *
 * The human score judges Kalam's OUTPUT for a case. It does not review the golden labels, so those stay
 * "needs_human_review" until someone checks the expectations themselves.
 */
import { summarizeStructure } from './compiler-metrics';
import { rate, round } from './stats';
import type { CaseResult, Dataset, EvalReport, HumanScoresFile, Rate, Verdict } from './types';
import { VERDICTS } from './types';

export class ScoresError extends Error {}

export interface MergedCase {
  id: string;
  dataset: Dataset;
  route: 'template' | 'cloud';
  built: boolean;
  human?: Verdict;
  humanNote?: string;
  ai?: Verdict | null;
  aiConfidence?: number | null;
  agree?: boolean;
  flaggedMayDisagree?: boolean;
  firstPassValid?: boolean;
}

export interface DatasetFinal {
  cases: number;
  built: number;
  notBuilt: number;
  scoredByHuman: number;
  distribution: Record<Verdict, number>;
  /** Share of scored apps a person called correct. docs/13 §6.6 "semantic accuracy" (human-evaluated). */
  semanticAccuracy: Rate;
  /** Correct or partly right: an app a person could start from. */
  usable: Rate;
  /** Proxy for "user correction rate": apps scored partly or wrong, which would need fixing by hand. */
  correctionProxy: Rate;
  firstPassValidity: Rate | null;
  postRepairValidity: Rate | null;
  repairSuccess: Rate | null;
  /** Share of built apps that pass validateSpec, so every reference resolves. */
  referenceIntegrity: Rate;
  /** Required controls found, over all built apps (recall against the golden expectations). */
  componentRecall: Rate;
  /** Required fields found, over all built apps. */
  fieldAccuracy: Rate;
  /** Built apps in which every automatic check passed. */
  allChecksPass: Rate;
  /**
   * Proxies from the built spec itself (compiler-metrics.ts), because the golden set has no full expected spec: components
   * that are wired and asked for, advanced components nobody asked for, buttons whose label and action agree, and the
   * references the model's FIRST answer got right. Total 0 when the report holds no stored specs.
   */
  componentPrecision: Rate;
  hallucinatedComponents: Rate;
  actionAccuracy: Rate;
  referenceIntegrityFirstPass: Rate;
  latency: { templateMedianMs: number | null; cloudMedianMs: number | null; cloudP95Ms: number | null };
  notScored: string[];
}

export interface Agreement {
  /** Cases scored by both the AI and a person. */
  compared: number;
  agreed: Rate;
  /** AI said correct, person said partly or wrong. */
  aiTooGenerous: number;
  /** AI said wrong or partly, person said correct. */
  aiTooHarsh: number;
  /** Rows are the AI score, columns the person's. */
  matrix: Record<Verdict, Record<Verdict, number>>;
  /** Were the cases flagged "may disagree" really the ones the person disagreed on? */
  flagged: { cases: number; disagreed: number };
  unflagged: { cases: number; disagreed: number };
}

export interface FinalReport {
  schema: 'kalam-eval-final/1';
  basedOn: {
    evaluationId: string;
    datasetVersion: string;
    datasetHash: string;
    promptVersion: string;
    models: string[];
  };
  scoredAt: string;
  reviewer?: string;
  datasets: Partial<Record<Dataset, DatasetFinal>>;
  agreement: Agreement | null;
  cases: MergedCase[];
  notMeasured: Array<{ metric: string; reason: string }>;
  caveats: string[];
}

const emptyDist = (): Record<Verdict, number> => ({ correct: 0, partly: 0, wrong: 0 });

const isBuilt = (c: CaseResult): boolean => c.build.stage !== 'skipped' && c.build.ok;

function medianOf(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return round(s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2, 2);
}
function p95Of(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return round(s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] as number, 2);
}

/** Checks the scores belong to this report and returns them by case id. Throws a plain-English error if not. */
export function indexScores(report: EvalReport, file: HumanScoresFile): Map<string, { score: Verdict; note?: string }> {
  if (file.schema !== 'kalam-human-scores/1') throw new ScoresError('This is not a Kalam scores file (wrong schema).');
  if (file.evaluationId !== report.evaluationId) {
    throw new ScoresError(
      `These scores were made for run ${file.evaluationId}, but the report is ${report.evaluationId}. Use the scores file exported from this report.`,
    );
  }
  const known = new Set(report.cases.map((c) => c.id));
  const out = new Map<string, { score: Verdict; note?: string }>();
  const unknown: string[] = [];
  for (const s of file.scores) {
    if (!known.has(s.id)) unknown.push(s.id);
    else if (!VERDICTS.includes(s.score))
      throw new ScoresError(`Case ${s.id} has an unknown score "${String(s.score)}".`);
    else out.set(s.id, { score: s.score, ...(s.note?.trim() ? { note: s.note.trim() } : {}) });
  }
  if (unknown.length) throw new ScoresError(`Scores for cases that are not in the report: ${unknown.join(', ')}.`);
  return out;
}

export function mergeScores(report: EvalReport, file: HumanScoresFile): FinalReport {
  const human = indexScores(report, file);
  const cases: MergedCase[] = report.cases.map((c) => {
    const h = human.get(c.id);
    const ai = c.aiPreScore;
    const built = isBuilt(c);
    return {
      id: c.id,
      dataset: c.dataset,
      route: c.classification.route,
      built,
      ...(h ? { human: h.score, ...(h.note ? { humanNote: h.note } : {}) } : {}),
      ...(ai ? { ai: ai.score, aiConfidence: ai.confidence } : {}),
      ...(h && ai?.score ? { agree: h.score === ai.score } : {}),
      ...(c.mayDisagree ? { flaggedMayDisagree: c.mayDisagree.flag } : {}),
      ...(c.build.firstPassValid !== undefined ? { firstPassValid: c.build.firstPassValid } : {}),
    };
  });

  const datasets: FinalReport['datasets'] = {};
  const names = [...new Set(report.cases.map((c) => c.dataset))] as Dataset[];
  for (const d of names) {
    const rs = report.cases.filter((c) => c.dataset === d);
    const built = rs.filter(isBuilt);
    const dist = emptyDist();
    for (const c of built) {
      const h = human.get(c.id);
      if (h) dist[h.score] += 1;
    }
    const scored = dist.correct + dist.partly + dist.wrong;
    const cloud = rs.filter((c) => c.build.stage === 'cloud');
    const repaired = cloud.filter((c) => c.build.firstPassValid !== true);
    const okFinal = (c: CaseResult) => c.build.ok && c.build.valid;
    const sem = built.map((c) => c.semantic).filter((s): s is NonNullable<typeof s> => !!s);
    const checked = built.filter((c) => c.detail);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const cloudMs = cloud.map((c) => c.latencyMs.build);
    const structure = summarizeStructure(built);
    datasets[d] = {
      cases: rs.length,
      built: built.length,
      notBuilt: rs.length - built.length,
      scoredByHuman: scored,
      distribution: dist,
      semanticAccuracy: rate(dist.correct, scored),
      usable: rate(dist.correct + dist.partly, scored),
      correctionProxy: rate(dist.partly + dist.wrong, scored),
      firstPassValidity: cloud.length
        ? rate(cloud.filter((c) => c.build.firstPassValid === true).length, cloud.length)
        : null,
      postRepairValidity: cloud.length ? rate(cloud.filter(okFinal).length, cloud.length) : null,
      repairSuccess: cloud.length ? rate(repaired.filter(okFinal).length, repaired.length) : null,
      referenceIntegrity: rate(built.filter((c) => c.build.valid).length, built.length),
      componentRecall: rate(sum(sem.map((s) => s.components.found)), sum(sem.map((s) => s.components.total))),
      fieldAccuracy: rate(sum(sem.map((s) => s.fields.found)), sum(sem.map((s) => s.fields.total))),
      allChecksPass: rate(
        checked.filter((c) => !(c.detail?.checks ?? []).some((x) => x.status === 'fail')).length,
        checked.length,
      ),
      componentPrecision: structure.componentPrecision,
      hallucinatedComponents: structure.hallucinatedComponents,
      actionAccuracy: structure.actionAccuracy,
      referenceIntegrityFirstPass: structure.referenceIntegrityFirstPass,
      latency: {
        templateMedianMs: medianOf(rs.filter((c) => c.build.stage === 'template').map((c) => c.latencyMs.build)),
        cloudMedianMs: medianOf(cloudMs),
        cloudP95Ms: p95Of(cloudMs),
      },
      notScored: built.filter((c) => !human.has(c.id)).map((c) => c.id),
    };
  }

  return {
    schema: 'kalam-eval-final/1',
    basedOn: {
      evaluationId: report.evaluationId,
      datasetVersion: report.datasetVersion,
      datasetHash: report.datasetHash,
      promptVersion: report.promptVersion,
      models: [...report.models, ...(report.judge ? [`judge:${report.judge.model}`] : [])],
    },
    scoredAt: file.exportedAt,
    ...(file.reviewer ? { reviewer: file.reviewer } : {}),
    datasets,
    agreement: agreementOf(report, human),
    cases,
    notMeasured: notMeasuredOf(report),
    caveats: caveatsOf(report),
  };
}

function agreementOf(report: EvalReport, human: Map<string, { score: Verdict }>): Agreement | null {
  const matrix: Agreement['matrix'] = {
    correct: emptyDist(),
    partly: emptyDist(),
    wrong: emptyDist(),
  };
  let compared = 0;
  let agreed = 0;
  const flagged = { cases: 0, disagreed: 0 };
  const unflagged = { cases: 0, disagreed: 0 };
  for (const c of report.cases) {
    const h = human.get(c.id);
    const ai = c.aiPreScore?.score;
    if (!h || !ai) continue;
    compared += 1;
    matrix[ai][h.score] += 1;
    const same = ai === h.score;
    if (same) agreed += 1;
    const bucket = c.mayDisagree?.flag ? flagged : unflagged;
    bucket.cases += 1;
    if (!same) bucket.disagreed += 1;
  }
  if (!compared) return null;
  return {
    compared,
    agreed: rate(agreed, compared),
    aiTooGenerous: matrix.correct.partly + matrix.correct.wrong,
    aiTooHarsh: matrix.partly.correct + matrix.wrong.correct,
    matrix,
    flagged,
    unflagged,
  };
}

const notMeasuredOf = (report: EvalReport): FinalReport['notMeasured'] => [
  {
    metric: 'Component precision, exact',
    reason:
      'The proxy above counts components that are wired and asked for. Exact precision needs a full expected spec per case: the golden set lists the controls that must exist, not every control that is allowed.',
  },
  {
    metric: 'Hallucinated components, exact',
    reason:
      'The proxy counts advanced components (chart, timer, reminder, signature, photo) that neither the request nor the golden case asked for. Whether another component was unrequested only a person can judge.',
  },
  {
    metric: 'Action accuracy, exact',
    reason:
      'The proxy checks that each button label and its action agree. There are no expected actions per case, so a wrong but plausible action is not caught.',
  },
  {
    metric: 'User correction rate from real use',
    reason:
      'Needs people using Kalam and editing what it made. The reviewer proxy ("needs fixing by hand", apps scored partly or wrong) is reported instead.',
  },
  ...(report.humanReview.handDrawnPhotos?.present
    ? []
    : [
        {
          metric: 'Real hand-drawn sketch accuracy',
          reason:
            'The sketch set is built from stamps and text. None of the 25 sketches is a photographed drawing yet.',
        },
      ]),
  {
    metric: 'Image, video and most voice accuracy',
    reason: 'Those cases use placeholder media that is never sent to a model, so only routing was tested.',
  },
];

function caveatsOf(report: EvalReport): string[] {
  const out = [
    'Human scores judge what Kalam built. They do not review the golden labels, which stay needs_human_review.',
    'The AI pre-score is advice only. It is not counted as a human score anywhere in this report.',
    'Each modality is reported on its own. There is no blended accuracy number (docs/13 §6.6, §7.4).',
  ];
  if (report.humanReview.handDrawnPhotos) {
    const h = report.humanReview.handDrawnPhotos;
    out.push(`Hand-drawn photographed sketches: ${h.present} of ${h.required}.`);
  }
  return out;
}

/** The twelve compiler metrics of docs/13 §6.6, each on its own line, with what the number is based on. */
export const COMPILER_METRIC_NAMES = [
  'First-pass validity', 'Post-repair validity', 'Semantic accuracy', 'Component precision', 'Component recall',
  'Field accuracy', 'Action accuracy', 'Reference integrity', 'Hallucinated components', 'Repair success',
  'Compilation latency', 'User correction rate',
] as const;
export type CompilerMetricName = (typeof COMPILER_METRIC_NAMES)[number];
export interface CompilerMetricRow {
  metric: CompilerMetricName;
  /** A rate, or milliseconds for latency. null when this run could not measure it. */
  value: Rate | number | null;
  basis: 'measured' | 'proxy' | 'reviewer' | 'not measured';
  note: string;
}

export function compilerMetricTable(d: DatasetFinal): CompilerMetricRow[] {
  const row = (metric: CompilerMetricName, raw: Rate | number | null, basis: CompilerMetricRow['basis'], note: string): CompilerMetricRow => {
    const value = raw !== null && typeof raw === 'object' && raw.total === 0 ? null : raw;
    return { metric, note, value, basis: value === null ? 'not measured' : basis };
  };
  const live = 'Needs a live run (cloud compiles).';
  const person = 'Needs a person or an AI reviewer to score the built apps.';
  const spec = 'Needs built specs in the report.';
  return [
    row('First-pass validity', d.firstPassValidity, d.firstPassValidity ? 'measured' : 'not measured', d.firstPassValidity ? 'Valid before the repair pass.' : live),
    row('Post-repair validity', d.postRepairValidity, d.postRepairValidity ? 'measured' : 'not measured', d.postRepairValidity ? 'Valid after at most one repair pass.' : live),
    row('Semantic accuracy', d.scoredByHuman ? d.semanticAccuracy : null, d.scoredByHuman ? 'reviewer' : 'not measured', d.scoredByHuman ? 'Share of scored apps called correct.' : person),
    row('Component precision', d.componentPrecision, d.componentPrecision.total ? 'proxy' : 'not measured', d.componentPrecision.total ? 'Components that are wired and asked for.' : spec),
    row('Component recall', d.componentRecall, 'measured', 'Required components found, against the golden expectations.'),
    row('Field accuracy', d.fieldAccuracy, 'measured', 'Required fields found, with the right type, against the golden expectations.'),
    row('Action accuracy', d.actionAccuracy, d.actionAccuracy.total ? 'proxy' : 'not measured', d.actionAccuracy.total ? 'Button label and action agree.' : spec),
    row('Reference integrity', d.referenceIntegrityFirstPass.total ? d.referenceIntegrityFirstPass : d.referenceIntegrity, d.referenceIntegrityFirstPass.total ? 'measured' : 'proxy',
      d.referenceIntegrityFirstPass.total ? 'References that resolved in the model first answer.' : 'Share of built apps that pass the validator.'),
    row('Hallucinated components', d.hallucinatedComponents, d.hallucinatedComponents.total ? 'proxy' : 'not measured', d.hallucinatedComponents.total ? 'Advanced components nobody asked for. Lower is better.' : spec),
    row('Repair success', d.repairSuccess, d.repairSuccess ? 'measured' : 'not measured', d.repairSuccess ? 'Invalid first answers the repair pass fixed.' : live),
    row('Compilation latency', d.latency.cloudMedianMs, d.latency.cloudMedianMs === null ? 'not measured' : 'measured',
      d.latency.cloudMedianMs === null ? live : 'Median milliseconds from request to result (cloud compiles).'),
    row('User correction rate', d.scoredByHuman ? d.correctionProxy : null, d.scoredByHuman ? 'reviewer' : 'not measured',
      d.scoredByHuman ? 'Apps scored partly or wrong, which would need fixing by hand. Real use is not measured.' : person),
  ];
}

// ─── Plain-text summary ─────────────────────────────────────────────────────────────────────
const pc = (r: Rate | null): string =>
  r === null || r.rate === null ? 'n/a' : `${(r.rate * 100).toFixed(0)}% (${r.correct}/${r.total})`;

export function formatFinal(f: FinalReport): string {
  const L: string[] = [];
  L.push(
    `Final scores for run ${f.basedOn.evaluationId} (dataset ${f.basedOn.datasetVersion}, ${f.basedOn.promptVersion})`,
  );
  L.push(`Scored ${f.scoredAt}${f.reviewer ? ` by ${f.reviewer}` : ''}.`);
  for (const [name, d] of Object.entries(f.datasets) as Array<
    [Dataset, NonNullable<FinalReport['datasets'][Dataset]>]
  >) {
    L.push('', `[${name}] ${d.cases} cases, ${d.built} built, ${d.notBuilt} not built`);
    L.push(
      `  person scored ${d.scoredByHuman}: correct ${d.distribution.correct}, partly ${d.distribution.partly}, wrong ${d.distribution.wrong}`,
    );
    if (d.scoredByHuman) {
      L.push(
        `  semantic accuracy (correct) ${pc(d.semanticAccuracy)}, usable (correct or partly) ${pc(d.usable)}, needs fixing by hand ${pc(d.correctionProxy)}`,
      );
    }
    if (d.firstPassValidity)
      L.push(
        `  first-pass validity ${pc(d.firstPassValidity)}, after repair ${pc(d.postRepairValidity)}, repair success ${pc(d.repairSuccess)}`,
      );
    L.push(
      `  reference integrity ${pc(d.referenceIntegrity)}, component recall ${pc(d.componentRecall)}, field accuracy ${pc(d.fieldAccuracy)}, all automatic checks pass ${pc(d.allChecksPass)}`,
    );
    const lat = d.latency;
    const msOrNa = (n: number | null): string => (n === null ? 'n/a' : `${n} ms`);
    L.push(
      `  latency: template median ${msOrNa(lat.templateMedianMs)}, cloud median ${msOrNa(lat.cloudMedianMs)}, cloud p95 ${msOrNa(lat.cloudP95Ms)}`,
    );
    L.push('  compiler metrics (docs/13 §6.6):');
    for (const m of compilerMetricTable(d)) {
      const v = m.value === null ? 'n/a' : typeof m.value === 'number' ? `${m.value} ms` : pc(m.value);
      L.push(`    ${m.metric}: ${v} (${m.basis})`);
    }
    if (d.notScored.length) L.push(`  built but not scored yet: ${d.notScored.join(', ')}`);
  }
  if (f.agreement) {
    const a = f.agreement;
    L.push(
      '',
      `AI pre-score against the person (${a.compared} cases): agreed ${pc(a.agreed)}, AI too generous ${a.aiTooGenerous}, AI too harsh ${a.aiTooHarsh}`,
    );
    L.push(
      `  flagged "may disagree": ${a.flagged.disagreed} of ${a.flagged.cases} really differed. Not flagged: ${a.unflagged.disagreed} of ${a.unflagged.cases} differed.`,
    );
  }
  L.push('', 'Not measured:');
  for (const n of f.notMeasured) L.push(`  - ${n.metric}: ${n.reason}`);
  L.push('', 'Notes:');
  for (const c of f.caveats) L.push(`  - ${c}`);
  return L.join('\n');
}
