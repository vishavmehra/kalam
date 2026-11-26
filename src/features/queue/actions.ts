/**
 * Putting work on the queue (pure; the app wires real storage in `queue-service.ts`).
 *
 * Each helper stores what the operation needs, writes the row, and cleans up if that fails or the same
 * work was already queued. Nothing here sends anything: the queue does that, and only for what the person
 * queued, after it re-checks consent.
 */
import type { AIImage, BlobRepository } from '@/core/contracts';
import { newOperationId, QueueError, type OperationQueue, type PendingOperation, type SendKind } from '@/core/queue';
import type { CreationDraft } from '@/features/input/normalize';
import { aiStepDedupeKey, buildSends, prepareBuild, type AIStepSnapshot } from './snapshot';

export interface ActionDeps {
  queue: Pick<OperationQueue, 'enqueue'>;
  blobs: Pick<BlobRepository, 'put' | 'removeByOwner'>;
  newId?: () => string;
}

/** What a request would queue. The UI shows `sends` before the person confirms. */
export type QueueRequest =
  | { kind: 'compile'; draft: CreationDraft }
  | { kind: 'translate'; appId: string; lang: string; preferCloud?: boolean }
  | { kind: 'ai_step'; appId: string; blockId: string; input?: string; image?: AIImage };

export function requestSends(r: QueueRequest): SendKind[] {
  if (r.kind === 'compile') return buildSends(r.draft);
  if (r.kind === 'translate') return ['labels'];
  return r.image ? ['ai_photo'] : ['ai_input'];
}

const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

export function createQueueActions(deps: ActionDeps) {
  const newId = deps.newId ?? newOperationId;
  /** Runs `store` then `enqueue`; if either fails, or the work was already queued, the files made for it go. */
  async function withFiles(id: string, work: () => Promise<PendingOperation>): Promise<PendingOperation> {
    try {
      const op = await work();
      if (op.id !== id) await deps.blobs.removeByOwner(id);
      return op;
    } catch (error) {
      await deps.blobs.removeByOwner(id).catch(() => 0);
      throw error;
    }
  }

  return {
    /** Queue a build of an app from the current draft. The draft itself stays as it is and stays editable. */
    compile(draft: CreationDraft): Promise<PendingOperation> {
      const id = newId();
      let built: ReturnType<typeof prepareBuild>;
      try {
        built = prepareBuild(draft, id);
      } catch {
        return Promise.reject(new QueueError('invalid_operation'));
      }
      return withFiles(id, async () => {
        for (const f of built.files) {
          await deps.blobs.put({ id: f.blobId, kind: f.kind, mimeType: f.mimeType, base64: f.base64, ownerId: id });
        }
        return deps.queue.enqueue({ id, kind: 'compile', payloadRef: id, dedupeKey: built.dedupeKey, sends: built.sends, snapshot: built.snapshot });
      });
    },

    /** Queue the translation of one app into one language. */
    async translate(appId: string, lang: string, opts: { preferCloud?: boolean } = {}): Promise<PendingOperation> {
      if (!LANG.test(lang) || !appId) throw new QueueError('invalid_operation');
      return deps.queue.enqueue({
        kind: 'translate', payloadRef: appId, appId, dedupeKey: `translate:${appId}:${lang}`, sends: ['labels'],
        params: { lang, ...(opts.preferCloud ? { preferCloud: true } : {}) },
      });
    },

    /** Queue one AI step the person started: the text they typed, or one picture. */
    aiStep(a: { appId: string; blockId: string; input?: string; image?: AIImage }): Promise<PendingOperation> {
      const id = newId();
      const snapshot: AIStepSnapshot = {
        v: 1, blockId: a.blockId,
        ...(a.input !== undefined ? { input: a.input } : {}),
        ...(a.image ? { imageBlobId: `${id}.image` } : {}),
      };
      if (a.input === undefined && !a.image) return Promise.reject(new QueueError('invalid_operation'));
      return withFiles(id, async () => {
        if (a.image) await deps.blobs.put({ id: `${id}.image`, kind: 'image', mimeType: a.image.mimeType, base64: a.image.base64, ownerId: id });
        return deps.queue.enqueue({
          id, kind: 'ai_step', payloadRef: a.appId, appId: a.appId, dedupeKey: aiStepDedupeKey(a.appId, snapshot, a.image?.base64),
          sends: a.image ? ['ai_photo'] : ['ai_input'], params: { blockId: a.blockId }, snapshot: JSON.stringify(snapshot),
        });
      });
    },

    request(r: QueueRequest): Promise<PendingOperation> {
      if (r.kind === 'compile') return this.compile(r.draft);
      if (r.kind === 'translate') return this.translate(r.appId, r.lang, { preferCloud: r.preferCloud });
      return this.aiStep(r);
    },
  };
}
export type QueueActions = ReturnType<typeof createQueueActions>;
