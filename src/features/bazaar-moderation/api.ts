/**
 * The moderator and counter calls, built over an injected `call` so they are tested without Firebase.
 * Every response is parsed with Zod; a response that does not fit is treated as a failure, never shown.
 */
import type { z } from 'zod';

import {
  errorKind, queueResponseSchema, reviewsResponseSchema, statsSchema,
  type ListingStats, type ModAction, type ModErrorKind, type ModReview, type QueueItem, type ReasonCode,
} from './model';

export type Outcome<T> = { ok: true; data: T } | { ok: false; kind: ModErrorKind };

/** The shape of `callBazaar` from `@/infrastructure/bazaar/functions`. */
export type CallFn = <Req, Res>(
  name: 'kalamBazaarModerate' | 'kalamBazaarModerationList' | 'kalamBazaarCount' | 'kalamBazaarStats',
  data: Req,
) => Promise<{ ok: true; data: Res } | { ok: false; message: string; code?: string }>;

export function createModerationApi(call: CallFn) {
  async function run<S extends z.ZodType>(
    name: Parameters<CallFn>[0], data: unknown, schema: S,
  ): Promise<Outcome<z.infer<S>>> {
    const r = await call<unknown, unknown>(name, data);
    if (!r.ok) return { ok: false, kind: errorKind(r.code) };
    const parsed = schema.safeParse(r.data);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, kind: 'failed' };
  }
  return {
    queue: async (): Promise<Outcome<QueueItem[]>> => {
      const r = await run('kalamBazaarModerationList', { kind: 'queue' }, queueResponseSchema);
      return r.ok ? { ok: true, data: r.data.items } : r;
    },
    reviews: async (listingId: string): Promise<Outcome<ModReview[]>> => {
      const r = await run('kalamBazaarModerationList', { kind: 'reviews', listingId }, reviewsResponseSchema);
      return r.ok ? { ok: true, data: r.data.reviews } : r;
    },
    /** One decision with its reason. The server writes the audit entry. */
    decide: async (listingId: string, action: ModAction, reasonCode: ReasonCode, note: string): Promise<Outcome<true>> => {
      const r = await call<unknown, unknown>('kalamBazaarModerate', { action, listingId, reasonCode, note: note.trim() });
      return r.ok ? { ok: true, data: true } : { ok: false, kind: errorKind(r.code) };
    },
    /** Hide or show one review. `reviewerUid` is the review's id. */
    setReviewHidden: async (listingId: string, reviewerUid: string, hidden: boolean, reasonCode: ReasonCode, note = ''): Promise<Outcome<true>> => {
      const r = await call<unknown, unknown>('kalamBazaarModerate', {
        action: hidden ? 'hide_review' : 'show_review', listingId, targetUid: reviewerUid, reasonCode, note,
      });
      return r.ok ? { ok: true, data: true } : { ok: false, kind: errorKind(r.code) };
    },
    /** A maker's own numbers. */
    stats: (listingId: string): Promise<Outcome<ListingStats>> => run('kalamBazaarStats', { listingId }, statsSchema),
    /** One anonymous count. Resolves quietly: a count that fails is not worth telling anyone about. */
    count: async (listingId: string, kind: 'view' | 'preview'): Promise<boolean> => (await call('kalamBazaarCount', { listingId, kind })).ok,
  };
}
