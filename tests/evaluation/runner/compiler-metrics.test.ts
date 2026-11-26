import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { irToSpec } from '@/core/compiler/convert';
import { compilerIRSchema } from '@/core/compiler/ir';
import type { KalamSpec } from '@/core/spec/schema';
import { measureStructure, requestOf, summarizeStructure } from './compiler-metrics';
import { buildReport } from './metrics';
import { COMPILER_METRIC_NAMES, compilerMetricTable, formatFinal, mergeScores } from './scores';
import { makeResult } from './test-helpers';
import type { CaseResult, GoldenExpected, HumanScoresFile } from './types';

const ir = compilerIRSchema.parse(JSON.parse(readFileSync(new URL('../../fixtures/compiler/tailor-shop.ir.json', import.meta.url), 'utf8')));
const tailor = irToSpec(ir, { appId: 'app_tailor01', now: 1 });
const REQUEST = 'A tailor shop with customers and orders, and a photo of the measurement slip';
const expectedOf = (requiredComponents: GoldenExpected['requiredComponents'] = []): GoldenExpected => ({
  complexity: 'complex', taskType: 'create_app', route: 'cloud', minScreens: 1, minCollections: 1, requiredFields: [], requiredComponents,
});

/** A copy of the app with one more component on its first screen. */
const withComponent = (spec: KalamSpec, component: Record<string, unknown>): KalamSpec => ({
  ...spec,
  screens: spec.screens.map((s, i) => (i === 0 ? { ...s, children: [...s.children, component as never] } : s)),
});
/** A copy of the app where one button points at another kind of action. */
const withAction = (spec: KalamSpec, label: string, action: KalamSpec['actions'][string]): KalamSpec => ({
  ...spec,
  actions: { ...spec.actions, zz_test: action },
  screens: spec.screens.map((s, i) => (i === 0 ? { ...s, children: [...s.children, { id: 'zz_button', type: 'bigButton', label, action: 'zz_test' } as never] } : s)),
});

describe('measureStructure (D13-021)', () => {
  it('counts a built app as wired and not hallucinated', () => {
    const m = measureStructure(tailor, REQUEST, expectedOf(['photo']));
    expect(m.components.total).toBeGreaterThan(5);
    expect(m.components.appropriate).toBe(m.components.total);
    expect(m.components.hallucinated).toEqual([]);
    expect(m.actions.total).toBeGreaterThan(0);
    expect(m.actions.correct).toBe(m.actions.total);
    expect(m.references.total).toBeGreaterThan(20);
    expect(m.references.danglingFirstPass).toBe(0);
  });

  it('calls an advanced component nobody asked for hallucinated, and one that was asked for fine', () => {
    const chart = { id: 'zz_chart', type: 'chart', label: 'Orders', chart: 'bar', source: 'orders', metric: 'count', groupBy: 'status' };
    const unasked = measureStructure(withComponent(tailor, chart), REQUEST, expectedOf(['photo']));
    expect(unasked.components.hallucinated).toEqual([expect.stringMatching(/zz_chart:chart$/)]);
    expect(unasked.components.appropriate).toBe(unasked.components.total - 1);
    expect(measureStructure(withComponent(tailor, chart), `${REQUEST}. Show a chart of orders by status.`, expectedOf(['photo'])).components.hallucinated).toEqual([]);
    expect(measureStructure(withComponent(tailor, chart), REQUEST, expectedOf(['photo', 'chart'])).components.hallucinated).toEqual([]);
  });

  it('does not count a component that points at nothing as appropriate', () => {
    const dangling = measureStructure(withComponent(tailor, { id: 'zz_list', type: 'list', source: 'nope', primary: 'nope' }), REQUEST, expectedOf(['photo']));
    expect(dangling.components.appropriate).toBe(dangling.components.total - 1);
    const nobutton = measureStructure(withComponent(tailor, { id: 'zz_b', type: 'bigButton', label: 'Go', action: 'missing' }), REQUEST, expectedOf(['photo']));
    expect(nobutton.actions.wrong).toEqual([expect.stringMatching(/zz_b$/)]);
  });

  it.each([
    ['Delete order', { type: 'insert', collection: 'orders' }, false],
    ['Delete order', { type: 'delete', collection: 'orders', confirm: 'Delete?' }, true],
    ['Mark done', { type: 'delete', collection: 'orders', confirm: 'Sure?' }, false],
    ['Save order', { type: 'navigate', screen: 'home' }, false],
    ['Save order', { type: 'insert', collection: 'orders' }, true],
    ['Open customers', { type: 'navigate', screen: 'home' }, true],
  ] as const)('button "%s" with a %s action is correct: %s', (label, action, ok) => {
    const spec = withAction(tailor, label, action as never);
    const base = measureStructure(tailor, REQUEST, expectedOf(['photo']));
    const m = measureStructure(spec, REQUEST, expectedOf(['photo']));
    expect(m.actions.total).toBe(base.actions.total + 1);
    expect(m.actions.correct).toBe(base.actions.correct + (ok ? 1 : 0));
  });

  it('counts only unknown-reference codes of the first answer as dangling references', () => {
    const m = measureStructure(tailor, REQUEST, expectedOf(), [
      'UNKNOWN_COLLECTION screens[0].children[1].source', 'UNKNOWN_FIELD screens[1].children[0].field', 'DUPLICATE_ID screens[0]', 'IR something',
    ]);
    expect(m.references.danglingFirstPass).toBe(2);
  });
});

