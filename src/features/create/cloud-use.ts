/**
 * Whether building this draft may send inputs to the cloud. Mirrors the pipeline's route choice
 * (src/core/pipeline/create-application.ts `templateIdFor`): only simple, single-modality requests
 * that match a template stay on this device. Used for the first-cloud-send notice and the cloud
 * cue on attachments (docs/03 §23, docs/11 §8.3). Pure; safe to call on every render.
 */
import { classifyRequest } from '@/core/classifier';
import type { KalamSettings } from '@/core/contracts';
import { buildNormalizedInput, draftModalities, type CreationDraft } from '@/features/input/normalize';

export function draftMayUseCloud(draft: CreationDraft): boolean {
  if (!draftModalities(draft).length) return false;
  const c = classifyRequest(buildNormalizedInput(draft));
  const template = c.complexity === 'simple' && !c.requiresCloudReasoning && !c.requiresMultimodalReasoning && !!c.matchingTemplate;
  return !template;
}

/** Cloud is allowed at all by the person's settings. */
export function cloudAllowed(s: Pick<KalamSettings, 'allowCloud' | 'aiMode'>): boolean {
  return s.allowCloud && s.aiMode === 'hybrid';
}

/** Show the one-time notice before the first build that may send content online. */
export function needsCloudNotice(s: Pick<KalamSettings, 'allowCloud' | 'aiMode' | 'cloudNoticeSeen'>, draft: CreationDraft): boolean {
  return !s.cloudNoticeSeen && cloudAllowed(s) && draftMayUseCloud(draft);
}
