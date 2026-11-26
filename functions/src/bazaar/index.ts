/**
 * Kalam Bazaar trusted functions (docs/12 §12, §14.5, §17.6, §18.4, §20.2). They are the only
 * writers of wallets, the credit ledger, paid entitlements, `reviewed`, `featured`, `suspended`,
 * hidden reviews, recounted totals and the moderation log; firestore.rules denies all of those to
 * clients. Data lives in the named database `kalam` (the project is shared with another app).
 *
 * Every callable enforces App Check and Firebase Auth. Moderation needs the custom claim
 * `kalamModerator: true` (set by the owner with the Admin SDK; never from the client).
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/https';
import { createRateLimiter } from '../rate-limit.js';
import {
  buildQueue, countRequestSchema, listingIdSchema, listRequestSchema, reviewsView, statsRequestSchema, statsView,
  type ListingRow, type LogRow, type ReportRow,
} from './moderation-queue.js';
import {
  grantIdFor, moderationRequestSchema, openWallet, PLAN_MESSAGES, planListingModeration, planPurchase, planRecount,
  planReversal, purchaseRequestSchema, STARTING_CREDITS, type EntitlementState, type ListingState, type PlanError,
  type WalletState,
} from './plan.js';

const DATABASE_ID = 'kalam';
const db = () => getFirestore(getApps()[0] ?? initializeApp(), DATABASE_ID);
const OPTIONS = { enforceAppCheck: true, maxInstances: 3, timeoutSeconds: 30, memory: '256MiB' as const };

const HTTPS: Record<PlanError, 'not-found' | 'failed-precondition' | 'invalid-argument'> = {
  not_found: 'not-found', not_published: 'failed-precondition', free: 'failed-precondition', own_listing: 'failed-precondition',
  price_changed: 'failed-precondition', insufficient: 'failed-precondition', not_purchased: 'not-found',
  already_reversed: 'failed-precondition', seller_balance_low: 'failed-precondition', bad_request: 'invalid-argument',
};
const fail = (code: PlanError): never => {
  throw new HttpsError(HTTPS[code], PLAN_MESSAGES[code], { kalamCode: code });
};

/** A full account (not a guest) for anything involving credits (docs/12 §12). */
function requireAccount(request: CallableRequest): string {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in to use credits.');
  if (auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'Guest accounts cannot use credits. Add an email first.');
  }
  return auth.uid;
}
function requireModerator(request: CallableRequest): string {
  const uid = requireAccount(request);
  if (request.auth?.token.kalamModerator !== true) throw new HttpsError('permission-denied', 'Only Kalam moderators can do this.');
  return uid;
}

const asWallet = (d: DocumentData | undefined): WalletState | null =>
  d ? { credits: Number(d.credits) || 0, version: Number(d.version) || 0 } : null;
const asListing = (d: DocumentData | undefined): ListingState | null =>
  d ? {
    status: String(d.status), price: Number(d.price) || 0, makerUid: String(d.makerUid), specVersion: Number(d.specVersion) || 1,
    installs: Number(d.installs) || 0, safetyVerdict: String(d.safety?.verdict ?? ''), safetySpecHash: String(d.safety?.specHash ?? ''),
    specHash: String(d.specHash ?? ''),
  } : null;
const asEntitlement = (d: DocumentData | undefined): EntitlementState | null =>
  d ? { status: String(d.status), pricePaid: Number(d.pricePaid) || 0, sellerUid: String(d.sellerUid), purchaseId: d.purchaseId ? String(d.purchaseId) : undefined } : null;

function writeWallet(tx: Transaction, uid: string, wallet: WalletState, granted: boolean): void {
  const ref = db().collection('wallets').doc(uid);
  tx.set(ref, { credits: wallet.credits, currency: 'credits', version: wallet.version, updatedAt: FieldValue.serverTimestamp() });
  if (granted) {
    tx.set(db().collection('walletTransactions').doc(grantIdFor(uid)), {
      type: 'grant', buyerUid: uid, sellerUid: null, listingId: null, amount: STARTING_CREDITS, currency: 'credits',
      status: 'completed', purchaseId: null, createdAt: FieldValue.serverTimestamp(),
    });
  }
}

