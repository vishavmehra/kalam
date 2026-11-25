/**
 * Kalam Bazaar end to end against the Firestore emulator and the deployed-to-be rules (docs/12 §22.2):
 * the real service code publishes, browses, previews, installs, reviews, likes, reports, edits details,
 * publishes a new version, updates an installed copy and unpublishes. Two people, two local databases.
 * Only the AI review and the account are fakes (no cloud calls, no real users).
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../fixtures/specs/load';

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
    },
  };
});
vi.mock('@/infrastructure/bazaar/functions', () => ({
  bazaarPaymentsEnabled: () => false,
  callBazaar: async () => ({ ok: false, message: 'Credits are not switched on yet.' }),
}));

const { createBazaarService } = await import('@/infrastructure/bazaar/bazaar-service');
const { createWebDatabase } = await import('@/infrastructure/storage/database.web');
const { validateSpec } = await import('@/core/spec/validate');
type Service = ReturnType<typeof createBazaarService>;

let env: RulesTestEnvironment;
let aiCalls = 0;

function person(uid: string, name: string) {
  const db = createWebDatabase(`bazaar-it-${uid}-${Date.now()}`);
  const firestore = env.authenticatedContext(uid).firestore() as unknown as Firestore;
  const svc: Service = createBazaarService({
    firestore: () => firestore,
    auth: {
      current: () => ({ uid, isAnonymous: false, displayName: name, email: null, providers: ['password'] }),
    } as never,
    ai: {
      run: async () => {
        aiCalls += 1;
        return { success: true, output: { verdict: 'pass', reasons: [] }, provider: 'firebase', source: 'cloud', model: 'fake-safety', latencyMs: 5, fallbackUsed: false };
      },
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
afterAll(async () => { await env?.cleanup(); });

describe('Kalam Bazaar round trip on the emulator', () => {
  it('publishes, installs, reviews, updates and unpublishes with the real rules', async () => {
    const alice = person('alice', 'Alice');
    const bob = person('bob', 'Bob');
    const checked = validateSpec(loadFixture('valid', 'expense-tracker'));
    if (!checked.ok || !checked.spec) throw new Error('fixture');
    const spec = checked.spec;
    await alice.db.apps.save({ id: spec.id, spec, createdAt: 1, updatedAt: 1, origin: { route: 'template' } }, { summary: 'Made', source: 'create' });

    // Publish (gzip + hash + version history + safety review).
    const form = { title: 'Daily expenses', description: 'Write down what you spend each day and see the total.', category: 'finance' as const, tags: ['money'], license: 'remix_allowed' as const };
    const pub = await alice.svc.publish({ appId: spec.id, form, makerName: 'Alice' });
    expect(pub).toMatchObject({ ok: true, status: 'published' });
    const listingId = pub.listingId!;
    expect(aiCalls).toBe(1);

    // Browse, search, preview and install as someone else.
    const page = await bob.svc.browse({});
    const listing = page.listings.find((l) => l.id === listingId);
    expect(listing).toBeDefined();
    expect((await bob.svc.browse({ text: 'money' })).listings.map((l) => l.id)).toContain(listingId);
    expect((await bob.svc.browse({ price: 'paid' })).listings).toHaveLength(0);
    expect((await bob.svc.loadSpec(listing!)).ok).toBe(true);
    const installed = await bob.svc.install(listing!, 'install');
    expect(installed).toMatchObject({ ok: true, counted: true });
    const local = await bob.db.apps.get(installed.appId!);
    expect(local?.spec.meta.basedOn).toBe(`bazaar:${listingId}`);
    expect(local?.creationInput).toBeUndefined();

    // Review, like and report (rules check every counter step).
    expect(await bob.svc.saveReview(listing!, 4, 'Simple and quick.')).toMatchObject({ ok: true });
    expect(await bob.svc.saveReview(listing!, 5, 'Even better after a week.')).toMatchObject({ ok: true });
    expect(await bob.svc.setLiked(listingId, true)).toMatchObject({ ok: true });
    expect(await bob.svc.report(listingId, 'broken', 'The total is wrong.')).toMatchObject({ ok: true });
    const counted = (await bob.svc.getListing(listingId))!.listing;
    expect(counted).toMatchObject({ installs: 1, likes: 1, ratingSum: 5, ratingCount: 1, ratingAvg: 5 });
    const reviews = await bob.svc.reviews(listingId);
    expect(reviews.canReview).toBe(true);
    expect(reviews.mine?.comment).toBe('Even better after a week.');
    expect(await alice.svc.respondToReview(listingId, 'bob', 'Thank you.')).toMatchObject({ ok: true });

    // Someone else cannot change the listing; the maker edits details without touching the spec.
    expect(await bob.svc.editDetails(listingId, { form: { ...form, title: 'Hijacked' }, makerName: 'Bob' })).toMatchObject({ ok: false });
    const edited = await alice.svc.editDetails(listingId, { form: { ...form, title: 'Daily spending' }, makerName: 'Alice' });
    expect(edited).toMatchObject({ ok: true, status: 'published' });
    const afterEdit = (await bob.svc.getListing(listingId))!.listing;
    expect(afterEdit.title).toBe('Daily spending');
    expect(afterEdit.specHash).toBe(listing!.specHash);

    // A new version: the installed copy sees the update and can take it, keeping its entries.
    await alice.db.apps.save({ ...(await alice.db.apps.get(spec.id))!, spec: { ...spec, name: 'Spend book' } }, { summary: 'Renamed', source: 'edit' });
    const v2 = await alice.svc.publish({ appId: spec.id, listingId, form: { ...form, title: 'Daily spending', changeSummary: 'New name.' }, makerName: 'Alice' });
    expect(v2).toMatchObject({ ok: true, status: 'published' });
    const check = await bob.svc.checkUpdate(installed.appId!);
    expect(check.available).toBe(true);
    expect(check.changes.some((c) => c.startsWith('Renamed'))).toBe(true);
    expect(await bob.svc.applyUpdate(installed.appId!, 'replace')).toMatchObject({ ok: true });
    expect((await bob.svc.library()).find((i) => i.localAppId === installed.appId)?.installedVersion).toBe(2);

    // Same content again reuses the safety verdict instead of calling the model.
    const before = aiCalls;
    expect(await alice.svc.recheck(listingId)).toMatchObject({ ok: true });
    expect(aiCalls).toBe(before);

    // Unpublish hides it from everyone else; installed copies stay.
    expect(await alice.svc.unpublish(listingId)).toMatchObject({ ok: true, status: 'unpublished' });
    expect((await bob.svc.browse({})).listings.map((l) => l.id)).not.toContain(listingId);
    expect(await bob.db.apps.get(installed.appId!)).toBeDefined();
    const stats = await alice.svc.creatorStats(await alice.svc.myListings());
    expect(stats).toMatchObject({ listings: 1, unpublished: 1, installs: 1, likes: 1, ratingCount: 1 });
  });
});
