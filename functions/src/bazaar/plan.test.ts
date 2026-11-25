import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  moderationRequestSchema, openWallet, planListingModeration, planPurchase, planRecount, planReversal, purchaseIdFor,
  purchaseRequestSchema, STARTING_CREDITS, type ListingState,
} from './plan.js';

const listing = (o: Partial<ListingState> = {}): ListingState => ({
  status: 'published', price: 30, makerUid: 'alice', specVersion: 2, installs: 4, safetyVerdict: 'pass',
  safetySpecHash: 'h', specHash: 'h', ...o,
});
const buy = (o: Partial<Parameters<typeof planPurchase>[0]> = {}) => planPurchase({
  listing: listing(), buyerUid: 'bob', listingId: 'lx', expectedPrice: 30, entitlement: null, buyerWallet: null, sellerWallet: null, ...o,
});

test('purchase: new wallets start with the grant; exact price moves from buyer to maker', () => {
  const r = buy();
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.buyer.credits, STARTING_CREDITS - 30);
  assert.equal(r.value.seller.credits, STARTING_CREDITS + 30);
  assert.equal(r.value.buyerGranted, true);
  assert.equal(r.value.purchaseId, purchaseIdFor('bob', 'lx'));
  assert.equal(r.value.installedVersion, 2);
});

test('purchase: refuses self-purchase, free, hidden, missing, changed price and low balance', () => {
  assert.deepEqual(buy({ buyerUid: 'alice' }), { ok: false, code: 'own_listing' });
  assert.deepEqual(buy({ listing: listing({ price: 0 }), expectedPrice: 0 }), { ok: false, code: 'free' });
  assert.deepEqual(buy({ listing: listing({ status: 'suspended' }) }), { ok: false, code: 'not_published' });
  assert.deepEqual(buy({ listing: null }), { ok: false, code: 'not_found' });
  assert.deepEqual(buy({ expectedPrice: 10 }), { ok: false, code: 'price_changed' });
  assert.deepEqual(buy({ buyerWallet: { credits: 29, version: 3 } }), { ok: false, code: 'insufficient' });
});

test('purchase: a replay finds the first purchase and charges nothing', () => {
  const r = buy({ entitlement: { status: 'active', pricePaid: 30, sellerUid: 'alice', purchaseId: 'p_bob_lx' }, buyerWallet: { credits: 70, version: 2 } });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.alreadyOwned, true);
  assert.equal(r.value.buyer.credits, 70);
});

test('reversal: new entries, never below zero, never twice', () => {
  const e = { status: 'active', pricePaid: 30, sellerUid: 'alice', purchaseId: 'p_bob_lx' };
  const r = planReversal({ entitlement: e, buyerWallet: { credits: 70, version: 2 }, sellerWallet: { credits: 130, version: 2 } });
  assert.deepEqual(r, { ok: true, value: { amount: 30, buyer: { credits: 100, version: 3 }, seller: { credits: 100, version: 3 } } });
  assert.deepEqual(planReversal({ entitlement: { ...e, status: 'reversed' }, buyerWallet: null, sellerWallet: null }), { ok: false, code: 'already_reversed' });
  assert.deepEqual(planReversal({ entitlement: e, buyerWallet: null, sellerWallet: { credits: 10, version: 1 } }), { ok: false, code: 'seller_balance_low' });
  assert.deepEqual(planReversal({ entitlement: { ...e, pricePaid: 0 }, buyerWallet: null, sellerWallet: null }), { ok: false, code: 'not_purchased' });
});

test('moderation: approve sets the trusted badge, suspend clears featuring, unsuspend respects the check', () => {
  assert.deepEqual(planListingModeration('approve', listing(), ''), { status: 'published', reviewed: true });
  assert.deepEqual(planListingModeration('suspend', listing(), ''), { status: 'suspended', featured: false });
  assert.deepEqual(planListingModeration('unsuspend', listing({ safetyVerdict: 'unavailable' }), ''), { status: 'pending_review' });
  assert.equal(planListingModeration('feature', listing({ status: 'rejected' }), ''), null);
  const reject = planListingModeration('request_changes', listing(), 'Remove the medical claims.');
  assert.deepEqual(reject?.['safety.reasons'], ['Remove the medical claims.']);
});

test('recount and request shapes', () => {
  assert.deepEqual(planRecount({ activeEntitlements: 3, likes: 2, visibleRatings: [5, 4, 5] }), { installs: 3, likes: 2, ratingSum: 14, ratingCount: 3, ratingAvg: 4.7 });
  assert.equal(moderationRequestSchema.safeParse({ action: 'approve', listingId: 'labcdefghij012345678', reasonCode: 'policy_ok' }).success, true);
  assert.equal(moderationRequestSchema.safeParse({ action: 'delete_everything', listingId: 'labcdefghij012345678', reasonCode: 'other' }).success, false);
  assert.equal(purchaseRequestSchema.safeParse({ listingId: 'labcdefghij012345678', expectedPrice: -5 }).success, false);
  assert.deepEqual(openWallet(null), { wallet: { credits: STARTING_CREDITS, version: 1 }, granted: true });
});
