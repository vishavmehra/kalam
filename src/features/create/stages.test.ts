import { describe, expect, it } from 'vitest';
import { advanceSteps, liveRoute, needsCloudWhileOffline, routeFromSteps, stageToStep, verifyCount, type ProgressStep } from './stages';

describe('creation progress steps', () => {
  it('only shows steps that actually started, completing earlier ones', () => {
    let steps: ProgressStep[] = [];
    steps = advanceSteps(steps, 'normalizing');
    steps = advanceSteps(steps, 'classifying');
    expect(steps).toEqual([{ id: 'understand', label: 'Understanding your idea', status: 'active' }]);
    steps = advanceSteps(steps, 'matching_template');
    steps = advanceSteps(steps, 'extracting_params', 'Gemini Nano on-device');
    steps = advanceSteps(steps, 'validating');
    expect(steps.map((s) => `${s.id}:${s.status}`)).toEqual([
      'understand:done', 'template:done', 'on_device:done', 'validate:active',
    ]);
    expect(advanceSteps(steps, 'done').every((s) => s.status === 'done')).toBe(true);
  });

  it('reports the live route honestly', () => {
    expect(liveRoute('extracting_params', 'deterministic keywords')).toBe('Template');
    expect(liveRoute('extracting_params', 'on_device')).toBe('On-device');
    expect(liveRoute('generating_cloud')).toBe('Cloud');
    expect(liveRoute('planning_specialist')).toBe('Specialist');
    expect(liveRoute('validating')).toBeUndefined();
    expect(stageToStep('done')).toBeUndefined();
  });

  it('shows the AI-step check as its own step and keeps the route that built the app', () => {
    let steps: ProgressStep[] = [];
    for (const s of ['classifying', 'matching_template', 'validating'] as const) steps = advanceSteps(steps, s);
    steps = advanceSteps(steps, 'verifying', 'Testing AI step 1 of 2');
    steps = advanceSteps(steps, 'verifying', 'Testing AI step 2 of 2');
    expect(steps.map((s) => `${s.id}:${s.status}`)).toEqual(['understand:done', 'template:done', 'validate:done', 'verify_ai:active']);
    expect(steps.at(-1)).toMatchObject({ label: 'Checking AI steps', detail: 'Testing AI step 2 of 2' });
    expect(liveRoute('verifying')).toBeUndefined();
    expect(routeFromSteps(steps)).toBe('Template');
    expect(routeFromSteps(advanceSteps(steps, 'generating_cloud'))).toBe('Cloud');
    expect(routeFromSteps([])).toBeUndefined();
  });

  it('reads the check counter as numbers', () => {
    expect(verifyCount('Testing AI step 2 of 3')).toEqual({ n: 2, total: 3 });
    expect(verifyCount(undefined)).toBeUndefined();
    expect(verifyCount('on_device')).toBeUndefined();
  });
});

describe('queueing a build until online', () => {
  const result = (over: object) => ({ classification: { requiresCloudReasoning: false, complexity: 'simple', ...over } }) as Parameters<typeof needsCloudWhileOffline>[0];
  it('is offered only offline, and only for an idea that needs the cloud', () => {
    expect(needsCloudWhileOffline(result({ requiresCloudReasoning: true }), false)).toBe(true);
    expect(needsCloudWhileOffline(result({ complexity: 'complex' }), false)).toBe(true);
    expect(needsCloudWhileOffline(result({ requiresCloudReasoning: true }), true)).toBe(false);
    expect(needsCloudWhileOffline(result({}), false)).toBe(false);
  });
});