/** Opens the caller's wallet with the starting credits if it does not exist yet. */
export const kalamBazaarWallet = onCall(OPTIONS, async (request) => {
  const uid = requireAccount(request);
  return db().runTransaction(async (tx) => {
    const ref = db().collection('wallets').doc(uid);
    const existing = asWallet((await tx.get(ref)).data());
    const { wallet, granted } = openWallet(existing);
    if (granted) writeWallet(tx, uid, wallet, true);
    return { credits: wallet.credits, version: wallet.version, created: granted };
  });
});

/** Buys a paid listing with credits: entitlement, both wallets, ledger and install count in one transaction. */
export const kalamBazaarPurchase = onCall(OPTIONS, async (request) => {
  const uid = requireAccount(request);
  const parsed = purchaseRequestSchema.safeParse(request.data);
  if (!parsed.success) return fail('bad_request');
  const { listingId, expectedPrice } = parsed.data;
  const started = Date.now();
  const result = await db().runTransaction(async (tx) => {
    const listingRef = db().collection('listings').doc(listingId);
    const entitlementRef = db().collection('users').doc(uid).collection('purchases').doc(listingId);
    const listing = asListing((await tx.get(listingRef)).data());
    const sellerUid = listing?.makerUid ?? '';
    const [entitlementSnap, buyerSnap, sellerSnap] = await Promise.all([
      tx.get(entitlementRef),
      tx.get(db().collection('wallets').doc(uid)),
      sellerUid ? tx.get(db().collection('wallets').doc(sellerUid)) : Promise.resolve(undefined),
    ]);
    const plan = planPurchase({
      listing, buyerUid: uid, listingId, expectedPrice, entitlement: asEntitlement(entitlementSnap.data()),
      buyerWallet: asWallet(buyerSnap.data()), sellerWallet: asWallet(sellerSnap?.data()),
    });
    if (!plan.ok) return fail(plan.code);
    const p = plan.value;
    if (p.alreadyOwned) return { purchaseId: p.purchaseId, alreadyOwned: true, credits: p.buyer.credits };
    tx.set(entitlementRef, {
      listingId, sellerUid, pricePaid: p.price, currency: 'credits', installedVersion: p.installedVersion,
      purchasedAt: FieldValue.serverTimestamp(), status: 'active', purchaseId: p.purchaseId,
    });
    writeWallet(tx, uid, p.buyer, p.buyerGranted);
    writeWallet(tx, sellerUid, p.seller, p.sellerGranted);
    tx.set(db().collection('walletTransactions').doc(p.purchaseId), {
      type: 'purchase', buyerUid: uid, sellerUid, listingId, amount: p.price, currency: 'credits', status: 'completed',
      purchaseId: p.purchaseId, createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(listingRef, { installs: FieldValue.increment(1) });
    return { purchaseId: p.purchaseId, alreadyOwned: false, credits: p.buyer.credits };
  });
  // Content-free usage log: ids and amounts only.
  logger.info('kalam_bazaar_purchase', { listingId, alreadyOwned: result.alreadyOwned, latencyMs: Date.now() - started });
  return result;
});

/** Moderation with an audit entry for every decision (docs/12 §18.4). */
export const kalamBazaarModerate = onCall(OPTIONS, async (request) => {
  const moderatorUid = requireModerator(request);
  const parsed = moderationRequestSchema.safeParse(request.data);
  if (!parsed.success) return fail('bad_request');
  const req = parsed.data;
  await db().runTransaction(async (tx) => {
    const listingRef = db().collection('listings').doc(req.listingId);
    const listing = asListing((await tx.get(listingRef)).data());
    if (!listing) return fail('not_found');

    if (req.action === 'hide_review' || req.action === 'show_review') {
      if (!req.targetUid) return fail('bad_request');
      const reviewRef = listingRef.collection('reviews').doc(req.targetUid);
      if (!(await tx.get(reviewRef)).exists) return fail('not_found');
      tx.update(reviewRef, { status: req.action === 'hide_review' ? 'hidden' : 'visible' });
    } else if (req.action === 'reverse_purchase') {
      if (!req.targetUid) return fail('bad_request');
      const entitlementRef = db().collection('users').doc(req.targetUid).collection('purchases').doc(req.listingId);
      const entitlement = asEntitlement((await tx.get(entitlementRef)).data());
      const [buyerSnap, sellerSnap] = await Promise.all([
        tx.get(db().collection('wallets').doc(req.targetUid)),
        tx.get(db().collection('wallets').doc(entitlement?.sellerUid || listing.makerUid)),
      ]);
      const plan = planReversal({ entitlement, buyerWallet: asWallet(buyerSnap.data()), sellerWallet: asWallet(sellerSnap.data()) });
      if (!plan.ok) return fail(plan.code);
      const purchaseId = entitlement?.purchaseId ?? '';
      tx.update(entitlementRef, { status: 'reversed' });
      writeWallet(tx, req.targetUid, plan.value.buyer, false);
      writeWallet(tx, entitlement?.sellerUid || listing.makerUid, plan.value.seller, false);
      tx.update(db().collection('walletTransactions').doc(purchaseId), { status: 'reversed' });
      tx.set(db().collection('walletTransactions').doc(`r_${purchaseId}`), {
        type: 'reversal', buyerUid: req.targetUid, sellerUid: entitlement?.sellerUid || listing.makerUid, listingId: req.listingId,
        amount: plan.value.amount, currency: 'credits', status: 'completed', purchaseId, createdAt: FieldValue.serverTimestamp(),
      });
    } else if (req.action === 'recount') {
      const [installs, likes, reviews] = await Promise.all([
        tx.get(db().collectionGroup('purchases').where('listingId', '==', req.listingId).where('status', '==', 'active').count()),
        tx.get(listingRef.collection('likes').count()),
        tx.get(listingRef.collection('reviews').where('status', '==', 'visible')),
      ]);
      tx.update(listingRef, planRecount({
        activeEntitlements: installs.data().count,
        likes: likes.data().count,
        visibleRatings: reviews.docs.map((d) => Number(d.get('rating')) || 0),
      }));
    } else {
      const patch = planListingModeration(req.action, listing, req.note);
      if (patch) tx.update(listingRef, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    }

    tx.set(db().collection('moderationLog').doc(), {
      action: req.action, listingId: req.listingId, targetUid: req.targetUid ?? null, reasonCode: req.reasonCode,
      note: req.note, moderatorUid, createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

// ─── Moderator reads, anonymous listing counters and creator numbers (docs/12 §14.5, §18.2, §21) ──────────

const millisOf = (v: unknown): number =>
  v && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis(): number }).toMillis() : 0;
const toRow = (id: string, d: DocumentData): ListingRow => ({
  id, title: String(d.title ?? ''), makerName: String(d.makerName ?? ''), status: String(d.status ?? ''),
  price: Number(d.price) || 0, reviewed: d.reviewed === true, featured: d.featured === true,
  safetyVerdict: String(d.safety?.verdict ?? ''), safetyReasons: Array.isArray(d.safety?.reasons) ? d.safety.reasons.map(String) : [],
  specVersion: Number(d.specVersion) || 1, updatedAtMs: millisOf(d.updatedAt),
});

/**
 * Read-only moderator views. Reports and the moderation log are closed to every client (firestore.rules),
 * so this is the only way a moderator sees them. A report is returned without its sender.
 */
export const kalamBazaarModerationList = onCall(OPTIONS, async (request) => {
  requireModerator(request);
  const parsed = listRequestSchema.safeParse(request.data);
  if (!parsed.success) return fail('bad_request');
  const req = parsed.data;
  if (req.kind === 'reviews') {
    const snap = await db().collection('listings').doc(req.listingId).collection('reviews').orderBy('createdAt', 'desc').limit(50).get();
    return {
      reviews: reviewsView(snap.docs.map((d) => ({
        uid: d.id, rating: d.get('rating'), comment: d.get('comment'), authorName: d.get('authorName'), status: d.get('status'),
      }))),
    };
  }
  // ponytail: newest 300 reports and 300 decisions, no pagination. Page them if the queue outgrows that.
  const [pending, reports, log] = await Promise.all([
    db().collection('listings').where('status', '==', 'pending_review').limit(100).get(),
    db().collection('reports').orderBy('createdAt', 'desc').limit(300).get(),
    db().collection('moderationLog').orderBy('createdAt', 'desc').limit(300).get(),
  ]);
  const reportRows: ReportRow[] = reports.docs.flatMap((d) => {
    const listingId = d.get('listingId');
    return listingIdSchema.safeParse(listingId).success
      ? [{ listingId: String(listingId), reason: String(d.get('reason') ?? ''), note: String(d.get('note') ?? ''), createdAtMs: millisOf(d.get('createdAt')) }]
      : [];
  });
  const logRows: LogRow[] = log.docs.map((d) => ({ listingId: String(d.get('listingId') ?? ''), action: String(d.get('action') ?? ''), createdAtMs: millisOf(d.get('createdAt')) }));
  const have = new Set(pending.docs.map((d) => d.id));
  const reportedIds = [...new Set(reportRows.map((r) => r.listingId))].filter((id) => !have.has(id)).slice(0, 100);
  const reported = reportedIds.length ? await db().getAll(...reportedIds.map((id) => db().collection('listings').doc(id))) : [];
  const listings = [...pending.docs, ...reported.filter((d) => d.exists)].map((d) => toRow(d.id, d.data() ?? {}));
  const items = buildQueue({ listings, reports: reportRows, log: logRows });
  logger.info('kalam_bazaar_moderation_list', { kind: 'queue', items: items.length });
  return { items };
});

/** Abuse limits, per instance (maxInstances caps the total): one count per client, listing and kind each ten minutes. */
const countOnce = createRateLimiter({ windowMs: 10 * 60_000, maxPerWindow: 1, maxKeys: 5_000 });
const countAny = createRateLimiter({ windowMs: 10 * 60_000, maxPerWindow: 60, maxKeys: 5_000 });

/**
 * One anonymous count for a published listing: a page view or a preview start (docs/12 §21). It stores a
 * number and nothing else: no uid, no address, no record, no prompt. The client sends it only after the
 * person chose to share counts. Browsing needs no account, so a signed-out caller is fine (App Check applies).
 */
export const kalamBazaarCount = onCall(OPTIONS, async (request) => {
  const parsed = countRequestSchema.safeParse(request.data);
  if (!parsed.success) return fail('bad_request');
  const { listingId, kind } = parsed.data;
  const client = request.rawRequest.ip ?? 'unknown';
  // ponytail: per-instance and per-address, so a shared network undercounts. Counts are approximate by design.
  if (countAny.limited(client) || countOnce.limited(`${client}:${listingId}:${kind}`)) return { counted: false };
  const listing = (await db().collection('listings').doc(listingId).get()).data();
  if (!listing || listing.status !== 'published' || listing.makerUid === request.auth?.uid) return { counted: false };
  await db().collection('listingStats').doc(listingId).set(
    { [kind === 'view' ? 'views' : 'previews']: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  logger.info('kalam_bazaar_count', { kind });
  return { counted: true };
});

/** A maker's own numbers (docs/12 §13.1, §21): counters only, never who looked. */
export const kalamBazaarStats = onCall(OPTIONS, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to see the numbers for your apps.');
  const parsed = statsRequestSchema.safeParse(request.data);
  if (!parsed.success) return fail('bad_request');
  const [listingSnap, statsSnap] = await Promise.all([
    db().collection('listings').doc(parsed.data.listingId).get(),
    db().collection('listingStats').doc(parsed.data.listingId).get(),
  ]);
  const listing = listingSnap.data();
  // One answer for "not yours" and "does not exist", so the call cannot be used to probe for listing ids.
  if (!listing || listing.makerUid !== uid) throw new HttpsError('permission-denied', 'You can only see the numbers for your own apps.');
  return statsView(statsSnap.data(), listing);
});
