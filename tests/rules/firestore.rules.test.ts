/**
 * Emulator tests for firestore.rules (docs/12 §17.8, docs/11 §10.5): permitted AND denied paths.
 * Run with the Firestore emulator (see tests/rules/vitest.config.ts).
 */
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, increment, limit, query, serverTimestamp, setDoc, Timestamp, updateDoc,
  where, writeBatch, type DocumentData, type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const LISTING = 'labcdefghij012345678';
const OTHER = 'lzyxwvutsrq987654321';
const HASH = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);

let env: RulesTestEnvironment;
const dbAs = (uid?: string): Firestore =>
  (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore() as unknown as Firestore;

/** A valid listing body as a client would write it on create. */
function listingBody(overrides: DocumentData = {}): DocumentData {
  return {
    title: 'Expense tracker',
    description: 'Write down what you spend each day.',
    category: 'finance',
    tags: ['money'],
    lang: 'en',
    price: 0,
    makerUid: 'alice',
    makerName: 'Alice',
    icon: { glyph: 'wallet' },
    appColor: '#315C4C',
    specHash: HASH,
    specVersion: 1,
    kalamSpecVersion: '1.0.0',
    specBytes: 1200,
    changeSummary: '',
    screenshotCount: 0,
    status: 'published',
    reviewed: false,
    featured: false,
    safety: { verdict: 'pass', reasons: [], specHash: HASH, checkedAt: 1, model: 'gemini' },
    license: 'remix_allowed',
    remixAllowed: true,
    basedOn: null,
    capabilities: ['Saves a new expense'],
    disclosure: { stores: ['Expenses'], usesPhotos: false, aiFeatures: [], cloudPossible: false },
    searchKeywords: ['expense', 'tracker'],
    installs: 0,
    likes: 0,
    ratingSum: 0,
    ratingCount: 0,
    ratingAvg: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}
const GZ = 'H4sIAAAAAAAAA6tWykxRslJKSUxKVaoFAH5cVM0OAAAA'; // gzip+base64 placeholder (rules only check shape)
const specBody = (overrides: DocumentData = {}): DocumentData => ({
  specGz: GZ, specHash: HASH, specVersion: 1, makerUid: 'alice', previousSpecHash: null, changeSummary: '',
  publishedAt: serverTimestamp(), ...overrides,
});

/** Writes listing + spec in one batch, as the app does. */
async function publish(db: Firestore, id: string, listing: DocumentData = {}, spec: DocumentData = {}): Promise<void> {
  const b = writeBatch(db);
  b.set(doc(db, 'listings', id), listingBody(listing));
  b.set(doc(db, 'listingSpecs', id), specBody(spec));
  await b.commit();
}

/** Seeds data with rules off (stored timestamps are real Timestamps). */
async function seed(id: string, listing: DocumentData = {}, spec: DocumentData = {}): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    const now = Timestamp.now();
    await setDoc(doc(db, 'listings', id), listingBody({ createdAt: now, updatedAt: now, ...listing }));
    await setDoc(doc(db, 'listingSpecs', id), specBody({ publishedAt: now, ...spec }));
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-kalam',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

describe('listing create', () => {
  it('lets a signed-in maker publish a listing and its spec together', async () => {
    await assertSucceeds(publish(dbAs('alice'), LISTING));
  });
  it('accepts credit prices and sanitised custom icons', async () => {
    await assertSucceeds(publish(dbAs('alice'), LISTING, { price: 25, iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2"/></svg>' }));
    await assertFails(publish(dbAs('alice'), OTHER, { iconSvg: '<svg onload="alert(1)"></svg>' }));
    await assertFails(publish(dbAs('alice'), OTHER, { iconSvg: '<svg><script>alert(1)</script></svg>' }));
    await assertFails(publish(dbAs('alice'), OTHER, { iconSvg: '<img src=x>' }));
  });
  it('accepts install-only licences', async () => {
    await assertSucceeds(publish(dbAs('alice'), LISTING, { license: 'all_rights_reserved', remixAllowed: false }));
  });
  it('allows pending_review and rejected without a passing check', async () => {
    await assertSucceeds(publish(dbAs('alice'), LISTING, { status: 'pending_review', safety: { verdict: 'unavailable', reasons: ['Offline'], specHash: HASH, checkedAt: 1 } }));
    await assertSucceeds(publish(dbAs('alice'), OTHER, { status: 'rejected', safety: { verdict: 'flagged', reasons: ['Asks for card details.'], specHash: HASH, checkedAt: 1 } }));
  });
  it('denies signed-out users', async () => { await assertFails(publish(dbAs(), LISTING)); });
  it('denies writing a listing for someone else', async () => {
    await assertFails(publish(dbAs('bob'), LISTING));
  });
  it('denies self-review, preset counters, suspension and prices', async () => {
    await assertFails(publish(dbAs('alice'), LISTING, { reviewed: true }));
    await assertFails(publish(dbAs('alice'), LISTING, { installs: 500 }));
    await assertFails(publish(dbAs('alice'), LISTING, { likes: 3 }));
    await assertFails(publish(dbAs('alice'), LISTING, { status: 'suspended' }));
    await assertFails(publish(dbAs('alice'), LISTING, { status: 'unpublished' }));
    await assertFails(publish(dbAs('alice'), LISTING, { featured: true }));
    await assertFails(publish(dbAs('alice'), LISTING, { ratingSum: 50, ratingCount: 10, ratingAvg: 5 }));
    await assertFails(publish(dbAs('alice'), LISTING, { price: 5_000 }));
    await assertFails(publish(dbAs('alice'), LISTING, { price: -1 }));
  });
  it('denies "published" without a passing check on the same spec hash', async () => {
    await assertFails(publish(dbAs('alice'), LISTING, { safety: { verdict: 'unavailable', reasons: [], specHash: HASH, checkedAt: 1 } }));
    await assertFails(publish(dbAs('alice'), LISTING, { safety: { verdict: 'pass', reasons: [], specHash: HASH2, checkedAt: 1 } }));
  });
  it('denies unknown fields, oversized text and bad shapes', async () => {
    await assertFails(publish(dbAs('alice'), LISTING, { featured: true }));
    await assertFails(publish(dbAs('alice'), LISTING, { description: 'x'.repeat(501) }));
    await assertFails(publish(dbAs('alice'), LISTING, { tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }));
    await assertFails(publish(dbAs('alice'), LISTING, { tags: ['x'.repeat(300)] }));
    await assertFails(publish(dbAs('alice'), LISTING, { tags: 'money' }));
    // Rules bound list sizes (count + joined length); element types are enforced by the client's
    // Zod listing schema, which drops malformed listings before display.
    await assertFails(publish(dbAs('alice'), LISTING, { category: 'casino' }));
    await assertFails(publish(dbAs('alice'), LISTING, { license: 'all_rights_reserved' })); // remixAllowed must match
    await assertFails(publish(dbAs('alice'), LISTING, { license: 'public_domain', remixAllowed: false }));
    await assertFails(publish(dbAs('alice'), LISTING, { specBytes: 100_001 }));
    await assertFails(publish(dbAs('alice'), LISTING, { icon: { glyph: 'wallet', svg: '<svg onload=alert(1)>' } }));
    await assertFails(publish(dbAs('alice'), LISTING, { createdAt: Timestamp.fromMillis(0) }));
  });
  it('denies a listing whose spec doc is missing or does not match', async () => {
    const db = dbAs('alice');
    await assertFails(setDoc(doc(db, 'listings', LISTING), listingBody()));
    await assertFails(publish(db, LISTING, {}, { specHash: HASH2 }));
    await assertFails(publish(db, LISTING, {}, { specGz: 'x'.repeat(140_001) }));
    await assertFails(publish(db, LISTING, {}, { previousSpecHash: HASH2 })); // a new listing has no previous version
  });
  it('denies listing ids outside the generated format', async () => {
    await assertFails(publish(dbAs('alice'), 'Not-A-Listing'));
  });
});

describe('listing read', () => {
  beforeEach(async () => {
    await seed(LISTING);
    await seed(OTHER, { status: 'pending_review', safety: { verdict: 'unavailable', reasons: [], specHash: HASH, checkedAt: 1 } });
  });
  it('anyone reads published listings, including by query', async () => {
    await assertSucceeds(getDoc(doc(dbAs(), 'listings', LISTING)));
    await assertSucceeds(getDocs(query(collection(dbAs(), 'listings'), where('status', '==', 'published'), limit(20))));
  });
  it('hides unpublished listings from everyone but the maker', async () => {
    await assertFails(getDoc(doc(dbAs(), 'listings', OTHER)));
    await assertFails(getDoc(doc(dbAs('bob'), 'listings', OTHER)));
    await assertSucceeds(getDoc(doc(dbAs('alice'), 'listings', OTHER)));
    await assertSucceeds(getDocs(query(collection(dbAs('alice'), 'listings'), where('makerUid', '==', 'alice'))));
  });
  it('denies unconstrained queries', async () => {
    await assertFails(getDocs(collection(dbAs(), 'listings')));
    await assertFails(getDocs(query(collection(dbAs('bob'), 'listings'), where('makerUid', '==', 'alice'))));
  });
});

describe('listing update by the maker', () => {
  beforeEach(async () => { await seed(LISTING); });
  it('can unpublish', async () => {
    await assertSucceeds(updateDoc(doc(dbAs('alice'), 'listings', LISTING), { status: 'unpublished', updatedAt: serverTimestamp() }));
  });
  it('can publish a new spec version in one batch', async () => {
    const db = dbAs('alice');
    const b = writeBatch(db);
    b.update(doc(db, 'listings', LISTING), {
      specHash: HASH2, specVersion: 2, updatedAt: serverTimestamp(),
      safety: { verdict: 'pass', reasons: [], specHash: HASH2, checkedAt: 2 },
    });
    b.set(doc(db, 'listingSpecs', LISTING), specBody({ specHash: HASH2, specVersion: 2, previousSpecHash: HASH, changeSummary: 'Added a notes field.' }));
    b.set(doc(db, 'listingSpecs', LISTING, 'versions', '2'), specBody({ specHash: HASH2, specVersion: 2, previousSpecHash: HASH, changeSummary: 'Added a notes field.' }));
    await assertSucceeds(b.commit());
  });
  it('cannot mark itself reviewed, touch counters, change owner or go back a version', async () => {
    const ref = doc(dbAs('alice'), 'listings', LISTING);
    await assertFails(updateDoc(ref, { reviewed: true, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { installs: 999, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { likes: increment(1), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { makerUid: 'bob', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { featured: true, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { ratingSum: 25, ratingCount: 5, ratingAvg: 5, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { status: 'suspended', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { title: 'New title' })); // updatedAt must be the server time
  });
  it('cannot change the spec hash without the matching spec doc', async () => {
    await assertFails(updateDoc(doc(dbAs('alice'), 'listings', LISTING), {
      specHash: HASH2, updatedAt: serverTimestamp(), safety: { verdict: 'pass', reasons: [], specHash: HASH2, checkedAt: 2 },
    }));
  });
  it('other users cannot edit or delete it', async () => {
    await assertFails(updateDoc(doc(dbAs('bob'), 'listings', LISTING), { title: 'Mine now', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(dbAs('alice'), 'listings', LISTING)));
    await assertFails(deleteDoc(doc(dbAs('bob'), 'listings', LISTING)));
  });
  it('a suspended listing is frozen for its maker', async () => {
    await seed(OTHER, { status: 'suspended' });
    await assertFails(updateDoc(doc(dbAs('alice'), 'listings', OTHER), { status: 'unpublished', updatedAt: serverTimestamp() }));
  });
});

describe('listing specs', () => {
  beforeEach(async () => {
    await seed(LISTING);
    await seed(OTHER, { status: 'pending_review', safety: { verdict: 'unavailable', reasons: [], specHash: HASH, checkedAt: 1 } });
  });
  it('anyone reads the spec of a free published listing', async () => {
    await assertSucceeds(getDoc(doc(dbAs(), 'listingSpecs', LISTING)));
  });
  it('only the maker reads specs of hidden listings', async () => {
    await assertFails(getDoc(doc(dbAs(), 'listingSpecs', OTHER)));
    await assertFails(getDoc(doc(dbAs('bob'), 'listingSpecs', OTHER)));
    await assertSucceeds(getDoc(doc(dbAs('alice'), 'listingSpecs', OTHER)));
  });
  it('nobody else can overwrite a spec or list specs', async () => {
    await assertFails(setDoc(doc(dbAs('bob'), 'listingSpecs', LISTING), specBody({ makerUid: 'bob' })));
    await assertFails(getDocs(collection(dbAs('alice'), 'listingSpecs')));
    await assertFails(deleteDoc(doc(dbAs('alice'), 'listingSpecs', LISTING)));
  });
});

describe('likes', () => {
  beforeEach(async () => { await seed(LISTING); });
  const like = (db: Firestore, uid: string, by = 1) => {
    const b = writeBatch(db);
    b.set(doc(db, 'listings', LISTING, 'likes', uid), { createdAt: serverTimestamp() });
    b.update(doc(db, 'listings', LISTING), { likes: increment(by) });
    return b.commit();
  };
  it('a signed-in user likes once and can unlike', async () => {
    const db = dbAs('bob');
    await assertSucceeds(like(db, 'bob'));
    await assertSucceeds(getDoc(doc(db, 'listings', LISTING, 'likes', 'bob')));
    await assertFails(like(db, 'bob')); // second like: doc exists, counter would double
    const b = writeBatch(db);
    b.delete(doc(db, 'listings', LISTING, 'likes', 'bob'));
    b.update(doc(db, 'listings', LISTING), { likes: increment(-1) });
    await assertSucceeds(b.commit());
  });
  it('denies counter changes without a like doc, big steps, or likes for others', async () => {
    const db = dbAs('bob');
    await assertFails(updateDoc(doc(db, 'listings', LISTING), { likes: increment(1) }));
    await assertFails(like(db, 'bob', 2));
    await assertFails(like(db, 'carol'));
    await assertFails(updateDoc(doc(db, 'listings', LISTING), { likes: increment(-1) }));
    await assertFails(like(dbAs(), 'anon'));
  });
  it('cannot read other people\'s likes', async () => {
    await assertSucceeds(like(dbAs('bob'), 'bob'));
    await assertFails(getDoc(doc(dbAs('carol'), 'listings', LISTING, 'likes', 'bob')));
  });
});

describe('installs (zero-price entitlements)', () => {
  beforeEach(async () => { await seed(LISTING); });
  const entitlement = (overrides: DocumentData = {}): DocumentData => ({
    listingId: LISTING, sellerUid: 'alice', pricePaid: 0, currency: 'credits', installedVersion: 1,
    purchasedAt: serverTimestamp(), status: 'active', ...overrides,
  });
  const install = (db: Firestore, uid: string, body: DocumentData = entitlement(), by = 1) => {
    const b = writeBatch(db);
    b.set(doc(db, 'users', uid, 'purchases', LISTING), body);
    b.update(doc(db, 'listings', LISTING), { installs: increment(by) });
    return b.commit();
  };
  it('first install records an entitlement and counts once', async () => {
    const db = dbAs('bob');
    await assertSucceeds(install(db, 'bob'));
    await assertSucceeds(getDoc(doc(db, 'users', 'bob', 'purchases', LISTING)));
    await assertFails(install(db, 'bob')); // replay
    await assertFails(updateDoc(doc(db, 'listings', LISTING), { installs: increment(1) }));
  });
  it('denies wrong price, seller, version, other users and big steps', async () => {
    const db = dbAs('bob');
    await assertFails(install(db, 'bob', entitlement({ pricePaid: 5 })));
    await assertFails(install(db, 'bob', entitlement({ sellerUid: 'bob' })));
    await assertFails(install(db, 'bob', entitlement({ installedVersion: 7 })));
    await assertFails(install(db, 'carol'));
    await assertFails(install(db, 'bob', entitlement(), 3));
    await assertFails(install(dbAs(), 'anon'));
  });
  it('entitlements are private and immutable', async () => {
    await assertSucceeds(install(dbAs('bob'), 'bob'));
    await assertFails(getDoc(doc(dbAs('alice'), 'users', 'bob', 'purchases', LISTING)));
    await assertFails(deleteDoc(doc(dbAs('bob'), 'users', 'bob', 'purchases', LISTING)));
    await assertFails(updateDoc(doc(dbAs('bob'), 'users', 'bob', 'purchases', LISTING), { status: 'refunded' }));
  });
  it('cannot install a hidden listing', async () => {
    await seed(OTHER, { status: 'unpublished' });
    const db = dbAs('bob');
    const b = writeBatch(db);
    b.set(doc(db, 'users', 'bob', 'purchases', OTHER), entitlement({ listingId: OTHER }));
    b.update(doc(db, 'listings', OTHER), { installs: increment(1) });
    await assertFails(b.commit());
  });
});

describe('reports', () => {
  beforeEach(async () => { await seed(LISTING); });
  const report = (overrides: DocumentData = {}): DocumentData => ({
    listingId: LISTING, reporterUid: 'bob', reason: 'misleading', note: 'Claims to cure colds.', createdAt: serverTimestamp(), ...overrides,
  });
  it('a signed-in user reports a listing once', async () => {
    const db = dbAs('bob');
    await assertSucceeds(setDoc(doc(db, 'reports', `${LISTING}_bob`), report()));
    await assertFails(setDoc(doc(db, 'reports', `${LISTING}_bob`), report({ note: 'again' })));
  });
  it('denies anonymous, spoofed, malformed and read access', async () => {
    await assertFails(setDoc(doc(dbAs(), 'reports', `${LISTING}_anon`), report({ reporterUid: 'anon' })));
    await assertFails(setDoc(doc(dbAs('bob'), 'reports', `${LISTING}_carol`), report({ reporterUid: 'carol' })));
    await assertFails(setDoc(doc(dbAs('bob'), 'reports', `${LISTING}_bob`), report({ reason: 'dislike' })));
    await assertFails(setDoc(doc(dbAs('bob'), 'reports', `${LISTING}_bob`), report({ note: 'x'.repeat(501) })));
    await assertFails(setDoc(doc(dbAs('bob'), 'reports', `${OTHER}_bob`), report({ listingId: OTHER })));
    await assertFails(getDoc(doc(dbAs('bob'), 'reports', `${LISTING}_bob`)));
  });
});

describe('default deny', () => {
  it('denies everything else', async () => {
    await assertFails(setDoc(doc(dbAs('bob'), 'wallets', 'bob'), { credits: 1_000_000 }));
    await assertFails(getDoc(doc(dbAs('bob'), 'users', 'bob')));
    await assertFails(setDoc(doc(dbAs('bob'), 'users', 'bob', 'backups', 'app1'), { blob: 'x' }));
  });
});

describe('reviews (docs/12 §14)', () => {
  const entitle = async (uid: string, id = LISTING) => env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(db, 'users', uid, 'purchases', id), {
      listingId: id, sellerUid: 'alice', pricePaid: 0, currency: 'credits', installedVersion: 1, purchasedAt: Timestamp.now(), status: 'active',
    });
  });
  const review = (rating: number, overrides: DocumentData = {}): DocumentData => ({
    rating, comment: 'Useful for my shop.', authorName: 'Bob', appVersion: 1, status: 'visible', response: null, respondedAt: null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...overrides,
  });
  const write = (db: Firestore, uid: string, body: DocumentData, totals: { sum: number; count: number; avg: number }) => {
    const b = writeBatch(db);
    b.set(doc(db, 'listings', LISTING, 'reviews', uid), body);
    b.update(doc(db, 'listings', LISTING), { ratingSum: totals.sum, ratingCount: totals.count, ratingAvg: totals.avg });
    return b.commit();
  };
  beforeEach(async () => { await seed(LISTING); });

  it('needs an install, one per person, and moves the totals by exactly the rating', async () => {
    await assertFails(write(dbAs('bob'), 'bob', review(4), { sum: 4, count: 1, avg: 4 })); // no entitlement yet
    await entitle('bob');
    await assertFails(write(dbAs('bob'), 'bob', review(4), { sum: 5, count: 1, avg: 5 })); // wrong totals
    await assertFails(write(dbAs('bob'), 'carol', review(4), { sum: 4, count: 1, avg: 4 })); // someone else's slot
    await assertSucceeds(write(dbAs('bob'), 'bob', review(4), { sum: 4, count: 1, avg: 4 }));
    await entitle('carol');
    await assertSucceeds(write(dbAs('carol'), 'carol', review(5), { sum: 9, count: 2, avg: 4.5 }));
    // Bob changes his rating from 4 to 2: 9 - 4 + 2 = 7 over 2 reviews.
    const db = dbAs('bob');
    const b = writeBatch(db);
    b.update(doc(db, 'listings', LISTING, 'reviews', 'bob'), { rating: 2, comment: 'Changed my mind.', updatedAt: serverTimestamp() });
    b.update(doc(db, 'listings', LISTING), { ratingSum: 7, ratingCount: 2, ratingAvg: 3.5 });
    await assertSucceeds(b.commit());
    // Deleting takes the rating back out.
    const d = writeBatch(db);
    d.delete(doc(db, 'listings', LISTING, 'reviews', 'bob'));
    d.update(doc(db, 'listings', LISTING), { ratingSum: 5, ratingCount: 1, ratingAvg: 5 });
    await assertSucceeds(d.commit());
  });
  it('rejects markup, bad ratings, self-set replies and hidden status', async () => {
    await entitle('bob');
    await assertFails(write(dbAs('bob'), 'bob', review(4, { comment: '<img src=x onerror=alert(1)>' }), { sum: 4, count: 1, avg: 4 }));
    await assertFails(write(dbAs('bob'), 'bob', review(6), { sum: 6, count: 1, avg: 6 }));
    await assertFails(write(dbAs('bob'), 'bob', review(4, { response: 'Thanks' }), { sum: 4, count: 1, avg: 4 }));
    await assertFails(write(dbAs('bob'), 'bob', review(4, { status: 'hidden' }), { sum: 4, count: 1, avg: 4 }));
  });
  it('lets the maker reply in a separate field only', async () => {
    await entitle('bob');
    await assertSucceeds(write(dbAs('bob'), 'bob', review(3), { sum: 3, count: 1, avg: 3 }));
    const ref = (db: Firestore) => doc(db, 'listings', LISTING, 'reviews', 'bob');
    await assertSucceeds(updateDoc(ref(dbAs('alice')), { response: 'Thank you. Fixed in version 2.', respondedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref(dbAs('alice')), { rating: 5 }));
    await assertFails(updateDoc(ref(dbAs('carol')), { response: 'Fake reply', respondedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref(dbAs('bob')), { response: 'Self reply' }));
    await assertSucceeds(getDoc(ref(dbAs())));
  });
  it('cannot change the totals without a review', async () => {
    await assertFails(updateDoc(doc(dbAs('bob'), 'listings', LISTING), { ratingSum: 50, ratingCount: 10, ratingAvg: 5 }));
  });
});

describe('paid listings (docs/12 §12, §17.2)', () => {
  beforeEach(async () => { await seed(LISTING, { price: 30 }); });
  it('hides the spec until the purchase function writes an entitlement', async () => {
    await assertFails(getDoc(doc(dbAs(), 'listingSpecs', LISTING)));
    await assertFails(getDoc(doc(dbAs('bob'), 'listingSpecs', LISTING)));
    await assertSucceeds(getDoc(doc(dbAs('alice'), 'listingSpecs', LISTING)));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as unknown as Firestore, 'users', 'bob', 'purchases', LISTING), {
        listingId: LISTING, sellerUid: 'alice', pricePaid: 30, currency: 'credits', installedVersion: 1, purchasedAt: Timestamp.now(), status: 'active', purchaseId: `bob_${LISTING}`,
      });
    });
    await assertSucceeds(getDoc(doc(dbAs('bob'), 'listingSpecs', LISTING)));
    await assertSucceeds(getDocs(collection(dbAs('bob'), 'listingSpecs', LISTING, 'versions')));
  });
  it('never lets a client write a paid entitlement, a counter step for it, or credits', async () => {
    const db = dbAs('bob');
    const b = writeBatch(db);
    b.set(doc(db, 'users', 'bob', 'purchases', LISTING), {
      listingId: LISTING, sellerUid: 'alice', pricePaid: 30, currency: 'credits', installedVersion: 1, purchasedAt: serverTimestamp(), status: 'active',
    });
    b.update(doc(db, 'listings', LISTING), { installs: increment(1) });
    await assertFails(b.commit());
    await assertFails(setDoc(doc(db, 'wallets', 'bob'), { credits: 1_000_000, currency: 'credits', version: 1, updatedAt: 1 }));
    await assertFails(setDoc(doc(db, 'walletTransactions', 'x'), { buyerUid: 'bob', amount: -30 }));
  });
});

describe('wallets and the ledger (docs/12 §12.4-12.5)', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'wallets', 'bob'), { credits: 70, currency: 'credits', version: 2, updatedAt: Timestamp.now() });
      await setDoc(doc(db, 'walletTransactions', 'tx1'), {
        type: 'purchase', buyerUid: 'bob', sellerUid: 'alice', listingId: LISTING, amount: 30, currency: 'credits', status: 'completed', purchaseId: 'p1', createdAt: Timestamp.now(),
      });
    });
  });
  it('lets people read only their own wallet and entries', async () => {
    await assertSucceeds(getDoc(doc(dbAs('bob'), 'wallets', 'bob')));
    await assertFails(getDoc(doc(dbAs('carol'), 'wallets', 'bob')));
    await assertSucceeds(getDocs(query(collection(dbAs('bob'), 'walletTransactions'), where('buyerUid', '==', 'bob'))));
    await assertSucceeds(getDocs(query(collection(dbAs('alice'), 'walletTransactions'), where('sellerUid', '==', 'alice'))));
    await assertFails(getDocs(query(collection(dbAs('carol'), 'walletTransactions'), where('buyerUid', '==', 'bob'))));
    await assertFails(getDocs(collection(dbAs('bob'), 'walletTransactions')));
  });
  it('never lets clients change balances, history or the moderation log', async () => {
    await assertFails(updateDoc(doc(dbAs('bob'), 'wallets', 'bob'), { credits: 9_999 }));
    await assertFails(deleteDoc(doc(dbAs('bob'), 'walletTransactions', 'tx1')));
    await assertFails(getDoc(doc(dbAs('bob'), 'moderationLog', 'x')));
    await assertFails(setDoc(doc(dbAs('bob'), 'moderationLog', 'x'), { action: 'approve' }));
  });
});

describe('listing media and versions', () => {
  const shot = { mimeType: 'image/jpeg', base64: 'A'.repeat(400), width: 360, height: 720 };
  it('stores up to 3 screenshots matching the listing count, maker only', async () => {
    const db = dbAs('alice');
    const b = writeBatch(db);
    b.set(doc(db, 'listings', LISTING), listingBody({ screenshotCount: 2 }));
    b.set(doc(db, 'listingSpecs', LISTING), specBody());
    b.set(doc(db, 'listingMedia', LISTING), { screenshots: [shot, shot], updatedAt: serverTimestamp() });
    await assertSucceeds(b.commit());
    await assertSucceeds(getDoc(doc(dbAs(), 'listingMedia', LISTING)));
    await assertFails(setDoc(doc(dbAs('bob'), 'listingMedia', LISTING), { screenshots: [], updatedAt: serverTimestamp() }));
    const bad = writeBatch(db);
    bad.set(doc(db, 'listingMedia', LISTING), { screenshots: [{ ...shot, mimeType: 'image/svg+xml' }, shot], updatedAt: serverTimestamp() });
    await assertFails(bad.commit());
  });
  it('keeps old versions immutable', async () => {
    await seed(LISTING);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as unknown as Firestore, 'listingSpecs', LISTING, 'versions', '1'), specBody({ publishedAt: Timestamp.now() }));
    });
    await assertSucceeds(getDoc(doc(dbAs(), 'listingSpecs', LISTING, 'versions', '1')));
    await assertFails(setDoc(doc(dbAs('alice'), 'listingSpecs', LISTING, 'versions', '1'), specBody({ specHash: HASH2 })));
    await assertFails(deleteDoc(doc(dbAs('alice'), 'listingSpecs', LISTING, 'versions', '1')));
  });
});

describe('encrypted backups (docs/12 §16.7, docs/11 §12.6)', () => {
  const body = () => ({ format: 'kalam-encrypted-backup', formatVersion: 1, ciphertext: 'QUJD', manifest: { appCount: 1 }, updatedAt: serverTimestamp() });
  it('is owner-only and ciphertext-only', async () => {
    await assertSucceeds(setDoc(doc(dbAs('bob'), 'users', 'bob', 'backups', 'app_1'), body()));
    await assertSucceeds(getDoc(doc(dbAs('bob'), 'users', 'bob', 'backups', 'app_1')));
    await assertFails(getDoc(doc(dbAs('alice'), 'users', 'bob', 'backups', 'app_1')));
    await assertFails(setDoc(doc(dbAs('alice'), 'users', 'bob', 'backups', 'app_2'), body()));
    await assertFails(setDoc(doc(dbAs('bob'), 'users', 'bob', 'backups', 'app_3'), { ...body(), plaintext: 'records' }));
  });
});
