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

export type BuildForecast = {
  kind: 'template' | 'needs' | 'cloud';
  stamp: 'create.forecast.template' | 'create.forecast.needsCloud' | 'create.forecast.cloud';
  body: 'create.forecast.templateBody' | 'create.forecast.cloudOffBody' | 'create.forecast.offlineBody' | 'create.forecast.photoBody' | 'create.forecast.cloudBody';
};

/** The route forecast before a build (DIRECTION §6): undefined with no input, else the likely engine and why. */
export function buildForecast(draft: CreationDraft, cloudOk: boolean, online: boolean): BuildForecast | undefined {
  if (!draftModalities(draft).length) return undefined;
  if (!draftMayUseCloud(draft)) return { kind: 'template', stamp: 'create.forecast.template', body: 'create.forecast.templateBody' };
  if (!cloudOk) return { kind: 'needs', stamp: 'create.forecast.needsCloud', body: 'create.forecast.cloudOffBody' };
  if (!online) return { kind: 'needs', stamp: 'create.forecast.needsCloud', body: 'create.forecast.offlineBody' };
  const pictures = draft.photos.length > 0 || !!draft.video?.frames.length || !!draft.drawing;
  return { kind: 'cloud', stamp: 'create.forecast.cloud', body: pictures ? 'create.forecast.photoBody' : 'create.forecast.cloudBody' };
}
