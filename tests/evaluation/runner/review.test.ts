import { describe, expect, it } from 'vitest';
import type { CreateApplication, CreationResult, DrawingDocument, TaskClassification } from '@/core/contracts';
import { describeSpec } from '@/core/spec/describe';
import { validateSpec } from '@/core/spec/validate';
import { getTemplate } from '@/core/templates';
import { summarizeDrawing } from '@/features/drawing/model/summarize';
import { evaluateModalityCase, evaluateSketchCase, evaluateTextCase, type EvalDeps } from './evaluate';
import {
  assessDisagreement,
  buildJudgePrompt,
  formulasOf,
  judgeSchema,
  modalityReviewInput,
  reviewChecks,
  titleOf,
} from './review';
import { runtimeSmoke } from './runtime-smoke';
import { loadGolden } from './test-helpers';
import type { AIPreScore, CaseResult } from './types';

const golden = loadGolden();
const text = (id: string) => golden.text.find((c) => c.id === id)!;

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

function expenseSpec() {
  const t = getTemplate('expense_tracker');
  if (!t) throw new Error('expenses template');
  return validateSpec(t.build(t.defaults as never, { appId: 'app_review_test', now: 0, lang: 'en' })).spec!;
}

function deps(over: Partial<EvalDeps> = {}): EvalDeps {
  const spec = expenseSpec();
  const createApplication: CreateApplication = async () =>
    ({
      ok: true,
      spec,
      classification: cls({ matchingTemplate: 'expense_tracker' }),
      route: 'template',
      provider: 'deterministic',
      understanding: describeSpec(spec),
      warnings: [],
      errors: [],
      latencyMs: 1,
    }) satisfies CreationResult;
  let clock = 0;
  return {
    classify: () => cls({ matchingTemplate: 'expense_tracker' }),
    createApplication,
    validate: validateSpec,
    describe: describeSpec,
    summarizeDrawing: (d: DrawingDocument) => summarizeDrawing(d),
    runtimeSmoke,
    now: () => (clock += 2),
    ...over,
  };
}

describe('case detail capture', () => {
  it('is off unless asked for, so ordinary reports stay small', async () => {
    const r = await evaluateTextCase(text('t05-expenses-categories-rupees'), deps(), { mode: 'deterministic' });
    expect(r.detail).toBeUndefined();
  });

  it('keeps the request, the built app, formulas and the automatic checks', async () => {
    const r = await evaluateTextCase(text('t05-expenses-categories-rupees'), deps(), {
      mode: 'deterministic',
      captureDetail: true,
    });
    const d = r.detail!;
    expect(d.input.text).toMatch(/expenses in rupees/i);
    expect(d.spec?.name).toBeTruthy();
    expect(d.understanding?.screens.length).toBeGreaterThan(0);
    expect(d.formulas.length).toBeGreaterThan(0);
    expect(d.checks.filter((c) => c.status === 'fail')).toEqual([]);
    expect(d.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining(['valid', 'fields', 'components', 'formulas', 'save', 'show', 'reach', 'route']),
    );
    expect(d.notBuilt).toBeUndefined();
  });

  it('explains why nothing was built and keeps the vague-request check', async () => {
    const vague = golden.text.find((c) => c.expected.lowConfidence)!;
    const r = await evaluateTextCase(
      vague,
      deps({ classify: () => cls({ complexity: 'simple', confidence: 0.2, requiresCloudReasoning: true }) }),
      { mode: 'live', captureDetail: true },
    );
    expect(r.detail?.spec).toBeUndefined();
    expect(r.detail?.notBuilt).toMatch(/vague/i);
    expect(r.detail?.checks[0]).toMatchObject({ id: 'vague', status: 'pass' });
  });

  it('carries the sketch layout and the media note for the page', async () => {
    const sketch = golden.sketches[0]!;
    const r = await evaluateSketchCase(sketch, deps(), { mode: 'deterministic', captureDetail: true });
    expect(r.detail?.input.sketch?.pages.length).toBe(sketch.pages.length);
    const media = golden.modalities.find((m) => m.needsAssets)!;
    const m = await evaluateModalityCase(media, golden.sketches, deps(), {
      mode: 'deterministic',
      captureDetail: true,
    });
    expect(m.detail?.input.assetNote).toBe(media.needsAssets);
    expect(modalityReviewInput(media).kind).toBe(media.modality);
  });
});

