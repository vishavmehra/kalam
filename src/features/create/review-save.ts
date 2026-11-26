/**
 * The pure decisions behind the Review screen (docs/03 §13-14), kept out of the route so they are tested:
 * what the stamp may honestly say, what Save to Shelf stores, whether to ask before saving, and the text a
 * rebuild starts from. Pure TypeScript.
 */
import type { CreationResult, StoredApp } from '@/core/contracts';
import { reportsByBlock } from '@/core/pipeline/verify-blocks';
import type { ReviewFinal } from '@/core/review';
import type { KalamSpec } from '@/core/spec/schema';
import { creationInputRecord, MAX_TEXT_CHARS, type CreationDraft } from '@/features/input/normalize';

/** A stamp says what was checked: "Checked" only when no AI step was left unchecked (docs/13 §8.2). */
export function checksPassed(result: Pick<CreationResult, 'verification'>): boolean {
  return !(result.verification ?? []).some((r) => r.status === 'unverified');
}

/** The app Save to Shelf writes, with the build-time AI-step checks kept beside it (C2, docs/13 §8.2). */
export function storedAppFrom(final: KalamSpec, result: CreationResult, draft: CreationDraft | undefined, now: number): StoredApp {
  const templateId = final.meta.templateId ?? (result.route.startsWith('template') ? result.classification.matchingTemplate : undefined);
  return {
    id: final.id,
    spec: final,
    createdAt: now,
    updatedAt: now,
    origin: {
      route: result.route,
      ...(result.provider !== 'none' ? { provider: result.provider } : {}),
      ...(result.model ? { model: result.model } : {}),
      ...(templateId ? { templateId } : {}),
    },
    ...(draft ? { creationInput: creationInputRecord(draft) } : {}),
    ...(result.verification?.length ? { aiVerification: reportsByBlock(final, result.verification) } : {}),
  };
}

/** Save as is, ask first because answers need a rebuild (docs/06 §11.5, never dropped silently), or say what to fix. */
export function saveStep(final: ReviewFinal): { kind: 'save'; spec: KalamSpec } | { kind: 'ask'; spec: KalamSpec } | { kind: 'fix'; message: string } {
  if (!final.ok) return { kind: 'fix', message: final.error };
  return final.rebuild.length ? { kind: 'ask', spec: final.spec } : { kind: 'save', spec: final.spec };
}

/** The description a rebuild starts from: the typed words, then each answer or change request on its own line. */
export function rebuildText(base: string, extra: readonly string[]): string {
  const b = base.trim();
  const add = extra.filter(Boolean).join('\n');
  return `${b}${b && add ? '\n\n' : ''}${add}`.slice(0, MAX_TEXT_CHARS);
}
