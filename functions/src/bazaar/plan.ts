/**
 * Kalam Bazaar trusted operations, as pure plans (docs/12 §12, §14.5, §17.6, §18.4, §20.2).
 * The callables in ./index.ts read the documents inside a Firestore transaction, call these
 * functions, and write exactly what they return. Keeping the decisions pure makes every rule
 * (no negative balances, no self-purchase, no replay, exact price) testable without a server.
 */
import { z } from 'zod';

export const STARTING_CREDITS = 100;
export const MAX_PRICE = 1000;

export interface ListingState {
  status: string;
  price: number;
  makerUid: string;
  specVersion: number;
  installs: number;
  safetyVerdict: string;
  safetySpecHash: string;
  specHash: string;
}
export interface WalletState { credits: number; version: number }
export interface EntitlementState { status: string; pricePaid: number; sellerUid: string; purchaseId?: string }

export type PlanError =
  | 'not_found' | 'not_published' | 'free' | 'own_listing' | 'price_changed' | 'insufficient' | 'not_purchased'
  | 'already_reversed' | 'seller_balance_low' | 'bad_request';

export const PLAN_MESSAGES: Record<PlanError, string> = {
  not_found: 'This app is no longer in Kalam Bazaar.',
  not_published: 'This app is not available right now.',
  free: 'This app is free. Install it directly.',
  own_listing: 'This is your own app. You can install it without buying it.',
  price_changed: 'The price changed. Check the new price and try again.',
  insufficient: 'You do not have enough credits for this app.',
  not_purchased: 'There is no purchase to reverse.',
  already_reversed: 'This purchase was already reversed.',
  seller_balance_low: 'The maker does not have enough credits to reverse this purchase. Handle it by hand.',
  bad_request: 'The request was not valid.',
};

export type Plan<T> = { ok: true; value: T } | { ok: false; code: PlanError };

export const purchaseIdFor = (buyerUid: string, listingId: string) => `p_${buyerUid}_${listingId}`;
export const grantIdFor = (uid: string) => `grant_${uid}`;

/** A wallet that does not exist yet starts with the prototype grant (docs/12 §12.4). */
export function openWallet(existing: WalletState | null): { wallet: WalletState; granted: boolean } {
  return existing ? { wallet: existing, granted: false } : { wallet: { credits: STARTING_CREDITS, version: 1 }, granted: true };
}

export interface PurchasePlan {
  purchaseId: string;
  alreadyOwned: boolean;
  buyer: WalletState;
  seller: WalletState;
  buyerGranted: boolean;
  sellerGranted: boolean;
  price: number;
  installedVersion: number;
}

/**
 * One atomic purchase (docs/12 §12.6): exact listed price, enough credits, no self-purchase, no
 * duplicate (the purchase id is derived from buyer + listing, so a replay finds the first one).
 */
export function planPurchase(input: {
  listing: ListingState | null;
  buyerUid: string;
  listingId: string;
  expectedPrice: number;
  entitlement: EntitlementState | null;
  buyerWallet: WalletState | null;
  sellerWallet: WalletState | null;
}): Plan<PurchasePlan> {
  const { listing } = input;
  if (!listing) return { ok: false, code: 'not_found' };
  if (listing.status !== 'published') return { ok: false, code: 'not_published' };
  if (listing.price === 0) return { ok: false, code: 'free' };
  if (listing.makerUid === input.buyerUid) return { ok: false, code: 'own_listing' };
  if (input.expectedPrice !== listing.price) return { ok: false, code: 'price_changed' };
  const purchaseId = purchaseIdFor(input.buyerUid, input.listingId);
  const buyer = openWallet(input.buyerWallet);
  const seller = openWallet(input.sellerWallet);
  if (input.entitlement?.status === 'active') {
    return {
      ok: true,
      value: {
        purchaseId, alreadyOwned: true, buyer: buyer.wallet, seller: seller.wallet, buyerGranted: false, sellerGranted: false,
        price: 0, installedVersion: listing.specVersion,
      },
    };
  }
  if (buyer.wallet.credits < listing.price) return { ok: false, code: 'insufficient' };
  return {
    ok: true,
    value: {
      purchaseId,
      alreadyOwned: false,
      buyer: { credits: buyer.wallet.credits - listing.price, version: buyer.wallet.version + 1 },
      seller: { credits: seller.wallet.credits + listing.price, version: seller.wallet.version + 1 },
      buyerGranted: buyer.granted,
      sellerGranted: seller.granted,
      price: listing.price,
      installedVersion: listing.specVersion,
    },
  };
}

