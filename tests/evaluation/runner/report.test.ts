import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLDS,
  HUMAN_RUBRIC,
  buildReport,
  evaluateGate,
  scenarioStatuses,
  summarizeDataset,
  summarizeHumanReview,
  summarizeHybrid,
} from './metrics';
import { makeResult } from './test-helpers';
import type { CaseResult } from './types';

const report = (results: CaseResult[], over: Partial<Parameters<typeof buildReport>[0]> = {}) =>
  buildReport({
    mode: 'deterministic',
    datasetVersion: '1',
    platform: 'x',
    promptVersion: 'x',
    datasetHash: 'x',
    cloudCalls: 0,
    createdAt: new Date(0),
    results,
    ...over,
  });

describe('summarizeHybrid', () => {
  it('counts events by the source the orchestrator reported, with latency and success', () => {
    const h = summarizeHybrid(
      [
        { route: 'cloud', source: 'cloud', success: true, latencyMs: 1200 },
        { route: 'cloud', source: 'cloud', success: false, latencyMs: 300 },
        { route: 'template', success: true, latencyMs: 4 },
      ],
      { onDeviceAvailable: false },
    );
    expect(h.events).toBe(3);
    expect(h.modelCalls).toBe(2);
    expect(h.bySource.cloud).toMatchObject({ count: 2, success: 1, medianMs: 750 });
    expect(h.bySource.deterministic).toMatchObject({ count: 1, success: 1 });
    expect(h.sourceViolations).toEqual([]);
  });

  it('flags an on-device claim on a platform with no on-device model, and a cloud route reported as on-device', () => {
    const h = summarizeHybrid([{ route: 'cloud', source: 'on_device', success: true }], { onDeviceAvailable: false });
    expect(h.sourceViolations).toHaveLength(2);
    expect(h.sourceViolations[0]).toMatch(/no on-device model/);
    expect(
      summarizeHybrid([{ route: 'on_device', source: 'on_device', success: true }], { onDeviceAvailable: true })
        .sourceViolations,
    ).toEqual([]);
  });

  it('handles no events', () => {
    expect(summarizeHybrid([], { onDeviceAvailable: false })).toEqual({
      events: 0,
      modelCalls: 0,
      bySource: {},
      sourceViolations: [],
    });
  });
});

describe('scenarioStatuses', () => {
  const none = summarizeHybrid([], { onDeviceAvailable: false });

  it('never claims a scenario that did not run', () => {
    const s = scenarioStatuses('deterministic', [makeResult({ id: 'a' })], none);
    expect(s.map((x) => `${x.id}:${x.status}`)).toEqual([
      'A:not_run',
      'B:not_run',
      'C:not_run',
      'D:not_run',
      'E:not_run',
    ]);
    expect(s.find((x) => x.id === 'A')?.evidence).toMatch(/Gemini Nano/);
    expect(s.find((x) => x.id === 'C')?.evidence).toMatch(/Mocks do not prove real local inference/);
  });

  it('marks E as run when cloud-route requests were checked offline', () => {
    const r = makeResult({ id: 'c', offline: { graceful: true, message: 'You are offline.' } });
    const e = scenarioStatuses('deterministic', [r], none).find((x) => x.id === 'E');
    expect(e?.status).toBe('exercised');
    expect(e?.evidence).toMatch(/1 of 1/);
  });

  it('marks B as run only after a real cloud compile succeeded in live mode', () => {
    const cloud = makeResult({
      id: 'l',
      build: { stage: 'cloud', ok: true, valid: true, describeOk: true, errors: [], warnings: 0 },
    });
    expect(scenarioStatuses('live', [cloud], none).find((x) => x.id === 'B')?.status).toBe('exercised');
    expect(scenarioStatuses('deterministic', [cloud], none).find((x) => x.id === 'B')?.status).toBe('not_run');
    expect(scenarioStatuses('live', [makeResult({ id: 'x' })], none).find((x) => x.id === 'B')?.status).toBe('not_run');
  });
});

