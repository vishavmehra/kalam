import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, buildReport, evaluateGate, summarizeDataset } from './metrics';
import { makeResult } from './test-helpers';
import type { CaseResult } from './types';

const miss = (expected: string, actual: string) => ({ ok: false, expected, actual });

const cloudResult = (id: string, over: Partial<CaseResult['build']> = {}, fail = false): CaseResult =>
  makeResult({
    id,
    classification: {
      complexity: 'medium',
      taskType: 'create_app',
      route: 'cloud',
      confidence: 0.7,
      multimodal: false,
      requiresCloud: true,
      method: 'deterministic',
    },
    checks: {
      complexity: { ok: true, expected: 'medium', actual: 'medium' },
      taskType: { ok: true },
      route: { ok: true },
      multimodal: { ok: true },
    },
    build: {
      stage: 'cloud',
      ok: !fail,
      valid: !fail,
      describeOk: !fail,
      route: 'cloud',
      provider: 'firebase',
      model: 'gemini-test',
      firstPassValid: !fail,
      errors: [],
      warnings: 0,
      ...over,
    },
    latencyMs: { classify: 1, build: 2000, total: 2001 },
  });

describe('summarizeDataset', () => {
  const results: CaseResult[] = [
    makeResult({ id: 'a' }),
    makeResult({
      id: 'b',
      checks: {
        complexity: miss('simple', 'medium'),
        taskType: { ok: true },
        route: { ok: true },
        multimodal: { ok: true },
      },
    }),
    makeResult({
      id: 'c',
      ambiguous: true,
      checks: {
        complexity: miss('medium', 'complex'),
        taskType: { ok: true },
        route: { ok: true },
        multimodal: { ok: true },
      },
    }),
    makeResult({
      id: 'd',
      build: {
        stage: 'skipped',
        skippedReason: 'cloud',
        ok: false,
        valid: false,
        describeOk: false,
        errors: [],
        warnings: 0,
      },
      classification: {
        complexity: 'complex',
        taskType: 'create_app',
        route: 'cloud',
        confidence: 0.8,
        multimodal: false,
        requiresCloud: true,
        method: 'deterministic',
      },
    }),
    makeResult({ id: 'sk', dataset: 'sketch' }),
  ];
  const m = summarizeDataset(results, 'text');

  it('keeps datasets apart', () => {
    expect(m.cases).toBe(4);
    expect(summarizeDataset(results, 'sketch').cases).toBe(1);
    expect(m.ambiguousCases).toBe(1);
  });

  it('computes complexity accuracy with and without ambiguous cases, plus a confusion matrix', () => {
    expect(m.classifier.complexity).toEqual({ correct: 2, total: 4, rate: 0.5 });
    expect(m.classifier.complexityExcludingAmbiguous).toEqual({ correct: 2, total: 3, rate: 0.667 });
    expect(m.classifier.confusion).toEqual({ simple: { simple: 2, medium: 1 }, medium: { complex: 1 } });
  });

  it('measures template-route validity and cloud-route coverage separately', () => {
    expect(m.build.templateRoute).toMatchObject({ attempted: 3, built: 3 });
    expect(m.build.templateRoute.valid).toEqual({ correct: 3, total: 3, rate: 1 });
    expect(m.build.cloudRequired).toMatchObject({ cases: 1, skipped: 1, attempted: 0 });
    expect(m.build.cloudRequired.offlineGraceful).toEqual({ correct: 0, total: 0, rate: null });
    expect(m.live).toBeUndefined();
  });

  it('only reports optional rates when a case asks for them', () => {
    expect(m.classifier.template).toEqual({ correct: 0, total: 0, rate: null });
    expect(m.classifier.lowConfidence.total).toBe(0);
    expect(m.extraction).toBeUndefined();
  });

  it('adds semantic rates from the apps that were built', () => {
    const semantic = {
      screens: { ok: true },
      collections: { ok: false },
      fields: { found: 1, total: 2, missing: ['x'] },
      components: { found: 2, total: 2, missing: [] },
      forbiddenText: { ok: true },
    };
    const s = summarizeDataset([makeResult({ id: 'a', semantic }), makeResult({ id: 'b' })], 'text').semantic;
    expect(s).toMatchObject({ cases: 1 });
    expect(s.collections).toEqual({ correct: 0, total: 1, rate: 0 });
    expect(s.fields).toEqual({ correct: 1, total: 2, rate: 0.5 });
    expect(s.components.rate).toBe(1);
  });

  it('adds extraction rates for sketches', () => {
    const extraction = {
      pageCount: { ok: true },
      labels: { found: 8, total: 10, missing: ['a', 'b'] },
      stamps: { found: 3, total: 3, missing: [] },
    };
    const s = summarizeDataset([makeResult({ id: 's', dataset: 'sketch', extraction })], 'sketch');
    expect(s.extraction?.labels).toEqual({ correct: 8, total: 10, rate: 0.8 });
    expect(s.extraction?.stamps.rate).toBe(1);
  });

  it('reports live first-pass validity, validity after repair and repair success', () => {
    const live = [
      cloudResult('l1'),
      cloudResult('l2', { firstPassValid: false, route: 'cloud+repair' }),
      cloudResult('l3', { firstPassValid: false, route: 'cloud+repair' }, true),
      cloudResult('l4'),
    ];
    const l = summarizeDataset(live, 'text').live;
    expect(l?.attempted).toBe(4);
    expect(l?.firstPassValid).toEqual({ correct: 2, total: 4, rate: 0.5 });
    expect(l?.validAfterRepair).toEqual({ correct: 3, total: 4, rate: 0.75 });
    expect(l?.repairSuccess).toEqual({ correct: 1, total: 2, rate: 0.5 });
    expect(l?.sources).toEqual({ 'firebase:cloud': 2, 'firebase:cloud+repair': 2 });
  });
});

