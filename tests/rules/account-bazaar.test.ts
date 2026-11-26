/**
 * Kalam Bazaar with a Google account, on the Firestore emulator and the real rules (docs/12 §9, §13):
 * a person signed in with Google publishes; once the safety check passes the listing is in Discover
 * for every other person (signed in or not, no moderator step); "My listings" shows it to the maker.
 * When the check cannot run, the listing waits as "pending review", hidden from Discover (docs/12 §9.6).
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../fixtures/specs/load';

vi.mock('@react-native-async-storage/async-storage', () => {
  const m = new Map<string, string>();
  return { default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v), removeItem: async (k: string) => void m.delete(k) } };
});
vi.mock('@/infrastructure/bazaar/functions', () => ({
  bazaarPaymentsEnabled: () => false,
  callBazaar: async () => ({ ok: false, message: 'Credits are not switched on yet.' }),
}));

const { createBazaarService } = await import('@/infrastructure/bazaar/bazaar-service');
const { createWebDatabase } = await import('@/infrastructure/storage/database.web');
const { validateSpec } = await import('@/core/spec/validate');

let env: RulesTestEnvironment;
let verdict: 'pass' | 'unavailable' = 'pass';

type Who = { uid: string; name: string; provider: 'google.com' } | null;
function person(who: Who) {
  const db = createWebDatabase(`acct-bazaar-${who?.uid ?? 'anon'}-${Date.now()}`);
  const firestore = (who
    ? env.authenticatedContext(who.uid, { firebase: { sign_in_provider: who.provider, identities: {} } })
    : env.unauthenticatedContext()
  ).firestore() as unknown as Firestore;
  const svc = createBazaarService({
    firestore: () => firestore,
    // A Google account as auth-core reports it (toKalamUser).
    auth: { current: () => (who ? { uid: who.uid, isAnonymous: false, displayName: who.name, email: `${who.uid}@gmail.com`, providers: ['google.com'] } : null) } as never,
    ai: {
      run: async () => verdict === 'pass'
        ? { success: true, output: { verdict: 'pass', reasons: [] }, provider: 'firebase', source: 'cloud', model: 'fake-safety', latencyMs: 5, fallbackUsed: false }
        : { success: false, errorCode: 'offline', provider: 'firebase', source: 'cloud', latencyMs: 5, fallbackUsed: false },
    } as never,
    db,
    network: { online: () => true, subscribe: () => () => undefined },
  });
  return { db, svc };
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-kalam', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  await env.clearFirestore();
});
afterAll(async () => {
  await env?.cleanup();
});

describe('Bazaar publishing with a Google account', () => {
  it('publishes, shows in Discover for everyone and in My listings', async () => {
    const asha = person({ uid: 'google-asha', name: 'Asha', provider: 'google.com' });
    const ravi = person({ uid: 'google-ravi', name: 'Ravi', provider: 'google.com' });
    const visitor = person(null);
    const checked = validateSpec(loadFixture('valid', 'expense-tracker'));
    if (!checked.ok || !checked.spec) throw new Error('fixture');
    const spec = { ...checked.spec, id: 'app_asha_shop' };
    await asha.db.apps.save({ id: spec.id, spec, createdAt: 1, updatedAt: 1, origin: { route: 'template' } }, { summary: 'Made', source: 'create' });

    const form = { title: 'Shop expenses', description: 'Write down what the shop spends each day.', category: 'business' as const, tags: ['shop'], license: 'personal' as const };
    const pub = await asha.svc.publish({ appId: spec.id, form, makerName: 'Asha' });
    expect(pub).toMatchObject({ ok: true, status: 'published' });
    const id = pub.listingId!;

    // Discover: another Google user, and someone not signed in at all.
    expect((await ravi.svc.browse({})).listings.map((l) => l.id)).toContain(id);
    expect((await ravi.svc.browse({ category: 'business' })).listings.map((l) => l.id)).toContain(id);
    expect((await visitor.svc.browse({})).listings.map((l) => l.id)).toContain(id);
    const seen = (await visitor.svc.getListing(id))?.listing;
    expect(seen).toMatchObject({ makerName: 'Asha', status: 'published', reviewed: false });
    expect(JSON.stringify(seen)).not.toContain('@gmail.com'); // the email is never published
    expect((await visitor.svc.install(seen!, 'install')).ok).toBe(true); // free install works without an account

    // My listings: the maker sees it; others' My listings do not.
    expect((await asha.svc.myListings()).map((l) => [l.id, l.status])).toContainEqual([id, 'published']);
    expect((await ravi.svc.myListings()).map((l) => l.id)).not.toContain(id);

    // If the safety check cannot run, the listing waits hidden until it is checked again.
    verdict = 'unavailable';
    const spec2 = { ...checked.spec, id: 'app_asha_two', name: 'Second book' };
    await asha.db.apps.save({ id: spec2.id, spec: spec2, createdAt: 1, updatedAt: 1, origin: { route: 'template' } }, { summary: 'Made', source: 'create' });
    const held = await asha.svc.publish({ appId: spec2.id, form: { ...form, title: 'Second book' }, makerName: 'Asha' });
    expect(held).toMatchObject({ ok: true, status: 'pending_review' });
    expect((await ravi.svc.browse({})).listings.map((l) => l.id)).not.toContain(held.listingId);
    expect((await asha.svc.myListings()).map((l) => [l.id, l.status])).toContainEqual([held.listingId, 'pending_review']);
    verdict = 'pass';
    expect(await asha.svc.recheck(held.listingId!)).toMatchObject({ ok: true, status: 'published' });
    expect((await ravi.svc.browse({})).listings.map((l) => l.id)).toContain(held.listingId);
  });

  it('a guest account cannot publish', async () => {
    const db = createWebDatabase(`acct-bazaar-guest-${Date.now()}`);
    const svc = createBazaarService({
      firestore: () => env.authenticatedContext('guest-1', { firebase: { sign_in_provider: 'anonymous', identities: {} } }).firestore() as unknown as Firestore,
      auth: { current: () => ({ uid: 'guest-1', isAnonymous: true, displayName: null, email: null, providers: [] }) } as never,
      ai: { run: async () => ({ success: false }) } as never,
      db,
      network: { online: () => true, subscribe: () => () => undefined },
    });
    expect(await svc.publish({ appId: 'x', form: { title: 'x', description: '', category: 'business', tags: [], license: 'personal' }, makerName: 'G' }))
      .toMatchObject({ ok: false });
  });
});