describe('human review', () => {
  const results = [
    makeResult({ id: 'a' }),
    makeResult({ id: 'b', review: 'human_reviewed' }),
    makeResult({ id: 'c', dataset: 'image', needsAssets: 'A photo of a paper sketch.' }),
  ];

  it('lists who still needs a person, who was reviewed and what asset is missing', () => {
    const h = summarizeHumanReview(results, { required: 25, present: 0, note: 'n' });
    expect(h.pending).toEqual(['a', 'c']);
    expect(h.reviewed).toEqual(['b']);
    expect(h.needsAssets).toEqual([{ id: 'c', asset: 'A photo of a paper sketch.' }]);
    expect(h.handDrawnPhotos).toEqual({ required: 25, present: 0, note: 'n' });
    expect(h.rubric).toEqual([...HUMAN_RUBRIC]);
    expect(h.rubric).toHaveLength(10);
    expect(h.scale).toMatch(/0 = wrong, 1 = partly right, 2 = right/);
  });

  it('counts review state per dataset', () => {
    expect(summarizeDataset(results, 'text').review).toEqual({ pending: 1, reviewed: 1, needsAssets: 0 });
    expect(summarizeDataset(results, 'image').review).toEqual({ pending: 1, reviewed: 0, needsAssets: 1 });
  });

  it('adds a note to the report when sketches are unreviewed', () => {
    const r = report([
      makeResult({ id: 's', dataset: 'sketch' }),
      makeResult({ id: 's2', dataset: 'sketch', review: 'human_reviewed' }),
    ]);
    expect(r.notes.join(' ')).toMatch(/1 golden sketch\(es\) have machine-authored expectations/);
    expect(report([makeResult({ id: 's', dataset: 'sketch', review: 'human_reviewed' })]).notes.join(' ')).not.toMatch(
      /machine-authored/,
    );
  });
});

describe('report additions', () => {
  it('counts failed checks per stage so a failure is attributable', () => {
    const r = report([
      makeResult({ id: 'a', failures: ['classifier.complexity: x', 'classifier.route: y', 'build (template): z'] }),
      makeResult({
        id: 'b',
        failures: ['extraction.labels missing: q', 'semantic.fields missing: f', 'runtime: boom', 'offline: nope'],
      }),
    ]);
    expect(r.failuresByStage).toEqual({ classifier: 2, build: 1, extraction: 1, semantic: 1, runtime: 1, offline: 1 });
  });

  it('carries the hybrid summary and scenarios', () => {
    const r = report([makeResult({ id: 'a' })], { events: [{ route: 'template', success: true, latencyMs: 3 }] });
    expect(r.hybrid).toMatchObject({ events: 1, modelCalls: 0 });
    expect(r.scenarios).toHaveLength(5);
  });

  it('rates offline handling and the runtime smoke check per dataset', () => {
    const rs = [
      makeResult({ id: 'a', offline: { graceful: true }, runtime: { ok: true, evaluated: 3, failed: [] } }),
      makeResult({ id: 'b', offline: { graceful: false }, runtime: { ok: false, evaluated: 3, failed: ['x'] } }),
    ];
    const m = summarizeDataset(rs, 'text');
    expect(m.build.cloudRequired.offlineGraceful).toEqual({ correct: 1, total: 2, rate: 0.5 });
    expect(m.runtime).toEqual({ correct: 1, total: 2, rate: 0.5 });
  });
});

describe('evaluateGate for the new floors', () => {
  it('fails on ungraceful offline handling, a failing runtime smoke and a wrong inference source', () => {
    const g = evaluateGate(
      report(
        [makeResult({ id: 'a', offline: { graceful: false }, runtime: { ok: false, evaluated: 1, failed: ['x'] } })],
        {
          events: [{ route: 'cloud', source: 'on_device', success: true }],
        },
      ),
    );
    expect(g.pass).toBe(false);
    const text = g.reasons.join('\n');
    expect(text).toMatch(/text offline failure handling 0\.0%/);
    expect(text).toMatch(/text runtime smoke 0\.0%/);
    expect(text).toMatch(/inference source reported wrongly/);
  });

  it('checks route accuracy for each modality set against its own floor', () => {
    const wrong = {
      complexity: { ok: true },
      taskType: { ok: true },
      route: { ok: false, expected: 'cloud', actual: 'template' },
      multimodal: { ok: true },
    };
    const g = evaluateGate(report([makeResult({ id: 'v', dataset: 'video', checks: wrong })]));
    expect(g.reasons.join('\n')).toMatch(/video route accuracy 0\.0% \(0\/1\) is below 85%/);
    expect(
      evaluateGate(report([makeResult({ id: 'v', dataset: 'video', checks: wrong })]), {
        ...DEFAULT_THRESHOLDS,
        modalityRoute: 0,
      }).pass,
    ).toBe(true);
  });
});