describe('buildReport', () => {
  const input = {
    datasetVersion: '1.0.0',
    platform: 'node-test',
    promptVersion: 'compiler-prompt@abc',
    datasetHash: 'def',
    createdAt: new Date('2026-11-18T01:02:03.004Z'),
  };

  it('writes a deterministic report with no model calls and no live numbers', () => {
    const r = buildReport({
      ...input,
      mode: 'deterministic',
      cloudCalls: 0,
      results: [makeResult({ id: 'a' }), makeResult({ id: 'sk', dataset: 'sketch' })],
    });
    expect(r).toMatchObject({
      schema: 'kalam-eval-report/1',
      evaluationId: 'eval-2026-11-18T01-02-03-004Z-deterministic',
      mode: 'deterministic',
      inferenceSource: 'deterministic',
      cloudCalls: 0,
      totalCases: 2,
      firstPassValid: null,
      validAfterRepair: null,
      models: [],
    });
    expect(Object.keys(r.datasets).sort()).toEqual(['sketch', 'text']);
    expect(r.notes.join(' ')).toMatch(/no model was called/i);
    expect(r.latency.medianMs).toBe(6);
  });

  it('writes live headline numbers and the models seen', () => {
    const r = buildReport({
      ...input,
      mode: 'live',
      cloudCalls: 3,
      results: [
        cloudResult('l1'),
        cloudResult('l2', { firstPassValid: false, route: 'cloud+repair' }),
        cloudResult('l3', {}, true),
      ],
    });
    expect(r.inferenceSource).toBe('cloud');
    expect(r.cloudCalls).toBe(3);
    expect(r.models).toEqual(['gemini-test']);
    expect(r.firstPassValid).toBe(0.333);
    expect(r.validAfterRepair).toBe(0.667);
    expect(r.latency.p95Ms).toBe(2001);
  });

  it('lists only cases with failures, and carries every case', () => {
    const r = buildReport({
      ...input,
      mode: 'deterministic',
      cloudCalls: 0,
      results: [
        makeResult({ id: 'ok' }),
        makeResult({ id: 'bad', failures: ['classifier.complexity: expected simple, got medium'] }),
      ],
    });
    expect(r.failures).toEqual([
      { id: 'bad', dataset: 'text', reasons: ['classifier.complexity: expected simple, got medium'] },
    ]);
    expect(r.cases).toHaveLength(2);
  });

  it('contains nothing but synthetic evaluation data', () => {
    const json = JSON.stringify(
      buildReport({ ...input, mode: 'deterministic', cloudCalls: 0, results: [makeResult({ id: 'a' })] }),
    );
    expect(json).not.toMatch(/api[_-]?key|token|secret|password/i);
  });
});

describe('evaluateGate', () => {
  const report = (text: CaseResult[], sketch: CaseResult[] = []) =>
    buildReport({
      mode: 'deterministic',
      datasetVersion: '1',
      platform: 'x',
      promptVersion: 'x',
      datasetHash: 'x',
      cloudCalls: 0,
      createdAt: new Date(0),
      results: [...text, ...sketch],
    });

  it('passes when floors are met', () => {
    expect(evaluateGate(report([makeResult({ id: 'a' })]))).toEqual({ pass: true, reasons: [] });
  });

  it('fails when a template-route app is invalid, naming the rate', () => {
    const bad = makeResult({
      id: 'a',
      build: { stage: 'template', ok: true, valid: false, describeOk: true, errors: [], warnings: 0 },
    });
    const g = evaluateGate(report([bad]));
    expect(g.pass).toBe(false);
    expect(g.reasons[0]).toMatch(/template-route validity 0\.0% \(0\/1\) is below 100%/);
  });

  it('fails when text complexity accuracy drops below the floor and respects overrides', () => {
    const wrong = makeResult({
      id: 'w',
      checks: {
        complexity: miss('simple', 'medium'),
        taskType: { ok: true },
        route: { ok: true },
        multimodal: { ok: true },
      },
    });
    const results = [makeResult({ id: 'a' }), wrong];
    const g = evaluateGate(report(results));
    expect(g.pass).toBe(false);
    expect(g.reasons.join('\n')).toMatch(/text complexity accuracy 50\.0%/);
    expect(evaluateGate(report(results), { ...DEFAULT_THRESHOLDS, textComplexity: 0.5 }).pass).toBe(true);
  });

  it('checks sketch route and extraction, and ignores datasets that were not run', () => {
    const sk = makeResult({
      id: 's',
      dataset: 'sketch',
      checks: {
        complexity: { ok: true },
        taskType: { ok: true },
        route: miss('cloud', 'template'),
        multimodal: { ok: true },
      },
      extraction: {
        pageCount: { ok: true },
        labels: { found: 9, total: 10, missing: ['x'] },
        stamps: { found: 1, total: 1, missing: [] },
      },
    });
    const g = evaluateGate(report([], [sk]));
    expect(g.reasons.join('\n')).toMatch(/sketch route accuracy 0\.0%/);
    expect(g.reasons.join('\n')).toMatch(/sketch label extraction 90\.0%/);
    expect(evaluateGate(report([makeResult({ id: 'a' })])).reasons).toEqual([]);
  });
});
