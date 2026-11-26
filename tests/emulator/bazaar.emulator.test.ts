/**
 * Kalam Bazaar, publish to purchase to install, with the REAL client code (createBazaarService and the real auth
 * service) talking to the Auth, Firestore (named database "kalam", with firestore.rules) and Functions emulators
 * (docs/12 §22.2, docs/13 §10.1). Two people, each with their own Firebase app, sign-in and local database.
 *
 * What it proves: a maker publishes a paid app, a buyer claims the starting credits and buys it, the credits move
 * once, the buyer gets a copy of the design on the shelf, and none of the maker's private records, drafts or
 * prompts travel with it. The only stand-ins are the AI safety review (no model is called) and the App Check
 * token (the emulator cannot verify one, so an unsigned token is sent, as in functions.emulator.test.ts).
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { CustomProvider, initializeAppCheck } from 'firebase/app-check';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, type Firestore } from 'firebase/firestore';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../fixtures/specs/load';
import { AUTH_HOST, FIRESTORE_HOST, PASSWORD, PROJECT, readDocument } from './emulator';

process.env.EXPO_PUBLIC_FUNCTIONS_EMULATOR = process.env.FUNCTIONS_EMULATOR_HOST ?? '127.0.0.1:5001';

/** Each person's phone has its own AsyncStorage, so a spec the maker cached is never visible to the buyer. */
const phoneStorage = () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
    },
  };
};
const { validateSpec } = await import('@/core/spec/validate');
const { createWebDatabase } = await import('@/infrastructure/storage/database.web');
const { createAuthService } = await import('@/infrastructure/firebase/auth-core');

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unsignedAppCheckToken = () =>
  `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: '1:1:web:kalamtest', aud: [`projects/${PROJECT}`], iss: `https://firebaseappcheck.googleapis.com/${PROJECT}`, exp: Math.floor(Date.now() / 1000) + 3600 })}.`;

let aiCalls = 0;
const fakeAi = {
  run: async () => {
    aiCalls += 1;
    return { success: true, output: { verdict: 'pass', reasons: [] }, provider: 'firebase', source: 'cloud', model: 'fake-safety', latencyMs: 5, fallbackUsed: false };
  },
} as never;

/** One person: their own Firebase app, account, local database and Bazaar service. */
async function person(label: string) {
  vi.resetModules(); // so the Bazaar functions client is created for THIS person's app
  const app: FirebaseApp = initializeApp({ apiKey: 'demo', projectId: PROJECT, appId: '1:1:web:kalamtest' }, `${label}-${Math.random().toString(36).slice(2)}`);
  initializeAppCheck(app, {
    provider: new CustomProvider({ getToken: async () => ({ token: unsignedAppCheckToken(), expireTimeMillis: Date.now() + 3_600_000 }) }),
  });
  const authInstance = getAuth(app);
  connectAuthEmulator(authInstance, `http://${AUTH_HOST}`, { disableWarnings: true });
  const [host, port] = FIRESTORE_HOST.split(':');
  const firestore: Firestore = initializeFirestore(app, {}, 'kalam');
  connectFirestoreEmulator(firestore, host!, Number(port));

  const auth = createAuthService({ getAuth: () => authInstance });
  const signedUp = await auth.signUpWithEmail(`${label}-${Math.random().toString(36).slice(2, 8)}@example.com`, PASSWORD, label);
  if (!signedUp.ok) throw new Error(`could not sign ${label} up: ${signedUp.message}`);

  vi.doMock('@react-native-async-storage/async-storage', phoneStorage);
  vi.doMock('@/infrastructure/firebase/app', () => ({ getFirebaseApp: () => app, isFirebaseConfigured: () => true }));
  const { createBazaarService } = await import('@/infrastructure/bazaar/bazaar-service');
  const db = createWebDatabase(`bazaar-e2e-${label}-${Date.now()}`);
  const svc = createBazaarService({
    firestore: () => firestore,
    auth,
    ai: fakeAi,
    db,
    network: { online: () => true, subscribe: () => () => undefined } as never,
    paymentsEnabled: () => true,
  });
  return { uid: signedUp.user!.uid, db, svc, firestore };
}

const PRICE = 30;
const PRIVATE_NOTE = 'PRIVATE-record-sentinel-8841';
let maker: Awaited<ReturnType<typeof person>>;
let buyer: Awaited<ReturnType<typeof person>>;
let listingId = '';

beforeAll(async () => {
  maker = await person('maker');
  buyer = await person('buyer');
});

