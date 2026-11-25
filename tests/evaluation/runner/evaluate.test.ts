import { describe, expect, it, vi } from 'vitest';
import { classifyRequest } from '@/core/classifier';
import type {
  CreateApplication,
  CreationResult,
  DrawingDocument,
  NormalizedInput,
  TaskClassification,
} from '@/core/contracts';
import { createApplicationPipeline } from '@/core/pipeline/create-application';
import { describeSpec } from '@/core/spec/describe';
import { validateSpec } from '@/core/spec/validate';
import { getTemplate } from '@/core/templates';
import { summarizeDrawing } from '@/features/drawing/model/summarize';
import {
  PLACEHOLDER_PNG,
  evaluateModalityCase,
  evaluateSketchCase,
  evaluateTextCase,
  modalityCaseInput,
  sketchCaseInput,
  textCaseInput,
  type EvalDeps,
} from './evaluate';
import { evaluateGate, buildReport } from './metrics';
import { createOfflineAI } from './offline-ai';
import { runtimeSmoke } from './runtime-smoke';
import { loadGolden } from './test-helpers';
import type { GoldenModalityCase, GoldenSketchCase, GoldenTextCase } from './types';

const golden = loadGolden();
const textCase = (id: string): GoldenTextCase => {
  const c = golden.text.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
const modalityCase = (id: string): GoldenModalityCase => {
  const c = golden.modalities.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
const sketchCase = (id: string): GoldenSketchCase => {
  const c = golden.sketches.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};

function counterSpec() {
  const t = getTemplate('counter');
  if (!t) throw new Error('counter template');
  return t.build(t.defaults as never, { appId: 'app_eval_test', now: 0, lang: 'en' });
}

const cls = (over: Partial<TaskClassification> = {}): TaskClassification => ({
  taskType: 'create_app',
  complexity: 'simple',
  estimatedScreens: 1,
  estimatedCollections: 0,
  estimatedActions: 0,
  requiresMultimodalReasoning: false,
  requiresCloudReasoning: false,
  confidence: 0.9,
  method: 'deterministic',
  reasons: [],
  ...over,
});

/** Fake dependencies, so these tests exercise the runner logic alone. */
function fakeDeps(over: Partial<EvalDeps> = {}): EvalDeps & { created: NormalizedInput[] } {
  const created: NormalizedInput[] = [];
  let clock = 0;
  const createApplication: CreateApplication = async (input) => {
    created.push(input);
    const spec = counterSpec();
    const res: CreationResult = {
      ok: true,
      spec,
      classification: cls(),
      route: 'template',
      provider: 'deterministic',
      warnings: [],
      errors: [],
      latencyMs: 1,
    };
    return res;
  };
  return {
    created,
    classify: () => cls({ matchingTemplate: 'counter' }),
    createApplication,
    validate: validateSpec,
    describe: describeSpec,
    summarizeDrawing: (doc: DrawingDocument) => summarizeDrawing(doc),
    now: () => (clock += 2),
    ...over,
  };
}

describe('evaluateTextCase', () => {
  it('builds the template route through the pipeline, validates and describes the spec', async () => {
    const deps = fakeDeps();
    const r = await evaluateTextCase(textCase('t02-counter-shop-visitors'), deps, { mode: 'deterministic' });
    expect(deps.created).toHaveLength(1);
    expect(r.build).toMatchObject({
      stage: 'template',
      ok: true,
      valid: true,
      describeOk: true,
      route: 'template',
      provider: 'deterministic',
    });
    expect(r.semantic?.components.found).toBe(1);
    expect(r.failures).toEqual([]);
    expect(r.latencyMs.total).toBeGreaterThan(0);
  });

  const offlineFailure =
    (message?: string): CreateApplication =>
    async () => ({
      ok: false,
      classification: cls(),
      route: 'cloud',
      provider: 'none',
      warnings: [],
      errors: [],
      latencyMs: 1,
      ...(message ? { message } : {}),
    });
  const cloudClassification = () => cls({ complexity: 'complex', requiresCloudReasoning: true });

  it('does not compile cloud-route requests in deterministic mode, and checks they fail gracefully offline', async () => {
    const plain = "You're offline. Kalam needs its cloud model to build this app. Your description is kept.";
    const deps = fakeDeps({ classify: cloudClassification, createApplication: offlineFailure(plain) });
    const r = await evaluateTextCase(textCase('t21-school-management-system'), deps, { mode: 'deterministic' });
    expect(r.build.stage).toBe('skipped');
    expect(r.build.skippedReason).toMatch(/cloud/i);
    expect(r.semantic).toBeUndefined();
    expect(r.offline).toEqual({ graceful: true, message: plain });
    expect(r.failures).toEqual([]);
  });

  it('fails a cloud-route request that leaks a raw error code, a stack, an app or no message offline', async () => {
    for (const make of [
      offlineFailure('model_unavailable'),
      offlineFailure('TypeError: x is undefined at run (file.ts:10:5)'),
      offlineFailure(undefined),
      async () => ({
        ok: true,
        spec: counterSpec(),
        classification: cls(),
        route: 'template' as const,
        provider: 'deterministic' as const,
        warnings: [],
        errors: [],
        latencyMs: 1,
      }),
    ]) {
      const deps = fakeDeps({ classify: cloudClassification, createApplication: make });
      const r = await evaluateTextCase(textCase('t21-school-management-system'), deps, { mode: 'deterministic' });
      expect(r.offline?.graceful).toBe(false);
      expect(r.failures.join(' ')).toMatch(/offline: the pipeline did not fail gracefully/);
    }
  });

  it('runs the runtime smoke check on a built app and records a failure', async () => {
    const ok = await evaluateTextCase(
      textCase('t02-counter-shop-visitors'),
      fakeDeps({ runtimeSmoke: () => ({ ok: true, evaluated: 2, failed: [] }) }),
      { mode: 'deterministic' },
    );
    expect(ok.runtime).toEqual({ ok: true, evaluated: 2, failed: [] });
    const bad = await evaluateTextCase(
      textCase('t02-counter-shop-visitors'),
      fakeDeps({
        runtimeSmoke: () => ({ ok: false, evaluated: 1, failed: ['home.total on empty data: Unknown name'] }),
      }),
      { mode: 'deterministic' },
    );
    expect(bad.failures.join(' ')).toMatch(/runtime: home\.total on empty data/);
  });

  it('carries the review state and the real asset a case still needs', async () => {
    const r = await evaluateTextCase(textCase('t02-counter-shop-visitors'), fakeDeps(), { mode: 'deterministic' });
    expect(r.review).toBe('needs_human_review');
    expect(r).not.toHaveProperty('needsAssets');
    const visual = cls({
      complexity: 'medium',
      taskType: 'interpret_sketch',
      requiresCloudReasoning: true,
      requiresMultimodalReasoning: true,
    });
    const m = await evaluateModalityCase(
      modalityCase('mi01-photo-tailor-sketch'),
      golden.sketches,
      fakeDeps({
        classify: () => visual,
        createApplication: offlineFailure('You are offline, so this cannot be built yet.'),
      }),
      { mode: 'deterministic' },
    );
    expect(m.needsAssets).toMatch(/photo/i);
  });

  it('lists a misclassification as a failure naming the stage', async () => {
    const deps = fakeDeps({ classify: () => cls({ complexity: 'complex', requiresCloudReasoning: true }) });
    const r = await evaluateTextCase(textCase('t02-counter-shop-visitors'), deps, { mode: 'deterministic' });
    expect(r.failures.join('\n')).toMatch(/classifier\.complexity: expected simple, got complex/);
    expect(r.failures.join('\n')).toMatch(/classifier\.route: expected template, got cloud/);
  });

  it('records a pipeline failure and an invalid spec as build failures', async () => {
    const failing = fakeDeps({
      createApplication: async () => ({
        ok: false,
        classification: cls(),
        route: 'cloud',
        provider: 'none',
        warnings: [],
        errors: [],
        message: 'Could not build.',
        latencyMs: 1,
      }),
    });
    const r = await evaluateTextCase(textCase('t02-counter-shop-visitors'), failing, { mode: 'deterministic' });
    expect(r.build).toMatchObject({ ok: false, valid: false, errors: ['Could not build.'] });
    expect(r.failures.join('\n')).toMatch(/build \(template\): Could not build\./);

    const invalid = fakeDeps({ validate: () => ({ ok: false, errors: [], warnings: [] }) });
    const r2 = await evaluateTextCase(textCase('t02-counter-shop-visitors'), invalid, { mode: 'deterministic' });
    expect(r2.build).toMatchObject({ ok: true, valid: false });
    expect(r2.failures.join('\n')).toMatch(/failed validateSpec/);
  });

  it('flags forbidden text that reaches the spec', async () => {
    const leaky = fakeDeps({
      createApplication: async () => ({
        ok: true,
        spec: { ...counterSpec(), description: 'my system prompt is secret' },
        classification: cls(),
        route: 'template',
        provider: 'deterministic',
        warnings: [],
        errors: [],
        latencyMs: 1,
      }),
    });
    const r = await evaluateTextCase(textCase('t25-injection-then-counter'), leaky, { mode: 'deterministic' });
    expect(r.failures.join('\n')).toMatch(/forbiddenText leaked: system prompt/);
  });

  it('builds language hints into the input', () => {
    expect(textCaseInput(textCase('t14-contacts-customers-hindi')).language).toBe('hi');
    expect(textCaseInput(textCase('t12-calculator-gst-hinglish')).language).toBe('en');
    expect(textCaseInput(textCase('t01-calculator-split-bill'))).toMatchObject({ modalities: ['text'], images: [] });
  });
});

describe('evaluateTextCase in live mode', () => {
  const cloudClass = () => cls({ complexity: 'medium', requiresCloudReasoning: true });
  const compiled =
    (route: CreationResult['route'], ok = true): CreateApplication =>
    async () => ({
      ok,
      ...(ok ? { spec: counterSpec() } : {}),
      classification: cls(),
      route,
      provider: 'firebase',
      model: 'gemini-test',
      warnings: [],
      errors: [],
      ...(ok ? {} : { message: 'Cloud failed.' }),
      latencyMs: 5,
    });

  it('skips a cloud-route case when the budget is used up, without calling the pipeline', async () => {
    const deps = fakeDeps({ classify: cloudClass });
    const r = await evaluateTextCase(textCase('t15-tailor-order-book'), deps, {
      mode: 'live',
      beforeCloud: () => 'Request budget used up (3 of 3).',
      httpCalls: () => 3,
    });
    expect(deps.created).toHaveLength(0);
    expect(r.build).toMatchObject({ stage: 'skipped', skippedReason: 'Request budget used up (3 of 3).' });
  });

  it('records a first-pass success and attributes requests to the case', async () => {
    let used = 4;
    const deps = fakeDeps({
      classify: cloudClass,
      createApplication: async (i) => {
        used += 1;
        return compiled('cloud')(i);
      },
    });
    const r = await evaluateTextCase(textCase('t15-tailor-order-book'), deps, { mode: 'live', httpCalls: () => used });
    expect(r.build).toMatchObject({
      stage: 'cloud',
      ok: true,
      firstPassValid: true,
      httpCalls: 1,
      model: 'gemini-test',
      provider: 'firebase',
    });
  });

  it('records that the repair pass was needed, and a failed compile', async () => {
    const repaired = fakeDeps({ classify: cloudClass, createApplication: compiled('cloud+repair') });
    const r = await evaluateTextCase(textCase('t15-tailor-order-book'), repaired, { mode: 'live' });
    expect(r.build).toMatchObject({ stage: 'cloud', ok: true, firstPassValid: false, route: 'cloud+repair' });

    const failed = fakeDeps({ classify: cloudClass, createApplication: compiled('cloud', false) });
    const r2 = await evaluateTextCase(textCase('t15-tailor-order-book'), failed, { mode: 'live' });
    expect(r2.build).toMatchObject({ ok: false, firstPassValid: false });
    expect(r2.failures.join('\n')).toMatch(/build \(cloud\): Cloud failed\./);
  });

  it('never spends a request on a request that is too vague to build', async () => {
    const create = vi.fn();
    const deps = fakeDeps({ classify: () => cls({ confidence: 0.3 }), createApplication: create });
    const r = await evaluateTextCase(textCase('t24-vague-make-an-app'), deps, {
      mode: 'live',
      beforeCloud: () => undefined,
    });
    expect(create).not.toHaveBeenCalled();
    expect(r.build.stage).toBe('skipped');
    expect(r.build.skippedReason).toMatch(/vague/i);
  });
});

describe('evaluateSketchCase', () => {
  it('summarises the drawing, checks extraction and keeps the cloud compile out of deterministic mode', async () => {
    const deps = fakeDeps({ classify: classifyRequest });
    const r = await evaluateSketchCase(sketchCase('s07-kirana-credit-book'), deps, { mode: 'deterministic' });
    expect(r.dataset).toBe('sketch');
    expect(r.extraction?.labels).toMatchObject({ found: 14, total: 14 });
    expect(r.extraction?.stamps.missing).toEqual([]);
    expect(r.classification).toMatchObject({
      taskType: 'interpret_sketch',
      route: 'cloud',
      multimodal: true,
      requiresCloud: true,
    });
    expect(r.build.stage).toBe('skipped');
    expect(r.build.skippedReason).toMatch(/cloud/i);
  });

  it('hands the compiler the drawing summary and no raster image', () => {
    const summary = summarizeDrawing({ id: 'd', title: 't', createdAt: 0, updatedAt: 0, pages: [] });
    expect(sketchCaseInput(summary)).toEqual({
      text: '',
      modalities: ['drawing'],
      images: [],
      drawing: summary,
      language: 'en',
    });
  });
});

describe('modality cases', () => {
  const sketchSummary = () => summarizeDrawing({ id: 'd', title: 't', createdAt: 0, updatedAt: 0, pages: [] });

  it('builds placeholder photos, frames and transcripts into the normalised input', () => {
    const photo = modalityCaseInput(modalityCase('mi03-two-photos-registration-form'));
    expect(photo.modalities).toEqual(['text', 'image']);
    expect(photo.images).toHaveLength(2);
    expect(photo.images.every((i) => i.source === 'photo' && i.base64 === PLACEHOLDER_PNG)).toBe(true);

    const video = modalityCaseInput(modalityCase('mv02-video-inventory-walkthrough'));
    expect(video.modalities).toEqual(['video']);
    expect(video.video?.frames).toHaveLength(8);
    expect(video.video?.frames.every((f) => f.source === 'video_frame')).toBe(true);
    expect(video.video?.summary).toMatch(/stock app/);

    const voice = modalityCaseInput(modalityCase('ma05-voice-text-together'));
    expect(voice).toMatchObject({
      text: 'Call it Daily Walk',
      modalities: ['text', 'audio'],
      audioTranscript: expect.stringMatching(/habit tracker/),
    });

    const mixed = modalityCaseInput(modalityCase('mx02-sketch-expenses-plus-voice'), sketchSummary());
    expect(mixed.modalities).toEqual(['audio', 'drawing']);
    expect(mixed.drawing).toBeDefined();
  });

  it('never puts raw audio into the input and keeps the placeholder a valid PNG', () => {
    for (const c of golden.modalities) expect(JSON.stringify(modalityCaseInput(c))).not.toMatch(/audioUri|\.m4a|\.wav/);
    expect(Buffer.from(PLACEHOLDER_PNG, 'base64').subarray(1, 4).toString('latin1')).toBe('PNG');
  });

  it('skips a case that needs a real asset in live mode, without spending a request', async () => {
    const create = vi.fn();
    const visual = cls({
      complexity: 'medium',
      requiresCloudReasoning: true,
      requiresMultimodalReasoning: true,
      taskType: 'interpret_sketch',
    });
    const deps = fakeDeps({ classify: () => visual, createApplication: create });
    const r = await evaluateModalityCase(modalityCase('mi01-photo-tailor-sketch'), golden.sketches, deps, {
      mode: 'live',
      beforeCloud: () => undefined,
    });
    expect(create).not.toHaveBeenCalled();
    expect(r.build.skippedReason).toMatch(/real asset/);
    expect(r.dataset).toBe('image');
  });

  it('builds a template app from a voice transcript, and rejects an unknown sketch', async () => {
    const deps = fakeDeps({ classify: classifyRequest });
    const r = await evaluateModalityCase(modalityCase('ma01-voice-counter-hinglish'), golden.sketches, deps, {
      mode: 'deterministic',
    });
    expect(r.dataset).toBe('audio');
    expect(r.classification.route).toBe('template');
    expect(deps.created).toHaveLength(1);
    expect(() =>
      evaluateModalityCase(
        { ...modalityCase('mx01-sketch-list-plus-text'), sketch: 'nope' },
        golden.sketches,
        fakeDeps(),
        { mode: 'deterministic' },
      ),
    ).toThrow(/unknown sketch "nope"/);
  });
});

describe('golden set against the real modules (deterministic, offline)', () => {
  const ai = createOfflineAI();
  const deps: EvalDeps = {
    classify: classifyRequest,
    createApplication: createApplicationPipeline({ ai, specialistConsent: () => false }),
    validate: validateSpec,
    describe: describeSpec,
    summarizeDrawing,
    runtimeSmoke,
    now: () => performance.now(),
  };

  it('builds every template-route request without a model and meets the quality floors', async () => {
    const results = [
      ...(await Promise.all(golden.text.map((c) => evaluateTextCase(c, deps, { mode: 'deterministic' })))),
      ...(await Promise.all(golden.sketches.map((c) => evaluateSketchCase(c, deps, { mode: 'deterministic' })))),
      ...(await Promise.all(
        golden.modalities.map((c) => evaluateModalityCase(c, golden.sketches, deps, { mode: 'deterministic' })),
      )),
    ];
    const report = buildReport({
      mode: 'deterministic',
      datasetVersion: golden.meta.datasetVersion,
      results,
      platform: 'test',
      promptVersion: 'test',
      datasetHash: 'test',
      cloudCalls: 0,
      createdAt: new Date('2026-11-18T00:00:00Z'),
      events: ai.events(),
      handDrawnPhotos: golden.meta.handDrawnPhotos,
    });
    expect(ai.runCalls()).toBe(0);
    expect(report.totalCases).toBe(75);
    expect(Object.keys(report.datasets).sort()).toEqual(['audio', 'image', 'mixed', 'sketch', 'text', 'video']);
    expect(report.humanReview.pending).toHaveLength(75);
    expect(report.humanReview.reviewed).toEqual([]);
    expect(report.humanReview.handDrawnPhotos).toMatchObject({ required: 25, present: 0 });
    expect(report.hybrid).toMatchObject({ modelCalls: 0, sourceViolations: [] });
    expect(report.scenarios.find((s) => s.id === 'E')?.status).toBe('exercised');
    expect(report.scenarios.find((s) => s.id === 'A')?.status).toBe('not_run');
    expect(report.datasets.text?.runtime.rate).toBe(1);
    expect(report.datasets.text?.build.cloudRequired.offlineGraceful.rate).toBe(1);
    expect(report.datasets.sketch?.build.cloudRequired.offlineGraceful.rate).toBe(1);
    const text = report.datasets.text;
    expect(text?.build.templateRoute.attempted).toBeGreaterThanOrEqual(10);
    expect(text?.build.templateRoute.valid.rate).toBe(1);
    expect(text?.build.templateRoute.described.rate).toBe(1);
    expect(report.datasets.sketch?.extraction?.labels.rate).toBe(1);
    expect(report.cloudCalls).toBe(0);
    const gate = evaluateGate(report);
    expect(gate.reasons).toEqual([]);
    expect(gate.pass).toBe(true);
  });
});