describe('summarizeStructure and the twelve metrics (D13-021)', () => {
  const built = (id: string, spec: KalamSpec, over: Partial<CaseResult> = {}): CaseResult =>
    makeResult({
      id,
      build: { stage: 'cloud', ok: true, valid: true, describeOk: true, route: 'cloud', firstPassValid: true, errors: [], warnings: 0 },
      latencyMs: { classify: 1, build: 12_000, total: 12_001 },
      detail: {
        title: id, tags: [], input: { kind: 'text', text: REQUEST }, expected: expectedOf(['photo']), spec, formulas: [], checks: [],
      },
      ...over,
    });
  const chart = { id: 'zz_chart', type: 'chart', label: 'Orders', chart: 'bar', source: 'orders', metric: 'count', groupBy: 'status' };
  const cases = [
    built('a', tailor),
    built('b', withComponent(tailor, chart), { build: { stage: 'cloud', ok: true, valid: true, describeOk: true, route: 'cloud+repair', firstPassValid: false, errors: [], warnings: 0, attempts: [{ pass: 'first', stage: 'validation', issues: ['UNKNOWN_FIELD screens[1].children[0].field'], repairs: [] }, { pass: 'repair', stage: 'ok', issues: [], repairs: [] }] } }),
  ];

  it('totals the structure rates over the built apps with a stored spec', () => {
    const t = summarizeStructure(cases);
    expect(t.measured).toBe(2);
    expect(t.hallucinatedComponents.correct).toBe(1);
    expect(t.hallucinatedComponents.total).toBe(t.componentPrecision.total);
    expect(t.componentPrecision.correct).toBe(t.componentPrecision.total - 1);
    expect(t.actionAccuracy.rate).toBe(1);
    expect(t.referenceIntegrityFirstPass.total - t.referenceIntegrityFirstPass.correct).toBe(1);
  });

  it('skips apps that did not build and stored reports whose spec is not an app', () => {
    const t = summarizeStructure([
      built('x', tailor, { build: { stage: 'skipped', ok: false, valid: false, describeOk: false, errors: [], warnings: 0 } }),
      built('y', {} as never),
    ]);
    expect(t.measured).toBe(0);
    expect(t.componentPrecision.rate).toBeNull();
  });

  it('reads the request from the scoring detail, never from pixels', () => {
    expect(requestOf(cases[0]!)).toBe(REQUEST);
    expect(requestOf(makeResult({ id: 'n' }))).toBe('');
  });

  it('lists all twelve metrics of docs/13 §6.6, each with its own basis, in the document order', () => {
    const report = buildReport({
      mode: 'live', datasetVersion: 'v', results: cases, platform: 'node', promptVersion: 'p', datasetHash: 'h', cloudCalls: 3, createdAt: new Date(0),
    });
    const scores: HumanScoresFile = {
      schema: 'kalam-human-scores/1', evaluationId: report.evaluationId, exportedAt: 'x',
      scores: [{ id: 'a', score: 'correct' }, { id: 'b', score: 'partly' }],
    };
    const final = mergeScores(report, scores);
    const rows = compilerMetricTable(final.datasets.text!);
    expect(rows.map((r) => r.metric)).toEqual([...COMPILER_METRIC_NAMES]);
    expect(COMPILER_METRIC_NAMES).toHaveLength(12);
    const by = Object.fromEntries(rows.map((r) => [r.metric, r]));
    expect(by['First-pass validity']).toMatchObject({ basis: 'measured', value: { correct: 1, total: 2 } });
    expect(by['Repair success']).toMatchObject({ basis: 'measured', value: { correct: 1, total: 1 } });
    expect(by['Semantic accuracy']).toMatchObject({ basis: 'reviewer', value: { correct: 1, total: 2 } });
    expect(by['Component precision']!.basis).toBe('proxy');
    expect(by['Hallucinated components']).toMatchObject({ basis: 'proxy', value: { correct: 1 } });
    expect(by['Action accuracy']!.basis).toBe('proxy');
    expect(by['Reference integrity']!.basis).toBe('measured');
    expect(by['Compilation latency']).toMatchObject({ basis: 'measured', value: 12_000 });
    expect(by['User correction rate']).toMatchObject({ basis: 'reviewer', value: { correct: 1, total: 2 } });
    const text = formatFinal(final);
    expect(text).toContain('compiler metrics (docs/13');
    expect(text).toContain('Hallucinated components:');
    expect(text).not.toMatch(/[—–]/);
  });

  it('says "not measured" for what this run cannot measure instead of inventing a number', () => {
    const report = buildReport({
      mode: 'deterministic', datasetVersion: 'v', results: [makeResult({ id: 'a' })], platform: 'node', promptVersion: 'p', datasetHash: 'h', cloudCalls: 0, createdAt: new Date(0),
    });
    const final = mergeScores(report, { schema: 'kalam-human-scores/1', evaluationId: report.evaluationId, exportedAt: 'x', scores: [] });
    const by = Object.fromEntries(compilerMetricTable(final.datasets.text!).map((r) => [r.metric, r]));
    for (const m of ['First-pass validity', 'Post-repair validity', 'Semantic accuracy', 'Component precision', 'Action accuracy', 'Hallucinated components', 'Repair success', 'Compilation latency', 'User correction rate']) {
      expect(by[m], m).toMatchObject({ basis: 'not measured', value: null });
    }
  });
});
