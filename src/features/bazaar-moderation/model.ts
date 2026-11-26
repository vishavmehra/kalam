/**
 * Moderation data and rules that need no screen (docs/12 Â§14.5, Â§18.2-18.4, Â§21). Responses from the
 * trusted functions are parsed here before anything is shown. The server decides everything; the choices
 * below only decide what to offer.
 */
import { z } from 'zod';

import type { TranslationKey } from '@/i18n/keys';

/** The same list as functions/src/bazaar/plan.ts REASON_CODES. */
export const REASON_CODES = [
  'policy_ok', 'misleading', 'harmful', 'privacy', 'copyright', 'spam', 'broken', 'quality', 'dispute', 'other',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** Reasons a moderator can pick. `dispute` stays server-side for hand-made entries. */
export const PICKABLE_REASONS: readonly ReasonCode[] = [
  'policy_ok', 'misleading', 'harmful', 'privacy', 'copyright', 'spam', 'broken', 'quality', 'other',
];

/** Words for a reason: the report reasons people already see, plus three of our own. */
export const REASON_KEY: Record<ReasonCode, TranslationKey> = {
  policy_ok: 'bazaar.mod.reason.policy_ok',
  misleading: 'bazaar.report.reason.misleading',
  harmful: 'bazaar.report.reason.malicious',
  privacy: 'bazaar.report.reason.privacy',
  copyright: 'bazaar.report.reason.copyright',
  spam: 'bazaar.report.reason.spam',
  broken: 'bazaar.report.reason.broken',
  quality: 'bazaar.mod.reason.quality',
  dispute: 'bazaar.mod.reason.else',
  other: 'bazaar.mod.reason.else',
};

/** Report reasons people can send (firestore.rules /reports). */
export const REPORT_REASON_KEY: Record<string, TranslationKey> = {
  malicious: 'bazaar.report.reason.malicious',
  misleading: 'bazaar.report.reason.misleading',
  privacy: 'bazaar.report.reason.privacy',
  copyright: 'bazaar.report.reason.copyright',
  spam: 'bazaar.report.reason.spam',
  inappropriate: 'bazaar.report.reason.inappropriate',
  broken: 'bazaar.report.reason.broken',
};

const int = z.number().int().nonnegative();

export const queueItemSchema = z.object({
  listingId: z.string().regex(/^l[a-z0-9]{19}$/),
  title: z.string().max(120),
  makerName: z.string().max(80),
  status: z.enum(['pending_review', 'published', 'rejected', 'unpublished', 'suspended']),
  price: int,
  reviewed: z.boolean(),
  featured: z.boolean(),
  safetyVerdict: z.string().max(20),
  safetyReasons: z.array(z.string().max(200)).max(3),
  specVersion: int,
  updatedAtMs: int,
  why: z.enum(['pending', 'reported', 'both']),
  reports: z.object({
    total: int,
    byReason: z.record(z.string().max(40), int),
    notes: z.array(z.string().max(200)).max(3),
  }),
});
export type QueueItem = z.infer<typeof queueItemSchema>;
export const queueResponseSchema = z.object({ items: z.array(queueItemSchema).max(50) });

export const reviewSchema = z.object({
  uid: z.string().min(1).max(128),
  rating: z.number().int().min(0).max(5),
  comment: z.string().max(500),
  authorName: z.string().max(60),
  status: z.enum(['visible', 'hidden']),
});
export type ModReview = z.infer<typeof reviewSchema>;
export const reviewsResponseSchema = z.object({ reviews: z.array(reviewSchema).max(50) });

export const statsSchema = z.object({ views: int, previews: int, installs: int, likes: int, ratings: int });
export type ListingStats = z.infer<typeof statsSchema>;

/** Decisions on a listing. The server re-checks every one of them. */
export type ModAction = 'approve' | 'reject' | 'suspend' | 'unsuspend' | 'feature' | 'unfeature';

export const ACTION_KEY: Record<ModAction, TranslationKey> = {
  approve: 'bazaar.mod.action.approve',
  reject: 'bazaar.mod.action.reject',
  suspend: 'bazaar.mod.action.suspend',
  unsuspend: 'bazaar.mod.action.unsuspend',
  feature: 'bazaar.mod.action.feature',
  unfeature: 'bazaar.mod.action.unfeature',
};

/**
 * What a moderator may do with a listing in its state. A maker's own unpublish is not undone here (approve
 * is only for listings waiting, rejected by the checks, or published and reported); a suspended listing can
 * only be lifted. On a published listing `approve` means "keep it": the server marks it reviewed and closes
 * its reports, and nothing else closes them but a decision (feature does not).
 */
export function actionsFor(item: Pick<QueueItem, 'status' | 'featured'>): ModAction[] {
  switch (item.status) {
    case 'pending_review': return ['approve', 'reject', 'suspend'];
    case 'rejected': return ['approve', 'suspend'];
    case 'published': return ['approve', item.featured ? 'unfeature' : 'feature', 'reject', 'suspend'];
    case 'unpublished': return ['suspend'];
    case 'suspended': return ['unsuspend'];
  }
}

/** The words on a decision button: approving a listing that is already live reads "Keep, reports reviewed". */
export const actionKeyFor = (action: ModAction, item: Pick<QueueItem, 'status'>): TranslationKey =>
  action === 'approve' && item.status === 'published' ? 'bazaar.mod.action.keep' : ACTION_KEY[action];

/** The usual reason for a decision, saved when the moderator did not pick one. Hiding a review defaults to `quality`. */
export function defaultReason(action: ModAction | 'hide_review' | 'show_review'): ReasonCode {
  switch (action) {
    case 'approve': return 'policy_ok';
    case 'suspend': return 'harmful';
    case 'unsuspend': return 'policy_ok';
    case 'show_review': return 'policy_ok';
    default: return 'quality';
  }
}

/** The reason that goes into the audit log: the one the moderator picked, otherwise the usual one for the decision. */
export const reasonFor = (picked: ReasonCode | null, action: ModAction | 'hide_review' | 'show_review'): ReasonCode =>
  picked ?? defaultReason(action);

export const NOTE_MAX = 500;

/** Rejecting tells the maker what to change, so it needs words. */
export function noteProblem(action: ModAction, note: string): 'required' | 'tooLong' | null {
  if (note.length > NOTE_MAX) return 'tooLong';
  if (action === 'reject' && note.trim().length < 5) return 'required';
  return null;
}

export const STATUS_KEY: Record<QueueItem['status'], TranslationKey> = {
  pending_review: 'bazaar.status.waiting',
  published: 'bazaar.status.passed',
  rejected: 'bazaar.status.rejected',
  unpublished: 'bazaar.status.unpublished',
  suspended: 'bazaar.status.suspended',
};
export const statusKeyFor = (i: Pick<QueueItem, 'status' | 'reviewed'>): TranslationKey =>
  i.status === 'published' && i.reviewed ? 'bazaar.status.reviewed' : STATUS_KEY[i.status];

/** The stamp for a listing's state: a listing that passed is Checked, anything waiting or stopped Needs check. */
export const stampFor = (i: Pick<QueueItem, 'status'>): 'checked' | 'needs' | 'plain' =>
  i.status === 'published' ? 'checked' : i.status === 'unpublished' ? 'plain' : 'needs';

/** The slip tint says why a listing is in the queue: waiting for a first review, reported, or both. */
export const tintFor = (i: Pick<QueueItem, 'why'>): 'haldi' | 'kraft' | 'violet' =>
  i.why === 'pending' ? 'haldi' : i.why === 'reported' ? 'kraft' : 'violet';

export const SAFETY_KEY = (verdict: string): TranslationKey =>
  verdict === 'pass' ? 'bazaar.mod.safety.pass' : verdict === 'flagged' ? 'bazaar.mod.safety.flagged' : 'bazaar.mod.safety.unavailable';

export type QueueFilter = 'all' | 'pending' | 'reported';
export function filterQueue(items: readonly QueueItem[], filter: QueueFilter): QueueItem[] {
  return items.filter((i) => filter === 'all' || (filter === 'pending' ? i.why !== 'reported' : i.reports.total > 0));
}

/** The custom claim the owner sets with the Admin SDK. The server checks it again on every call. */
export const isModeratorClaims = (claims: Record<string, unknown> | undefined): boolean => claims?.kalamModerator === true;

export type ModErrorKind = 'offline' | 'denied' | 'signIn' | 'notDeployed' | 'gone' | 'failed';
export const ERROR_KEY: Record<ModErrorKind, TranslationKey> = {
  offline: 'bazaar.mod.error.offline',
  denied: 'bazaar.mod.error.denied',
  signIn: 'bazaar.mod.error.signIn',
  notDeployed: 'bazaar.mod.error.notDeployed',
  gone: 'bazaar.mod.error.gone',
  failed: 'bazaar.mod.error.failed',
};

/** Maps the code from `callBazaar` (the server's `kalamCode` or the Firebase error code) to one of our messages. */
export function errorKind(code: string | undefined): ModErrorKind {
  switch (code) {
    case 'functions/permission-denied': return 'denied';
    case 'functions/unauthenticated': return 'signIn';
    case 'functions/not-found': return 'notDeployed';
    case 'functions/unavailable': case 'functions/deadline-exceeded': return 'offline';
    case 'not_found': return 'gone';
    default: return 'failed';
  }
}