/** Refund as new ledger entries, never by rewriting history (docs/12 §12.7). */
export function planReversal(input: {
  entitlement: EntitlementState | null;
  buyerWallet: WalletState | null;
  sellerWallet: WalletState | null;
}): Plan<{ buyer: WalletState; seller: WalletState; amount: number }> {
  const e = input.entitlement;
  if (!e || !e.purchaseId || e.pricePaid <= 0) return { ok: false, code: 'not_purchased' };
  if (e.status === 'reversed') return { ok: false, code: 'already_reversed' };
  const buyer = openWallet(input.buyerWallet).wallet;
  const seller = openWallet(input.sellerWallet).wallet;
  if (seller.credits < e.pricePaid) return { ok: false, code: 'seller_balance_low' };
  return {
    ok: true,
    value: {
      amount: e.pricePaid,
      buyer: { credits: buyer.credits + e.pricePaid, version: buyer.version + 1 },
      seller: { credits: seller.credits - e.pricePaid, version: seller.version + 1 },
    },
  };
}

export const MODERATION_ACTIONS = [
  'approve', 'reject', 'request_changes', 'suspend', 'unsuspend', 'feature', 'unfeature', 'hide_review', 'show_review',
  'reverse_purchase', 'recount',
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/** Reason codes keep the audit log searchable (docs/12 §18.4). */
export const REASON_CODES = [
  'policy_ok', 'misleading', 'harmful', 'privacy', 'copyright', 'spam', 'broken', 'quality', 'dispute', 'other',
] as const;

export const moderationRequestSchema = z.object({
  action: z.enum(MODERATION_ACTIONS),
  listingId: z.string().regex(/^l[a-z0-9]{19}$/),
  reasonCode: z.enum(REASON_CODES),
  note: z.string().max(500).default(''),
  /** hide_review / show_review: the reviewer; reverse_purchase: the buyer. */
  targetUid: z.string().min(1).max(128).optional(),
}).strict();
export type ModerationRequest = z.infer<typeof moderationRequestSchema>;

export const purchaseRequestSchema = z.object({
  listingId: z.string().regex(/^l[a-z0-9]{19}$/),
  expectedPrice: z.number().int().min(0).max(MAX_PRICE),
}).strict();

/** Listing fields a moderation action changes. `null` = the action does not touch the listing. */
export function planListingModeration(action: ModerationAction, listing: ListingState, note: string): Record<string, unknown> | null {
  const passing = listing.safetyVerdict === 'pass' && listing.safetySpecHash === listing.specHash;
  switch (action) {
    case 'approve': return { status: 'published', reviewed: true };
    case 'reject':
    case 'request_changes':
      return {
        status: 'rejected',
        reviewed: false,
        'safety.verdict': 'flagged',
        'safety.reasons': [note.trim() || 'A reviewer asked for changes.'].map((r) => r.slice(0, 200)),
      };
    case 'suspend': return { status: 'suspended', featured: false };
    case 'unsuspend': return { status: passing ? 'published' : 'pending_review' };
    case 'feature': return listing.status === 'published' ? { featured: true } : null;
    case 'unfeature': return { featured: false };
    default: return null;
  }
}

/** Totals recomputed from the source documents (docs/12 §20.2 counter integrity). */
export function planRecount(input: { activeEntitlements: number; likes: number; visibleRatings: number[] }) {
  const ratingSum = input.visibleRatings.reduce((a, b) => a + b, 0);
  const ratingCount = input.visibleRatings.length;
  return {
    installs: input.activeEntitlements,
    likes: input.likes,
    ratingSum,
    ratingCount,
    ratingAvg: ratingCount === 0 ? 0 : Math.round((ratingSum * 10) / ratingCount) / 10,
  };
}