describe('paid purchase through the real client', () => {
  it('the maker publishes a paid app that carries no private records', async () => {
    const checked = validateSpec(loadFixture('valid', 'expense-tracker'));
    if (!checked.ok || !checked.spec) throw new Error('fixture');
    const spec = checked.spec;
    await maker.db.apps.save({ id: spec.id, spec, createdAt: 1, updatedAt: 1, origin: { route: 'template' } }, { summary: 'Made', source: 'create' });
    const [collection, def] = Object.entries(spec.collections)[0]!;
    const field = Object.entries(def.fields).find(([, f]) => f.type === 'text')?.[0];
    if (!field) throw new Error('fixture has no text field');
    await maker.db.records.insert(spec.id, collection, { amount: 1234, [field]: PRIVATE_NOTE }); // amount is required by the expense template

    const pub = await maker.svc.publish({
      appId: spec.id,
      makerName: 'Maker',
      form: { title: 'Fee tracker', description: 'Write down what you spend each day and see the total.', category: 'finance', tags: ['money'], license: 'remix_allowed', price: PRICE },
    });
    expect(pub, JSON.stringify(pub)).toMatchObject({ ok: true, status: 'published' });
    listingId = pub.listingId!;
    expect(aiCalls).toBe(1);

    // Nothing the maker typed is in the listing or in the published design.
    for (const path of [`listings/${listingId}`, `listingSpecs/${listingId}`]) {
      const stored = await readDocument(path);
      expect(stored, path).toBeDefined();
      expect(JSON.stringify(stored)).not.toContain(PRIVATE_NOTE);
    }
    expect(await readDocument(`listings/${listingId}`)).toMatchObject({ price: PRICE, status: 'published', makerUid: maker.uid });
  });

  it('the buyer sees the paid listing, cannot install it for free, and cannot rewrite their own wallet', async () => {
    const page = await buyer.svc.browse({ price: 'paid' });
    const listing = page.listings.find((l) => l.id === listingId);
    expect(listing).toMatchObject({ price: PRICE, title: 'Fee tracker' });

    // The listing's design is locked behind the purchase until it is bought.
    const free = await buyer.svc.install(listing!, 'install');
    expect(free.ok).toBe(false);
    expect(free.message).toContain('Buy this app');
    expect(await buyer.db.apps.list()).toHaveLength(0);

    // Wallets are written by the trusted function only (firestore.rules): the client SDK is refused.
    const { doc, setDoc } = await import('firebase/firestore');
    await expect(setDoc(doc(buyer.firestore, 'wallets', buyer.uid), { credits: 9999, currency: 'credits', version: 1 })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(doc(buyer.firestore, 'users', buyer.uid, 'purchases', listingId), { listingId, pricePaid: 0, status: 'active' })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('the buyer claims the starting credits once, then buys: 100 - 30 left, one install, the design on the shelf', async () => {
    const before = await buyer.svc.wallet();
    expect(before).toMatchObject({ enabled: true, signedIn: true });
    expect(before.wallet).toBeUndefined(); // no wallet until the first credit claim

    const claim = await buyer.svc.claimStarterCredits();
    expect(claim, JSON.stringify(claim)).toMatchObject({ ok: true });
    expect(claim.message).toContain('100 credits');
    expect((await buyer.svc.claimStarterCredits()).message).toBe('Your wallet is ready.');

    const listing = (await buyer.svc.getListing(listingId))!.listing;
    const bought = await buyer.svc.purchase(listing);
    expect(bought, JSON.stringify(bought)).toMatchObject({ ok: true });
    expect(bought.message).toContain('Bought for 30 credits. 70 left.');

    const apps = await buyer.db.apps.list();
    expect(apps).toHaveLength(1);
    expect(apps[0]!.spec.meta.basedOn).toBe(`bazaar:${listingId}`);
    // Private records, drafts and prompts do not come with the design.
    const records = await buyer.db.records.listAll(apps[0]!.id);
    expect(Object.values(records).flat()).toHaveLength(0);
    expect(JSON.stringify(apps[0])).not.toContain(PRIVATE_NOTE);
    expect(apps[0]!.creationInput).toBeUndefined();

    // The ledger, both wallets and the listing agree.
    const wallet = await buyer.svc.wallet();
    expect(wallet.wallet).toMatchObject({ credits: 70 });
    expect(wallet.transactions.some((t) => t.type === 'purchase' && t.amount === PRICE && t.status === 'completed')).toBe(true);
    expect(await readDocument(`wallets/${maker.uid}`)).toMatchObject({ credits: 130 });
    expect(await readDocument(`listings/${listingId}`)).toMatchObject({ installs: 1 });
    expect((await buyer.svc.library()).find((i) => i.listingId === listingId)).toBeDefined();
  });

  it('buying again does not charge again', async () => {
    const listing = (await buyer.svc.getListing(listingId))!.listing;
    const again = await buyer.svc.purchase(listing);
    expect(again.message).toContain('You already own this app.');
    expect((await buyer.svc.wallet()).wallet).toMatchObject({ credits: 70 });
    expect(await readDocument(`listings/${listingId}`)).toMatchObject({ installs: 1 });
  });

  it('the maker cannot buy their own app, and sees the sale in their numbers', async () => {
    const listing = (await maker.svc.getListing(listingId))!.listing;
    const own = await maker.svc.purchase(listing);
    expect(own.ok).toBe(false);
    expect(own.message).toContain('your own app');
    const stats = await maker.svc.creatorStats(await maker.svc.myListings());
    expect(stats).toMatchObject({ listings: 1, installs: 1 });
    expect(stats.creditsEarned).toBe(PRICE);
  });
});
