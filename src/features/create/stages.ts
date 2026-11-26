/**
 * Maps pipeline stages to plain-language progress steps and an honest route indicator
 * (docs/03 §12.2: only show a step once that operation really started). Words live in the i18n
 * catalogue: `STEP_KEY`, `routeLabelKey` and `failureCopy` hand back keys or translated text.
 */
import type { CreationResult, CreationRoute, CreationStage } from '@/core/contracts';
import type { TranslationKey } from '@/i18n/keys';
import type { TFunction } from '@/i18n/translator';

export type StepId = 'understand' | 'template' | 'on_device' | 'cloud' | 'validate' | 'verify_ai' | 'repair';
export type RouteBadge = 'Template' | 'On-device' | 'Cloud' | 'Specialist' | 'Checking';

export interface ProgressStep { id: StepId; label: string; detail?: string; status: 'active' | 'done' }

/** English labels kept on the step for logs and tests; the screen shows `STEP_KEY`. */
const LABELS: Record<StepId, string> = {
  understand: 'Understanding your idea',
  template: 'Looking for a ready-made template',
  on_device: 'Filling in details on this device',
  cloud: 'Building the app with cloud AI',
  validate: 'Checking the app works',
  verify_ai: 'Checking AI steps',
  repair: 'Fixing problems found in the check',
};

export const STEP_KEY: Record<StepId, TranslationKey> = {
  understand: 'create.build.step.understand',
  template: 'create.build.step.template',
  on_device: 'create.build.step.on_device',
  cloud: 'create.build.step.cloud',
  validate: 'create.build.step.validate',
  verify_ai: 'create.build.step.verify_ai',
  repair: 'create.build.step.repair',
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
    case 'validating': return 'validate';
    // C2: the build-time check of the app's AI steps is its own step (docs/07 §13.3).
    case 'verifying': return 'verify_ai';
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

/**
 * The route the build took so far, from the steps that really ran. While checking, the stamp keeps the
 * route that built the app instead of disappearing.
 */
export function routeFromSteps(steps: readonly ProgressStep[]): RouteBadge | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const id = steps[i]!.id;
    if (id === 'cloud') return 'Cloud';
    if (id === 'on_device') return 'On-device';
    if (id === 'template') return 'Template';
  }
  return undefined;
}

/** "Testing AI step 2 of 3" from the pipeline (VERIFY_COPY.progress) as numbers, so the screen can say it in any language. */
export function verifyCount(detail: string | undefined): { n: number; total: number } | undefined {
  const m = detail?.match(/(\d+)\D+(\d+)/);
  return m ? { n: Number(m[1]), total: Number(m[2]) } : undefined;
}

export function routeLabelKey(route: CreationRoute): TranslationKey {
  switch (route) {
    case 'template': return 'create.route.template';
    case 'template+on_device': return 'create.route.templateOnDevice';
    case 'cloud': return 'create.route.cloud';
    case 'cloud+repair': return 'create.route.cloudRepair';
    case 'specialist': return 'create.route.specialist';
    case 'import': return 'create.route.import';
    case 'manual': return 'create.route.manual';
  }
}

/** The build failed because this idea needs the cloud and the device has no signal. Queueing it is offered then. */
export function needsCloudWhileOffline(result: Pick<CreationResult, 'classification'>, online: boolean): boolean {
  return !online && (result.classification.requiresCloudReasoning || result.classification.complexity === 'complex');
}

/** Plain-language failure copy: never raw provider errors (docs/03 §12.4–12.5). */
export function failureCopy(
  result: Pick<CreationResult, 'message' | 'errors' | 'route' | 'classification'>,
  online: boolean,
  t: TFunction,
): { title: string; body: string; suggestion?: string } {
  if (needsCloudWhileOffline(result, online)) {
    return { title: t('create.error.cloudTitle'), body: t('create.error.cloudBody'), suggestion: t('create.fail.offlineIdea') };
  }
  const tpl = result.classification.matchingTemplate;
  return {
    title: t('create.error.failedTitle'),
    // The pipeline's own message is already plain words (src/core/pipeline); it stays as written.
    body: result.message ?? t('create.fail.checks'),
    ...(tpl ? {} : { suggestion: t('create.fail.nameFields') }),
  };
}
