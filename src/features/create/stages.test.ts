import { describe, expect, it } from 'vitest';
import { advanceSteps, liveRoute, stageToStep, type ProgressStep } from './stages';

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
});
