/**
 * Maps pipeline stages to plain-language progress steps and an honest route indicator
 * (docs/03 §12.2: only show a step once that operation really started).
 */
import type { CreationResult, CreationRoute, CreationStage } from '@/core/contracts';

export type StepId = 'understand' | 'template' | 'on_device' | 'cloud' | 'validate' | 'repair';
export type RouteBadge = 'Template' | 'On-device' | 'Cloud' | 'Specialist' | 'Checking';

export interface ProgressStep { id: StepId; label: string; detail?: string; status: 'active' | 'done' }

const LABELS: Record<StepId, string> = {
  understand: 'Understanding your idea',
  template: 'Looking for a ready-made template',
  on_device: 'Filling in details on this device',
  cloud: 'Building the app with cloud AI',
  validate: 'Checking the app works',
  repair: 'Fixing problems found in the check',
};

const mentionsOnDevice = (detail?: string) => !!detail && /on[-_ ]?device|nano|local model/i.test(detail);

export function stageToStep(stage: CreationStage, detail?: string): StepId | undefined {
  switch (stage) {
    case 'normalizing':
    case 'classifying': return 'understand';
    case 'matching_template': return 'template';
    case 'extracting_params': return mentionsOnDevice(detail) ? 'on_device' : 'template';
    case 'generating_cloud':
    case 'planning_specialist': return 'cloud';
    case 'validating':
    case 'verifying': return 'validate';
    case 'repairing': return 'repair';
    default: return undefined;
  }
}

/** Folds a stage event into the visible step list: previous steps complete, the new one is active. */
export function advanceSteps(steps: ProgressStep[], stage: CreationStage, detail?: string): ProgressStep[] {
  if (stage === 'done' || stage === 'failed') return steps.map((s) => ({ ...s, status: 'done' }));
  const id = stageToStep(stage, detail);
  if (!id) return steps;
  const done = steps.map((s) => (s.id === id ? s : { ...s, status: 'done' as const }));
  const existing = done.find((s) => s.id === id);
  if (existing) return done.map((s) => (s.id === id ? { ...s, status: 'active', ...(detail ? { detail } : {}) } : s));
  return [...done, { id, label: LABELS[id], status: 'active', ...(detail ? { detail } : {}) }];
}

/** Route currently in use, judged only from stages that actually happened. */
export function liveRoute(stage: CreationStage | undefined, detail?: string): RouteBadge | undefined {
  if (!stage) return undefined;
  if (stage === 'planning_specialist') return 'Specialist';
  const step = stageToStep(stage, detail);
  if (step === 'cloud') return 'Cloud';
  if (step === 'on_device') return 'On-device';
  if (step === 'template') return 'Template';
  return undefined;
}

export function routeLabel(route: CreationRoute): string {
  switch (route) {
    case 'template': return 'Built from a template on this device';
    case 'template+on_device': return 'Template filled in by on-device AI';
    case 'cloud': return 'Built with Firebase cloud AI';
    case 'cloud+repair': return 'Built with cloud AI, then repaired';
    case 'specialist': return 'Planned by a specialist model';
    case 'import': return 'Imported';
    case 'manual': return 'Made by hand';
  }
}

/** Plain-language failure copy: never raw provider errors (docs/03 §12.4–12.5). */
export function failureCopy(result: Pick<CreationResult, 'message' | 'errors' | 'route' | 'classification'>, online: boolean): {
  title: string; body: string; suggestion?: string;
} {
  const needsCloud = result.classification.requiresCloudReasoning || result.classification.complexity === 'complex';
  if (!online && needsCloud) {
    return {
      title: 'This app needs the cloud to build',
      body: 'You are offline, and this idea is too detailed to build on this device. Your input is kept. Try again when you are connected.',
      suggestion: 'Or describe a simpler app that matches a template, like "a checklist for daily tasks" or "an expense tracker in ₹".',
    };
  }
  const tpl = result.classification.matchingTemplate;
  return {
    title: 'Kalam could not build this app yet',
    body: result.message ?? 'The result did not pass Kalam\'s checks, so nothing was saved. Your input is kept.',
    ...(tpl ? {} : { suggestion: 'Try naming what to track and the fields, for example "a tailor order book with customer name, measurements and delivery date".' }),
  };
}
