/**
 * What an offline AI step would queue (pure). The runtime offers "Queue until online" when a step
 * reports `offline`; this decides what that step sends, by the kind of step.
 *
 * - Text steps (classify, summarise, translate) send the text typed in `inputField`.
 * - `extractFromPhoto` has no `inputField`; it sends the picture. Offline, the runtime skips the picker,
 *   so the picture may not exist yet and the person must choose one (`needsPicture`).
 */
import type { AIImage } from '@/core/contracts';
import type { QueueRequest } from './actions';

export interface AiOfferStep {
  appId: string;
  blockId: string;
  block: { kind: string; inputField?: string } | undefined;
  /** The current form values of the screen. */
  form: Readonly<Record<string, unknown>>;
  /** The picture already chosen for this step, if any. */
  image?: AIImage;
}

export type AiOffer =
  | { state: 'ready'; request: Extract<QueueRequest, { kind: 'ai_step' }> }
  | { state: 'needsPicture' }
  | { state: 'none' };

export function aiOffer({ appId, blockId, block, form, image }: AiOfferStep): AiOffer {
  if (!block || !appId) return { state: 'none' };
  if (block.kind === 'extractFromPhoto') {
    return image ? { state: 'ready', request: { kind: 'ai_step', appId, blockId, image } } : { state: 'needsPicture' };
  }
  const value = block.inputField ? form[block.inputField] : undefined;
  const input = value === null || value === undefined ? '' : String(value).trim();
  return input ? { state: 'ready', request: { kind: 'ai_step', appId, blockId, input } } : { state: 'none' };
}
