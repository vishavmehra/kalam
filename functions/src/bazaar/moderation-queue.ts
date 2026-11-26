/**
 * Moderator queue and listing counters, as pure plans (docs/12 §14.5, §18.2, §18.4, §21).
 * The callables in ./index.ts read Firestore with the Admin SDK, call these, and return the result.
 *
 * Privacy: a report never leaves the server with its sender, and a counter is a number with no
 * identity, no record value and no prompt (docs/12 §21).
 */
import { z } from 'zod';

const LISTING_ID = /^l[a-z0-9]{19}$/;
export const listingIdSchema = z.string().regex(LISTING_ID);

/** Moderator reads: the queue of listings to look at, or the reviews of one listing. */
export const listRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('queue') }).strict(),
  z.object({ kind: z.literal('reviews'), listingId: listingIdSchema }).strict(),
]);

/** One anonymous count. `view` = a listing page was opened; `preview` = the sandbox preview was started. */
export const COUNT_KINDS = ['view', 'preview'] as const;
export const countRequestSchema = z.object({ listingId: listingIdSchema, kind: z.enum(COUNT_KINDS) }).strict();
export const statsRequestSchema = z.object({ listingId: listingIdSchema }).strict();

export const REPORT_REASONS = ['malicious', 'misleading', 'privacy', 'copyright', 'spam', 'inappropriate', 'broken'] as const;

/** A decision on the listing itself closes the reports sent before it. Feature, recount and review changes do not. */
const CLOSING_ACTIONS = new Set(['approve', 'reject', 'request_changes', 'suspend', 'unsuspend']);

export const MAX_QUEUE_ITEMS = 50;
const MAX_NOTES = 3;
const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export interface ListingRow {
  id: string;
  title: string;
  makerName: string;
  status: string;
  price: number;
  reviewed: boolean;
  featured: boolean;
  safetyVerdict: string;
  safetyReasons: string[];
  specVersion: number;
  updatedAtMs: number;
}
export interface ReportRow { listingId: string; reason: string; note: string; createdAtMs: number }
export interface LogRow { listingId: string; action: string; createdAtMs: number }

export interface QueueItem {
  listingId: string;
  title: string;
  makerName: string;
  status: string;
  price: number;
  reviewed: boolean;
  featured: boolean;
  safetyVerdict: string;
  safetyReasons: string[];
  specVersion: number;
  updatedAtMs: number;
  /** Why it is here: waiting for a review, reported by people, or both. */
  why: 'pending' | 'reported' | 'both';
  reports: { total: number; byReason: Record<string, number>; notes: string[] };
}

/**
 * Pending listings plus listings with reports newer than the last decision on them. Most reported
 * first, then the longest waiting. Reporter identity is not part of the input, so it cannot leak.
 */
export function buildQueue(input: { listings: ListingRow[]; reports: ReportRow[]; log: LogRow[] }): QueueItem[] {
  const lastDecision = new Map<string, number>();
  for (const e of input.log) {
    if (CLOSING_ACTIONS.has(e.action)) lastDecision.set(e.listingId, Math.max(lastDecision.get(e.listingId) ?? 0, e.createdAtMs));
  }
  const open = new Map<string, ReportRow[]>();
  for (const r of input.reports) {
    if (r.createdAtMs <= (lastDecision.get(r.listingId) ?? -1)) continue;
    open.set(r.listingId, [...(open.get(r.listingId) ?? []), r]);
  }
  const items: QueueItem[] = [];
  for (const l of input.listings) {
    const reports = (open.get(l.id) ?? []).sort((a, b) => b.createdAtMs - a.createdAtMs);
    const pending = l.status === 'pending_review';
    if (!pending && reports.length === 0) continue;
    const byReason: Record<string, number> = {};
    for (const r of reports) {
      const why = clip(r.reason, 40) || 'other';
      byReason[why] = (byReason[why] ?? 0) + 1;
    }
    items.push({
      listingId: l.id,
      title: clip(l.title, 120),
      makerName: clip(l.makerName, 80),
      status: l.status,
      price: l.price,
      reviewed: l.reviewed,
      featured: l.featured,
      safetyVerdict: clip(l.safetyVerdict, 20),
      safetyReasons: l.safetyReasons.slice(0, 3).map((s) => clip(s, 200)),
      specVersion: l.specVersion,
      updatedAtMs: l.updatedAtMs,
      why: pending && reports.length ? 'both' : pending ? 'pending' : 'reported',
      reports: {
        total: reports.length,
        byReason,
        notes: reports.map((r) => clip(r.note, 200)).filter(Boolean).slice(0, MAX_NOTES),
      },
    });
  }
  return items
    .sort((a, b) => b.reports.total - a.reports.total || a.updatedAtMs - b.updatedAtMs)
    .slice(0, MAX_QUEUE_ITEMS);
}

export interface ReviewRow { uid: string; rating: number; comment: string; authorName: string; status: string }

/** The reviews a moderator can hide or show again. The reviewer id is needed for that action. */
export function reviewsView(rows: ReviewRow[]): ReviewRow[] {
  return rows.slice(0, 50).map((r) => ({
    uid: clip(r.uid, 128),
    rating: Math.max(0, Math.min(5, Math.round(Number(r.rating) || 0))),
    comment: clip(r.comment, 500),
    authorName: clip(r.authorName, 60),
    status: r.status === 'hidden' ? 'hidden' : 'visible',
  }));
}

/** What a maker may see about their own listing: counters only (docs/12 §21). */
export function statsView(
  stats: { views?: unknown; previews?: unknown } | undefined,
  listing: { installs?: unknown; likes?: unknown; ratingCount?: unknown },
) {
  const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  return {
    views: n(stats?.views), previews: n(stats?.previews),
    installs: n(listing.installs), likes: n(listing.likes), ratings: n(listing.ratingCount),
  };
}