describe('reviewChecks', () => {
  const ctx = () => ({
    expected: text('t05-expenses-categories-rupees').expected,
    valid: true,
    warnings: [],
    classificationRoute: 'template',
    describeOk: true,
  });

  it('fails when a kind of record can be stored but never added or shown', () => {
    const spec = expenseSpec();
    const broken = {
      ...spec,
      actions: Object.fromEntries(Object.entries(spec.actions).filter(([, a]) => a.type !== 'insert')),
      screens: spec.screens.map((s) => ({ ...s, children: s.children.filter((c) => c.type !== 'list') })),
    };
    const checks = reviewChecks(broken, ctx());
    expect(checks.find((c) => c.id === 'save')?.status).toBe('fail');
    expect(checks.find((c) => c.id === 'show')?.status).toBe('fail');
  });

  it('turns an unreachable-screen warning into a failed check', () => {
    const w = {
      code: 'UNREACHABLE_SCREEN',
      path: 'screens[1]',
      message: 'No button leads to "Extra".',
      severity: 'warning' as const,
      recoverable: true,
    };
    const checks = reviewChecks(expenseSpec(), { ...ctx(), warnings: [w] });
    expect(checks.find((c) => c.id === 'reach')).toMatchObject({ status: 'fail' });
  });

  it('lists formulas so a person can read them', () => {
    expect(formulasOf(expenseSpec()).some((f) => f.expr.includes('sum('))).toBe(true);
  });
});

describe('judge schema and prompt', () => {
  it('accepts a good answer and rejects a bad score, extra keys and no reasons', () => {
    expect(judgeSchema.safeParse({ score: 'partly', reasons: ['Missing the date.'], confidence: 0.6 }).success).toBe(
      true,
    );
    expect(judgeSchema.safeParse({ score: 'maybe', reasons: ['x'], confidence: 0.6 }).success).toBe(false);
    expect(judgeSchema.safeParse({ score: 'wrong', reasons: [], confidence: 0.6 }).success).toBe(false);
    expect(judgeSchema.safeParse({ score: 'wrong', reasons: ['x'], confidence: 1.5 }).success).toBe(false);
    expect(judgeSchema.safeParse({ score: 'wrong', reasons: ['x'], confidence: 0.5, extra: 1 }).success).toBe(false);
  });

  it('puts the request and the app inside untrusted tags, including an injection attempt', async () => {
    const c = text('t25-injection-then-counter');
    const r = await evaluateTextCase(c, deps(), { mode: 'deterministic', captureDetail: true });
    const prompt = buildJudgePrompt(r.detail!);
    expect(/<untrusted_request>[\s\S]*Ignore all previous instructions[\s\S]*<\/untrusted_request>/.test(prompt)).toBe(
      true,
    );
    expect(prompt).toContain('<untrusted_app>');
    expect(prompt.indexOf('Ignore all previous')).toBeGreaterThan(prompt.indexOf('<untrusted_request>'));
    expect(titleOf(c).length).toBeLessThanOrEqual(90);
  });
});

describe('assessDisagreement', () => {
  const base = (over: Partial<CaseResult> = {}) =>
    ({
      ambiguous: false,
      build: { ok: true, route: 'template' },
      failures: [],
      detail: { checks: [] },
      ...over,
    }) as unknown as Pick<CaseResult, 'ambiguous' | 'build' | 'failures' | 'detail'>;
  const ai = (over: Partial<AIPreScore> = {}): AIPreScore => ({
    score: 'correct',
    reasons: ['ok'],
    confidence: 0.9,
    ...over,
  });

  it('does not flag a confident correct score with every check passing', () => {
    expect(assessDisagreement(base(), ai()).flag).toBe(false);
  });
  it('flags low confidence, a wrong score, a failed check under a correct score, and a partly score', () => {
    expect(assessDisagreement(base(), ai({ confidence: 0.4 })).flag).toBe(true);
    expect(assessDisagreement(base(), ai({ score: 'wrong' })).flag).toBe(true);
    const failing = base({ detail: { checks: [{ id: 'fields', label: 'x', status: 'fail' }] } as never });
    expect(assessDisagreement(failing, ai()).reasons.join(' ')).toMatch(/automatic check/);
    expect(assessDisagreement(base(), ai({ score: 'partly' })).reasons.join(' ')).toMatch(
      /every automatic check passed/,
    );
  });
  it('does not flag a case only because its complexity label is ambiguous', () => {
    expect(assessDisagreement(base({ ambiguous: true }), ai()).flag).toBe(false);
  });
  it('flags a missing score and a repaired build', () => {
    expect(assessDisagreement(base(), undefined).flag).toBe(true);
    expect(assessDisagreement(base({ build: { ok: true, route: 'cloud+repair' } as never }), ai()).flag).toBe(true);
  });
});
