import { describe, expect, it } from 'vitest';
import { buildReport } from './metrics';
import { ScoresError, formatFinal, indexScores, mergeScores } from './scores';
import { makeResult } from './test-helpers';
import type { CaseResult, EvalReport, HumanScoresFile } from './types';

const detail = (fail = false): CaseResult['detail'] => ({
  title: 't',
  tags: [],
  input: { kind: 'text', text: 'x' },
  expected: {
    complexity: 'simple',
    taskType: 'create_app',
    route: 'template',
    minScreens: 1,
    minCollections: 0,
    requiredFields: [],
    requiredComponents: [],
  },
  spec: {} as never,
  formulas: [],
  checks: [{ id: 'a', label: 'a', status: fail ? 'fail' : 'pass' }],
});

const cloud = (id: string, over: Partial<CaseResult> = {}): CaseResult =>
  makeResult({
    id,
    classification: {
      complexity: 'medium',
      taskType: 'create_app',
      route: 'cloud',
      confidence: 0.8,
      multimodal: false,
      requiresCloud: true,
      method: 'deterministic',
    },
    build: {
      stage: 'cloud',
      ok: true,
      valid: true,
      describeOk: true,
      route: 'cloud+repair',
      firstPassValid: false,
      errors: [],
      warnings: 0,
    },
    latencyMs: { classify: 1, build: 20_000, total: 20_001 },
    detail: detail(),
    ...over,
  });

function report(): EvalReport {
  const results: CaseResult[] = [
    makeResult({ id: 'a', detail: detail() }),
    makeResult({ id: 'b', detail: detail(true) }),
    cloud('c', {
      build: {
        stage: 'cloud',
        ok: true,
        valid: true,
        describeOk: true,
        route: 'cloud',
        firstPassValid: true,
        errors: [],
        warnings: 0,
      },
    }),
    cloud('d'),
    makeResult({
      id: 'e',
      build: {
        stage: 'skipped',
        skippedReason: 'needs a photo',
        ok: false,
        valid: false,
        describeOk: false,
        errors: [],
        warnings: 0,
      },
    }),
  ];
  // AI pre-scores and the disagreement flag, as scripts/eval-judge.mjs would add them
  results[0]!.aiPreScore = { score: 'correct', reasons: ['ok'], confidence: 0.9 };
  results[0]!.mayDisagree = { flag: false, reasons: [] };
  results[1]!.aiPreScore = { score: 'correct', reasons: ['ok'], confidence: 0.55 };
  results[1]!.mayDisagree = { flag: true, reasons: ['unsure'] };
  results[2]!.aiPreScore = { score: 'partly', reasons: ['x'], confidence: 0.8 };
  results[2]!.mayDisagree = { flag: false, reasons: [] };
  return buildReport({
    mode: 'live',
    datasetVersion: '1.1.0',
    results,
    platform: 'test',
    promptVersion: 'p',
    datasetHash: 'h',
    cloudCalls: 2,
    createdAt: new Date('2026-11-25T00:00:00Z'),
  });
}

const file = (
  r: EvalReport,
  scores: HumanScoresFile['scores'],
  over: Partial<HumanScoresFile> = {},
): HumanScoresFile => ({
  schema: 'kalam-human-scores/1',
  evaluationId: r.evaluationId,
  exportedAt: '2026-11-25T01:00:00Z',
  scores,
  ...over,
});

describe('indexScores', () => {
  it('refuses scores made for another run, another schema, or unknown cases', () => {
    const r = report();
    expect(() => indexScores(r, file(r, [], { evaluationId: 'eval-other' }))).toThrow(ScoresError);
    expect(() => indexScores(r, file(r, [], { schema: 'x' as never }))).toThrow(/not a Kalam scores file/);
    expect(() => indexScores(r, file(r, [{ id: 'nope', score: 'correct' }]))).toThrow(/not in the report/);
    expect(() => indexScores(r, file(r, [{ id: 'a', score: 'great' as never }]))).toThrow(/unknown score/);
  });
});

describe('mergeScores', () => {
  const r = report();
  const final = mergeScores(
    r,
    file(r, [
      { id: 'a', score: 'correct' },
      { id: 'b', score: 'wrong', note: 'no fields' },
      { id: 'c', score: 'partly' },
    ]),
  );

  it('computes human accuracy over built apps only, never counting the AI as a person', () => {
    const t = final.datasets.text!;
    expect(t.cases).toBe(5);
    expect(t.built).toBe(4);
    expect(t.notBuilt).toBe(1);
    expect(t.distribution).toEqual({ correct: 1, partly: 1, wrong: 1 });
    expect(t.semanticAccuracy).toMatchObject({ correct: 1, total: 3 });
    expect(t.usable).toMatchObject({ correct: 2, total: 3 });
    expect(t.correctionProxy).toMatchObject({ correct: 2, total: 3 });
    expect(t.notScored).toEqual(['d']);
  });

  it('reports first-pass and post-repair validity separately from the human score', () => {
    const t = final.datasets.text!;
    expect(t.firstPassValidity).toMatchObject({ correct: 1, total: 2 });
    expect(t.postRepairValidity).toMatchObject({ correct: 2, total: 2 });
    expect(t.repairSuccess).toMatchObject({ correct: 1, total: 1 });
    expect(t.referenceIntegrity).toMatchObject({ correct: 4, total: 4 });
  });

  it('measures how well the AI pre-score and the "may disagree" flag matched the person', () => {
    const a = final.agreement!;
    expect(a.compared).toBe(3);
    expect(a.agreed).toMatchObject({ correct: 2, total: 3 });
    expect(a.aiTooGenerous).toBe(1);
    expect(a.matrix.correct.wrong).toBe(1);
    expect(a.flagged).toEqual({ cases: 1, disagreed: 1 });
    expect(a.unflagged).toEqual({ cases: 2, disagreed: 0 });
  });

  it('says plainly what was not measured and prints without em dashes', () => {
    expect(final.notMeasured.map((n) => n.metric)).toEqual(
      expect.arrayContaining([
        'Component precision, exact',
        'Action accuracy, exact',
        'User correction rate from real use',
      ]),
    );
    const text = formatFinal(final);
    expect(text).toContain('semantic accuracy');
    expect(text).not.toMatch(/[—–]/);
  });
});
