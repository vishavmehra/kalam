/**
 * Kalam Cloud Functions on the Auth, Firestore and Functions emulators: the Bazaar wallet and an end-to-end paid
 * purchase (docs/12 §12, §22.2; docs/13 §10.1). The real compiled functions (functions/lib) run against real
 * Firestore documents in the named database "kalam". Nothing is mocked except the App Check token, which the
 * emulator cannot verify. The payments flag in the app stays off until this suite passes against the deployed build.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { callFunction, listingId, readDocument, seedDocument, signUp, signUpAnonymous, withClaims, type Session } from './emulator';

const PAID = listingId('paid-one');
const FREE = listingId('free-one');
const PRICE = 30;

let seller: Session;
let buyer: Session;
let broke: Session;
let moderator: Session;

async function seedListing(id: string, makerUid: string, price: number, status = 'published') {
  await seedDocument(`listings/${id}`, {
    title: 'Fee tracker',
    makerUid,
    makerName: 'Maker',
    status,
    price,
    specVersion: 1,
    installs: 0,
    specHash: 'h1',
    safety: { verdict: 'pass', specHash: 'h1', reasons: [] },
  });
}

beforeAll(async () => {
  [seller, buyer, broke] = await Promise.all([signUp('seller'), signUp('buyer'), signUp('broke')]);
  moderator = await withClaims(await signUp('moderator'), { kalamModerator: true });
  await seedListing(PAID, seller.uid, PRICE);
  await seedListing(FREE, seller.uid, 0);
});

describe('the wallet', () => {
  it('opens with 100 credits and writes the grant to the ledger exactly once', async () => {
    const first = await callFunction('kalamBazaarWallet', {}, buyer);
    expect(first.ok, JSON.stringify(first.error)).toBe(true);
    expect(first.result).toMatchObject({ credits: 100, version: 1, created: true });

    const again = await callFunction('kalamBazaarWallet', {}, buyer);
    expect(again.result).toMatchObject({ credits: 100, created: false });

    expect(await readDocument(`wallets/${buyer.uid}`)).toMatchObject({ credits: 100, currency: 'credits' });
    expect(await readDocument(`walletTransactions/grant_${buyer.uid}`)).toMatchObject({ type: 'grant', amount: 100, buyerUid: buyer.uid });
  });

  it('refuses a call with no account, with a guest session, and with no App Check token', async () => {
    const signedOut = await callFunction('kalamBazaarWallet', {});
    expect(signedOut.error).toMatchObject({ status: 'UNAUTHENTICATED', message: 'Sign in to use credits.' });

    const guest = await callFunction('kalamBazaarWallet', {}, await signUpAnonymous());
    expect(guest.error?.status).toBe('PERMISSION_DENIED');

    const noToken = await callFunction('kalamBazaarWallet', {}, buyer, { appCheck: false });
    expect(noToken.ok).toBe(false);
    expect(noToken.error?.status).toBe('UNAUTHENTICATED');
  });
});

describe('a paid purchase, end to end', () => {
  it('moves credits, writes the entitlement and the ledger, and counts one install, all in one step', async () => {
    const r = await callFunction('kalamBazaarPurchase', { listingId: PAID, expectedPrice: PRICE }, buyer);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.result).toMatchObject({ alreadyOwned: false, credits: 100 - PRICE });
    const purchaseId = `p_${buyer.uid}_${PAID}`;
    expect(r.result.purchaseId).toBe(purchaseId);

    expect(await readDocument(`wallets/${buyer.uid}`)).toMatchObject({ credits: 70, version: 2 });
    // The seller had no wallet: it opens with the grant, then receives the price.
    expect(await readDocument(`wallets/${seller.uid}`)).toMatchObject({ credits: 130, version: 2 });
    expect(await readDocument(`users/${buyer.uid}/purchases/${PAID}`)).toMatchObject({
      status: 'active',
      pricePaid: PRICE,
      sellerUid: seller.uid,
      purchaseId,
      installedVersion: 1,
    });
    expect(await readDocument(`walletTransactions/${purchaseId}`)).toMatchObject({
      type: 'purchase',
      amount: PRICE,
      buyerUid: buyer.uid,
      sellerUid: seller.uid,
      status: 'completed',
    });
    expect(await readDocument(`listings/${PAID}`)).toMatchObject({ installs: 1 });
  });

  it('is safe to repeat: a second purchase changes nothing and charges nothing', async () => {
    const r = await callFunction('kalamBazaarPurchase', { listingId: PAID, expectedPrice: PRICE }, buyer);
    expect(r.result).toMatchObject({ alreadyOwned: true, credits: 70 });
    expect(await readDocument(`wallets/${buyer.uid}`)).toMatchObject({ credits: 70, version: 2 });
    expect(await readDocument(`listings/${PAID}`)).toMatchObject({ installs: 1 });
  });

  it('refuses the wrong price, your own app, a free app, an unknown app, no account and bad input', async () => {
    const wrongPrice = await callFunction('kalamBazaarPurchase', { listingId: PAID, expectedPrice: 5 }, broke);
    expect(wrongPrice.error).toMatchObject({ status: 'FAILED_PRECONDITION', message: 'The price changed. Check the new price and try again.' });

    const own = await callFunction('kalamBazaarPurchase', { listingId: PAID, expectedPrice: PRICE }, seller);
    expect(own.error?.message).toBe('This is your own app. You can install it without buying it.');

    const free = await callFunction('kalamBazaarPurchase', { listingId: FREE, expectedPrice: 0 }, broke);
    expect(free.error?.message).toBe('This app is free. Install it directly.');

    const unknown = await callFunction('kalamBazaarPurchase', { listingId: listingId('nothing'), expectedPrice: 10 }, broke);
    expect(unknown.error).toMatchObject({ status: 'NOT_FOUND' });

    const malformed = await callFunction('kalamBazaarPurchase', { listingId: 'x', expectedPrice: -1, extra: true }, broke);
    expect(malformed.error?.status).toBe('INVALID_ARGUMENT');

    const unsigned = await callFunction('kalamBazaarPurchase', { listingId: PAID, expectedPrice: PRICE });
    expect(unsigned.error?.status).toBe('UNAUTHENTICATED');

    // Nothing above moved a credit.
    expect(await readDocument(`wallets/${broke.uid}`)).toBeUndefined();
    expect(await readDocument(`wallets/${seller.uid}`)).toMatchObject({ credits: 130 });
  });

  it('never lets a balance go below zero', async () => {
    const dear = listingId('dear-one');
    await seedListing(dear, seller.uid, 900);
    // A new wallet opens with 100 credits, which is not enough for 900.
    const r = await callFunction('kalamBazaarPurchase', { listingId: dear, expectedPrice: 900 }, broke);
    expect(r.error).toMatchObject({ status: 'FAILED_PRECONDITION', message: 'You do not have enough credits for this app.' });
    expect(await readDocument(`users/${broke.uid}/purchases/${dear}`)).toBeUndefined();
    expect(await readDocument(`listings/${dear}`)).toMatchObject({ installs: 0 });
    expect(await readDocument(`wallets/${broke.uid}`)).toBeUndefined();
  });

  it('refuses a listing that is not published', async () => {
    const draft = listingId('draft-one');
    await seedListing(draft, seller.uid, 10, 'pending_review');
    const r = await callFunction('kalamBazaarPurchase', { listingId: draft, expectedPrice: 10 }, buyer);
    expect(r.error?.message).toBe('This app is not available right now.');
  });
});

describe('moderation and refunds', () => {
  it('refuses a refund from anyone without the moderator claim', async () => {
    const r = await callFunction('kalamBazaarModerate', { action: 'reverse_purchase', listingId: PAID, reasonCode: 'dispute', targetUid: buyer.uid }, buyer);
    expect(r.error).toMatchObject({ status: 'PERMISSION_DENIED', message: 'Only Kalam moderators can do this.' });
    const list = await callFunction('kalamBazaarModerationList', { kind: 'queue' }, seller);
    expect(list.error?.status).toBe('PERMISSION_DENIED');
    expect(await readDocument(`users/${buyer.uid}/purchases/${PAID}`)).toMatchObject({ status: 'active' });
  });

  it('a moderator refunds a purchase as new ledger entries, once, and the audit log records it', async () => {
    const purchaseId = `p_${buyer.uid}_${PAID}`;
    const r = await callFunction(
      'kalamBazaarModerate',
      { action: 'reverse_purchase', listingId: PAID, reasonCode: 'dispute', note: 'Test refund', targetUid: buyer.uid },
      moderator,
    );
    expect(r.ok, JSON.stringify(r.error)).toBe(true);

    expect(await readDocument(`wallets/${buyer.uid}`)).toMatchObject({ credits: 100 });
    expect(await readDocument(`wallets/${seller.uid}`)).toMatchObject({ credits: 100 });
    expect(await readDocument(`users/${buyer.uid}/purchases/${PAID}`)).toMatchObject({ status: 'reversed' });
    // History is never rewritten: the purchase stays, marked reversed, and a reversal entry is added.
    expect(await readDocument(`walletTransactions/${purchaseId}`)).toMatchObject({ type: 'purchase', status: 'reversed', amount: PRICE });
    expect(await readDocument(`walletTransactions/r_${purchaseId}`)).toMatchObject({
      type: 'reversal',
      amount: PRICE,
      buyerUid: buyer.uid,
      sellerUid: seller.uid,
    });

    const again = await callFunction(
      'kalamBazaarModerate',
      { action: 'reverse_purchase', listingId: PAID, reasonCode: 'dispute', targetUid: buyer.uid },
      moderator,
    );
    expect(again.error?.message).toBe('This purchase was already reversed.');
    expect(await readDocument(`wallets/${buyer.uid}`)).toMatchObject({ credits: 100 });
  });

  it('a moderator can read the queue; the answer carries no reporter identity', async () => {
    const r = await callFunction('kalamBazaarModerationList', { kind: 'queue' }, moderator);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(Array.isArray(r.result.items)).toBe(true);
    expect(JSON.stringify(r.result)).not.toMatch(/reporterUid|reportedBy/);
  });
});

describe('anonymous counters and maker numbers', () => {
  it('count a published listing once without an account, and store a number only', async () => {
    const id = listingId('counted-one');
    await seedListing(id, seller.uid, 0);
    const first = await callFunction('kalamBazaarCount', { listingId: id, kind: 'view' });
    expect(first.result).toEqual({ counted: true });
    const stats = await readDocument(`listingStats/${id}`);
    expect(stats).toMatchObject({ views: 1 });
    expect(Object.keys(stats ?? {}).sort()).toEqual(['updatedAt', 'views']);
    // The same client counting the same thing again inside ten minutes is not counted.
    expect((await callFunction('kalamBazaarCount', { listingId: id, kind: 'view' })).result).toEqual({ counted: false });
  });

  it('a maker sees the numbers for their own app and nobody else does', async () => {
    const own = await callFunction('kalamBazaarStats', { listingId: PAID }, seller);
    expect(own.ok, JSON.stringify(own.error)).toBe(true);
    const other = await callFunction('kalamBazaarStats', { listingId: PAID }, buyer);
    expect(other.error?.status).toBe('PERMISSION_DENIED');
    // The same answer as "not yours", so listing ids cannot be probed.
    const missing = await callFunction('kalamBazaarStats', { listingId: listingId('ghost') }, buyer);
    expect(missing.error?.status).toBe('PERMISSION_DENIED');
  });
});
