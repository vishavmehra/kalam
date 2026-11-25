/**
 * Kalam Bazaar over Firestore (named database `kalam`). Decisions live in `@/core/bazaar` (pure,
 * tested); this file only moves data. Every document read back is parsed with Zod; every spec is
 * gunzipped, hash-checked and validated on this device before preview or install (docs/05 §17).
 * Wallets, paid entitlements and moderation go through the trusted functions (./functions.ts).
 */
import {
  collection, deleteField, doc, getDoc, getDocs, increment, limit, orderBy, query, runTransaction, serverTimestamp, setDoc,
  startAfter, Timestamp, updateDoc, where, writeBatch, type DocumentData, type DocumentReference, type Firestore,
  type QueryConstraint, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  applyReviewChange, BAZAAR_LIMITS, buildSafetyRequest, decidePublication, deterministicFlags, diffSpecs,
  entitlementSchema, lineageForPublish, listingIdFromBasedOn, listingSchema, listingSpecDocSchema, matchesFilters,
  newListingId, prepareInstall, preparePublication, queryTokens, reviewCacheKey, reviewSchema, sanitizeSvg, sha256Hex,
  sortListings, validateReviewInput, validateScreenshot, verifyListingSpec, walletSchema, walletTransactionSchema,
  type BazaarListing, type BazaarPage, type BazaarReview, type Entitlement, type PublicationDecision, type PublishForm,
  type SafetyVerdict, type Screenshot,
} from '@/core/bazaar';
import type {
  AIExecutionResult, AIOrchestrator, AuthService, BazaarInstallOutcome, BazaarLibraryItem, BazaarPublishOutcome,
  BazaarService, KalamDatabase, NetworkMonitor,
} from '@/core/contracts';
import { generateId } from '@/core/pipeline/create-application';
import type { KalamSpec } from '@/core/spec/schema';
import {
  cachedDrafts, cachedListings, cachedSpec, cachedVerdict, forgetDraft, forgetListing, installedFrom, rememberDraft,
  rememberInstalled, rememberListings, rememberPublishedApp, rememberSpec, rememberVerdict,
} from './cache';
import { bazaarPaymentsEnabled, callBazaar } from './functions';

export interface BazaarServiceDeps {
  firestore: () => Firestore | undefined;
  auth: AuthService;
  ai: AIOrchestrator;
  db: KalamDatabase;
  network: NetworkMonitor;
  /** Defaults to the pure SHA-256 in core (same result on every platform). */
  sha256?: (text: string) => Promise<string>;
  now?: () => number;
  paymentsEnabled?: () => boolean;
}

const OFFLINE = 'You are offline. Connect to the internet and try again.';
const NOT_SET_UP = 'Kalam Bazaar is not set up in this build.';
const SIGN_IN = 'Sign in to do this.';
const NOT_YOURS = 'You can only change your own listings.';

const millis = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : Date.now());
const errCode = (e: unknown) => (typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '');

/** Firestore → validated listing. Malformed or unexpected documents are dropped, never shown. */
function toListing(id: string, data: DocumentData | undefined): BazaarListing | undefined {
  if (!data) return undefined;
  const r = listingSchema.safeParse({ ...data, id, createdAt: millis(data.createdAt), updatedAt: millis(data.updatedAt) });
  if (!r.success) return undefined;
  // A custom icon is re-sanitised on every read; anything that fails is dropped, not rendered.
  if (r.data.iconSvg !== undefined) {
    const icon = sanitizeSvg(r.data.iconSvg);
    return icon.ok ? { ...r.data, iconSvg: icon.svg } : { ...r.data, iconSvg: undefined };
  }
  return r.data;
}
const toReview = (uid: string, data: DocumentData | undefined): BazaarReview | undefined => {
  if (!data) return undefined;
  const r = reviewSchema.safeParse({
    ...data, uid, createdAt: millis(data.createdAt), updatedAt: millis(data.updatedAt), response: data.response ?? null,
  });
  return r.success ? r.data : undefined;
};

export function createBazaarService(deps: BazaarServiceDeps): BazaarService {
  const now = deps.now ?? Date.now;
  const sha256 = deps.sha256 ?? (async (t: string) => sha256Hex(t));
  const payments = deps.paymentsEnabled ?? bazaarPaymentsEnabled;
  // ponytail: page cursors live in memory for this session; a reload starts from page one.
  const cursors = new Map<string, QueryDocumentSnapshot>();

  const fs = () => deps.firestore();
  const online = () => deps.network.online();
  const user = () => deps.auth.current();
  /** Full account (not a guest). */
  const publisher = () => {
    const u = user();
    return u && !u.isAnonymous ? u : undefined;
  };

  async function fetchListing(id: string): Promise<BazaarListing | undefined> {
    const db = fs();
    if (!db) return undefined;
    const snap = await getDoc(doc(db, 'listings', id));
    return snap.exists() ? toListing(snap.id, snap.data()) : undefined;
  }

  async function myListing(id: string): Promise<BazaarListing | undefined> {
    const u = user();
    const listing = await fetchListing(id);
    return listing && u && listing.makerUid === u.uid ? listing : undefined;
  }

  /** Spec doc from the cache when its hash matches the listing, else from Firestore. */
  async function rawSpec(listing: BazaarListing): Promise<{ doc: unknown; fromCache: boolean } | { error: string }> {
    const cached = await cachedSpec(listing.id);
    if (cached && cached.specHash === listing.specHash) return { doc: cached, fromCache: true };
    const db = fs();
    if (!db) return { error: NOT_SET_UP };
    if (!online()) return { error: 'This app has not been downloaded on this device yet. Connect to the internet to get it.' };
    try {
      const snap = await getDoc(doc(db, 'listingSpecs', listing.id));
      if (!snap.exists()) return { error: 'This app is no longer available.' };
      return { doc: snap.data(), fromCache: false };
    } catch (e) {
      if (errCode(e) === 'permission-denied' && listing.price > 0) return { error: 'Buy this app to install it.' };
      return { error: 'Could not download this app. Please try again.' };
    }
  }

  /** Deterministic flags, then the Firebase cloud review, reusing a verdict for identical content. */
  async function runChecks(spec: KalamSpec, form: Pick<PublishForm, 'title' | 'description' | 'tags'>, specHash: string, appId?: string) {
    const flags = deterministicFlags(spec, form);
    let review: AIExecutionResult<SafetyVerdict> | undefined;
    let cached = false;
    if (!flags.length) {
      const key = reviewCacheKey(specHash, form);
      const hit = await cachedVerdict(key);
      if (hit) {
        cached = true;
        review = { success: true, output: hit.verdict, provider: 'firebase', source: 'cloud', model: hit.model, latencyMs: 0, fallbackUsed: false };
      } else {
        // docs/07 §9.3: Bazaar safety review is a Firebase cloud task, routed by the orchestrator.
        review = await deps.ai.run(buildSafetyRequest(spec, form), { taskType: 'safety_review', appId, complexity: 'simple' });
        if (review.success && review.output && review.source === 'cloud') await rememberVerdict(key, review.output, review.model);
      }
    }
    return { decision: decidePublication({ specHash, flags, review, now: now() }), review, cached };
  }

  function outcome(listingId: string, d: PublicationDecision, review: AIExecutionResult<SafetyVerdict> | undefined, cached: boolean): BazaarPublishOutcome {
    return {
      ok: true,
      listingId,
      status: d.status,
      message: d.message,
      reasons: d.safety.reasons,
      ...(review ? { review: { provider: review.provider, source: review.source, model: review.model, latencyMs: review.latencyMs, cached } } : {}),
    };
  }

  /** Status changes keep the spec; rules check the passing hash and freeze counters. */
  async function setStatus(ref: DocumentReference, patch: DocumentData): Promise<void> {
    await updateDoc(ref, { ...patch, reviewed: false, updatedAt: serverTimestamp() });
  }

  /** First install of a free listing by a signed-in person: entitlement + counter in one batch. */
  async function countInstall(listing: BazaarListing): Promise<boolean> {
    const db = fs();
    const u = user();
    if (!db || !u || !online() || listing.status !== 'published' || listing.price !== 0) return false;
    const ref = doc(db, 'users', u.uid, 'purchases', listing.id);
    if ((await getDoc(ref)).exists()) return false;
    const batch = writeBatch(db);
    batch.set(ref, {
      listingId: listing.id, sellerUid: listing.makerUid, pricePaid: 0, currency: 'credits',
      installedVersion: listing.specVersion, purchasedAt: serverTimestamp(), status: 'active',
    });
    batch.update(doc(db, 'listings', listing.id), { installs: increment(1) });
    await batch.commit();
    return true;
  }

  async function myEntitlement(listingId: string): Promise<Entitlement | undefined> {
    const db = fs();
    const u = user();
    if (!db || !u || !online()) return undefined;
    try {
      const snap = await getDoc(doc(db, 'users', u.uid, 'purchases', listingId));
      const data = snap.data();
      if (!data) return undefined;
      const r = entitlementSchema.safeParse({ ...data, purchasedAt: millis(data.purchasedAt) });
      return r.success ? r.data : undefined;
    } catch {
      return undefined;
    }
  }

  /** Writes listing + current spec + version history (+ screenshots) in one batch (docs/12 §10.1-10.2). */
  async function writeListing(input: {
    db: Firestore;
    uid: string;
    listingId: string;
    isNew: boolean;
    fields: DocumentData;
    spec?: { specGz: string; specHash: string; specVersion: number; previousSpecHash: string | null; changeSummary: string };
    screenshots?: Screenshot[];
  }): Promise<void> {
    const { db, listingId } = input;
    const batch = writeBatch(db);
    if (input.spec) {
      const specDoc = { ...input.spec, makerUid: input.uid, publishedAt: serverTimestamp() };
      batch.set(doc(db, 'listingSpecs', listingId), specDoc);
      batch.set(doc(db, 'listingSpecs', listingId, 'versions', String(input.spec.specVersion)), specDoc);
    }
    if (input.isNew) {
      batch.set(doc(db, 'listings', listingId), {
        ...input.fields, installs: 0, likes: 0, ratingSum: 0, ratingCount: 0, ratingAvg: 0, featured: false, createdAt: serverTimestamp(),
      });
    } else {
      batch.update(doc(db, 'listings', listingId), input.fields);
    }
    if (input.screenshots) {
      batch.set(doc(db, 'listingMedia', listingId), {
        screenshots: input.screenshots.map((s) => ({ mimeType: s.mimeType, base64: s.base64, width: s.width, height: s.height })),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }

  /** Re-validates screenshots from their bytes before upload. */
  function checkShots(shots: Screenshot[] | undefined): { ok: true; shots?: Screenshot[] } | { ok: false; message: string } {
    if (!shots) return { ok: true };
    if (shots.length > 3) return { ok: false, message: 'Add at most 3 screenshots.' };
    const out: Screenshot[] = [];
    for (const s of shots) {
      const r = validateScreenshot(s);
      if (!r.ok) return { ok: false, message: r.reason };
      out.push(r.screenshot);
    }
    return { ok: true, shots: out };
  }

  async function installLocal(listing: BazaarListing, mode: 'install' | 'remix', appId = generateId('app')): Promise<BazaarInstallOutcome> {
    const raw = await rawSpec(listing);
    if ('error' in raw) return { ok: false, message: raw.error };
    const prepared = await prepareInstall({ listing, specDoc: raw.doc, sha256, appId, now: now(), mode });
    if (!prepared.ok) return { ok: false, message: prepared.message };
    if (!raw.fromCache) await rememberSpec(listing.id, listingSpecDocSchema.parse(raw.doc));
    try {
      // One local transaction: a failed save leaves nothing half-installed on the shelf (§11.3).
      await deps.db.apps.save(prepared.app, { summary: prepared.summary, source: 'import' });
    } catch {
      return { ok: false, message: 'Could not save the app on this device. Free up some space and try again.' };
    }
    await rememberInstalled(prepared.app.id, { listingId: listing.id, specVersion: listing.specVersion, specHash: listing.specHash });
    const counted = mode === 'install' ? await countInstall(listing).catch(() => false) : false;
    return {
      ok: true,
      appId: prepared.app.id,
      counted,
      message: mode === 'remix' ? 'Your copy is ready to change.' : 'Installed. It is on your shelf now.',
    };
  }

  const service: BazaarService = {
    isConfigured: () => !!fs(),
    paymentsEnabled: () => payments(),

    async browse(q) {
      const tokens = q.text ? queryTokens(q.text) : [];
      const pageSize = q.limit ?? BAZAAR_LIMITS.pageSize;
      const fromCache = async (): Promise<BazaarPage> => ({
        listings: sortListings((await cachedListings()).filter((l) => matchesFilters(l, q, tokens)), q.sort).slice(0, q.limit ?? 200),
        fromCache: true,
      });
      const db = fs();
      if (!db || !online()) return fromCache();
      try {
        const constraints: QueryConstraint[] = [where('status', '==', 'published')];
        if (tokens[0]) constraints.push(where('searchKeywords', 'array-contains', tokens[0]));
        else if (q.featured) constraints.push(where('featured', '==', true));
        else if (q.category) constraints.push(where('category', '==', q.category));
        const sortField = tokens.length || q.featured ? 'createdAt' : q.sort === 'popular' ? 'installs' : q.sort === 'rating' ? 'ratingAvg' : 'createdAt';
        constraints.push(orderBy(sortField, 'desc'));
        const after = q.cursor ? cursors.get(q.cursor) : undefined;
        if (after) constraints.push(startAfter(after));
        constraints.push(limit(pageSize));
        const snap = await getDocs(query(collection(db, 'listings'), ...constraints));
        const all = snap.docs.flatMap((d) => toListing(d.id, d.data()) ?? []);
        await rememberListings(all);
        const last = snap.docs.at(-1);
        let cursor: string | undefined;
        if (last && snap.docs.length === pageSize) {
          cursor = `${now()}-${cursors.size}`;
          cursors.set(cursor, last);
        }
        // Filters Firestore cannot combine with the query above are applied to this page (docs/12 §5.4).
        return { listings: all.filter((l) => matchesFilters(l, q, tokens.slice(1))), cursor, fromCache: false };
      } catch (e) {
        console.warn('[kalam] Bazaar browse failed, showing saved listings', errCode(e));
        return fromCache();
      }
    },

    async getListing(id) {
      if (fs() && online()) {
        try {
          const listing = await fetchListing(id);
          if (listing) {
            await rememberListings([listing]);
            return { listing, fromCache: false };
          }
          await forgetListing(id); // removed since we cached it
          return undefined;
        } catch (e) {
          // Hidden listings are unreadable by rule: drop the stale copy instead of showing it as "offline".
          if (errCode(e) === 'permission-denied') {
            await forgetListing(id);
            return undefined;
          }
          /* network trouble: fall through to the cache */
        }
      }
      const cached = (await cachedListings()).find((l) => l.id === id);
      return cached ? { listing: cached, fromCache: true } : undefined;
    },

    async loadSpec(listing) {
      const raw = await rawSpec(listing);
      if ('error' in raw) return { ok: false, message: raw.error };
      const verified = await verifyListingSpec(listing, raw.doc, sha256);
      if (!verified.ok) return { ok: false, message: verified.message };
      if (!raw.fromCache) await rememberSpec(listing.id, verified.doc);
      return { ok: true, spec: verified.spec, fromCache: raw.fromCache };
    },

    async loadMedia(listingId) {
      const db = fs();
      if (!db || !online()) return [];
      try {
        const data = (await getDoc(doc(db, 'listingMedia', listingId))).data();
        const shots: unknown = data?.screenshots;
        if (!Array.isArray(shots)) return [];
        return shots.slice(0, 3).flatMap((s: unknown) => {
          const r = s && typeof s === 'object' ? validateScreenshot(s as { mimeType: string; base64: string }) : undefined;
          return r?.ok ? [r.screenshot] : [];
        });
      } catch {
        return [];
      }
    },

    install: (listing, mode) => installLocal(listing, mode),

    async purchase(listing) {
      if (!payments()) return { ok: false, message: 'Paid apps are not available yet.' };
      if (!publisher()) return { ok: false, message: 'Sign in with email or Google to buy apps.' };
      if (!online()) return { ok: false, message: OFFLINE };
      const res = await callBazaar<{ listingId: string; expectedPrice: number }, { alreadyOwned: boolean; credits: number }>(
        'kalamBazaarPurchase', { listingId: listing.id, expectedPrice: listing.price },
      );
      if (!res.ok) return { ok: false, message: res.message };
      const installed = await installLocal(listing, 'install');
      const paid = res.data.alreadyOwned ? 'You already own this app.' : `Bought for ${listing.price} credits. ${res.data.credits} left.`;
      return installed.ok ? { ...installed, message: `${paid} It is on your shelf now.` } : { ok: false, message: `${paid} ${installed.message}` };
    },

    async publish(input, onStage) {
      const db = fs();
      if (!db) return { ok: false, message: NOT_SET_UP };
      const u = publisher();
      if (!u) return { ok: false, message: 'Sign in with email or Google to share apps.' };
      if (!online()) return { ok: false, message: 'You are offline. Your details are kept. Connect to the internet to share your app.' };
      if ((input.form.price ?? 0) > 0 && !payments()) return { ok: false, message: 'Paid apps are not available yet. Set the price to free.' };
      onStage?.('validating');
      const app = await deps.db.apps.get(input.appId);
      if (!app) return { ok: false, message: 'That app is no longer on this device.' };

      let listingId = newListingId();
      let specVersion = 1;
      let previousSpecHash: string | null = null;
      let existing: BazaarListing | undefined;
      if (input.listingId) {
        existing = await myListing(input.listingId);
        if (!existing) return { ok: false, message: 'You can only update your own listings.' };
        if (existing.status === 'suspended') return { ok: false, message: 'This listing is suspended and cannot be changed.' };
        listingId = existing.id;
        specVersion = existing.specVersion + 1;
        previousSpecHash = existing.specHash;
      }
      // Walk local duplicates back to a Bazaar original (licence + lineage), at most 5 hops.
      const chain = [app.spec.meta];
      for (let id = app.spec.meta.basedOn; id && !listingIdFromBasedOn(id) && chain.length < 6;) {
        const ancestor = await deps.db.apps.get(id);
        if (!ancestor) break;
        chain.push(ancestor.spec.meta);
        id = ancestor.spec.meta.basedOn;
      }
      const lineage = lineageForPublish(chain);
      if (!lineage.ok) return { ok: false, message: lineage.message };
      const parentId = lineage.listingId;
      const parent = parentId ? (await service.getListing(parentId).catch(() => undefined))?.listing : undefined;
      const shots = checkShots(input.screenshots);
      if (!shots.ok) return { ok: false, message: shots.message };
      const prepared = preparePublication({
        spec: app.spec,
        form: { ...input.form, screenshotCount: shots.shots ? shots.shots.length : (input.form.screenshotCount ?? existing?.screenshotCount ?? 0) },
        listingId, makerUid: u.uid, makerName: input.makerName, specVersion,
        basedOn: parentId ? { listingId: parentId, title: parent?.title ?? '', makerName: parent?.makerName ?? '' } : null,
      });
      if (!prepared.ok) return { ok: false, message: prepared.message, issues: prepared.issues };
      const specHash = await sha256(prepared.specJson);

      onStage?.('checking');
      const { decision, review, cached } = await runChecks(prepared.spec, input.form, specHash, app.id);

      onStage?.('saving');
      const { id: _id, ...draft } = prepared.draft;
      try {
        await writeListing({
          db, uid: u.uid, listingId, isNew: !input.listingId,
          fields: { ...draft, specHash, status: decision.status, reviewed: false, safety: decision.safety, updatedAt: serverTimestamp() },
          spec: { specGz: prepared.specGz, specHash, specVersion, previousSpecHash, changeSummary: prepared.draft.changeSummary },
          screenshots: shots.shots,
        });
      } catch (e) {
        console.warn('[kalam] Bazaar publish write failed', errCode(e));
        return { ok: false, message: 'Could not save your listing. Please try again.' };
      }
      await rememberSpec(listingId, {
        specGz: prepared.specGz, specHash, specVersion, makerUid: u.uid, previousSpecHash, changeSummary: prepared.draft.changeSummary,
      });
      await rememberPublishedApp(listingId, app.id);
      await forgetDraft(app.id);
      return outcome(listingId, decision, review, cached);
    },

    async editDetails(listingId, input) {
      const db = fs();
      if (!db) return { ok: false, message: NOT_SET_UP };
      const u = publisher();
      if (!u) return { ok: false, message: SIGN_IN };
      if (!online()) return { ok: false, message: OFFLINE };
      if ((input.form.price ?? 0) > 0 && !payments()) return { ok: false, message: 'Paid apps are not available yet. Set the price to free.' };
      const listing = await myListing(listingId);
      if (!listing) return { ok: false, message: NOT_YOURS };
      if (listing.status === 'suspended') return { ok: false, message: 'This listing is suspended and cannot be changed.' };
      const raw = await rawSpec(listing);
      if ('error' in raw) return { ok: false, message: raw.error };
      const verified = await verifyListingSpec(listing, raw.doc, sha256);
      if (!verified.ok) return { ok: false, message: verified.message };
      const shots = checkShots(input.screenshots);
      if (!shots.ok) return { ok: false, message: shots.message };
      // The licence lives inside the published spec, so it changes only with a new version (§13.2).
      const form: PublishForm = { ...input.form, license: listing.license, screenshotCount: shots.shots ? shots.shots.length : listing.screenshotCount };
      const prepared = preparePublication({
        spec: verified.spec, form, listingId, makerUid: u.uid, makerName: input.makerName, specVersion: listing.specVersion, basedOn: listing.basedOn,
      });
      if (!prepared.ok) return { ok: false, message: prepared.message, issues: prepared.issues };
      const { decision, review, cached } = await runChecks(verified.spec, form, listing.specHash);
      const d = prepared.draft;
      try {
        await writeListing({
          db, uid: u.uid, listingId, isNew: false,
          fields: {
            title: d.title, description: d.description, category: d.category, tags: d.tags, lang: d.lang, price: d.price,
            makerName: d.makerName, searchKeywords: d.searchKeywords, screenshotCount: d.screenshotCount,
            ...(form.iconSvg !== undefined ? { iconSvg: d.iconSvg ?? deleteField() } : {}),
            status: decision.status, safety: decision.safety, reviewed: false, updatedAt: serverTimestamp(),
          },
          screenshots: shots.shots,
        });
      } catch (e) {
        console.warn('[kalam] Bazaar edit failed', errCode(e));
        return { ok: false, message: 'Could not save your changes. Please try again.' };
      }
      return outcome(listingId, decision, review, cached);
    },

    async recheck(listingId) {
      const db = fs();
      if (!db) return { ok: false, message: NOT_SET_UP };
      if (!publisher()) return { ok: false, message: SIGN_IN };
      if (!online()) return { ok: false, message: OFFLINE };
      const listing = await myListing(listingId);
      if (!listing) return { ok: false, message: NOT_YOURS };
      if (listing.status === 'suspended') return { ok: false, message: 'This listing is suspended and cannot be changed.' };
      const ref = doc(db, 'listings', listingId);
      // Unpublished after passing on this exact spec: show it again without a new model call.
      if (listing.status === 'unpublished' && listing.safety.verdict === 'pass' && listing.safety.specHash === listing.specHash) {
        await setStatus(ref, { status: 'published' });
        return { ok: true, listingId, status: 'published', message: 'Your app is live in Kalam Bazaar again.' };
      }
      const raw = await rawSpec(listing);
      if ('error' in raw) return { ok: false, message: raw.error };
      const verified = await verifyListingSpec(listing, raw.doc, sha256);
      if (!verified.ok) return { ok: false, message: verified.message };
      const { decision, review, cached } = await runChecks(verified.spec, listing, listing.specHash);
      await setStatus(ref, { status: decision.status, safety: decision.safety });
      return outcome(listingId, decision, review, cached);
    },

    async unpublish(listingId) {
      const db = fs();
      if (!db) return { ok: false, message: NOT_SET_UP };
      if (!online()) return { ok: false, message: OFFLINE };
      const listing = await myListing(listingId);
      if (!listing) return { ok: false, message: NOT_YOURS };
      await setStatus(doc(db, 'listings', listingId), { status: 'unpublished' });
      await forgetListing(listingId);
      return { ok: true, listingId, status: 'unpublished', message: 'Your app is hidden from Kalam Bazaar. Copies people installed keep working.' };
    },

    async myListings() {
      const db = fs();
      const u = user();
      if (!db || !u || !online()) return [];
      const snap = await getDocs(query(collection(db, 'listings'), where('makerUid', '==', u.uid), limit(100)));
      return snap.docs.flatMap((d) => toListing(d.id, d.data()) ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async isLiked(listingId) {
      const db = fs();
      const u = user();
      if (!db || !u || !online()) return false;
      try {
        return (await getDoc(doc(db, 'listings', listingId, 'likes', u.uid))).exists();
      } catch {
        return false;
      }
    },

    async setLiked(listingId, liked) {
      const db = fs();
      const u = user();
      if (!db) return { ok: false, message: NOT_SET_UP };
      if (!u) return { ok: false, message: SIGN_IN };
      if (!online()) return { ok: false, message: OFFLINE };
      const batch = writeBatch(db);
      const likeRef = doc(db, 'listings', listingId, 'likes', u.uid);
      if (liked) batch.set(likeRef, { createdAt: serverTimestamp() });
      else batch.delete(likeRef);
      batch.update(doc(db, 'listings', listingId), { likes: increment(liked ? 1 : -1) });
      try {
        await batch.commit();
        return { ok: true };
      } catch {
        return { ok: false, message: 'Could not save that. Please try again.' };
      }
    },

    async report(listingId, reason, note) {
      const db = fs();
      const u = user();
      if (!db) return { ok: false, message: NOT_SET_UP };
      if (!u) return { ok: false, message: SIGN_IN };
      if (!online()) return { ok: false, message: OFFLINE };
      try {
        await setDoc(doc(db, 'reports', `${listingId}_${u.uid}`), {
          listingId, reporterUid: u.uid, reason, note: note.trim().slice(0, BAZAAR_LIMITS.reportNote), createdAt: serverTimestamp(),
        });
        return { ok: true, message: 'Thank you. The Kalam team will look at this app.' };
      } catch {
        return { ok: false, message: 'You have already reported this app, or the report could not be sent.' };
      }
    },

    async wallet() {
      const enabled = payments();
      const u = publisher();
      const db = fs();
      if (!enabled) return { enabled, signedIn: !!u, transactions: [], message: 'Credits are not switched on yet.' };
      if (!u) return { enabled, signedIn: false, transactions: [] };
      if (!db || !online()) return { enabled, signedIn: true, transactions: [], message: OFFLINE };
      try {
        const [walletSnap, bought, sold] = await Promise.all([
          getDoc(doc(db, 'wallets', u.uid)),
          getDocs(query(collection(db, 'walletTransactions'), where('buyerUid', '==', u.uid), orderBy('createdAt', 'desc'), limit(50))),
          getDocs(query(collection(db, 'walletTransactions'), where('sellerUid', '==', u.uid), orderBy('createdAt', 'desc'), limit(50))),
        ]);
        const w = walletSnap.data();
        const wallet = w ? walletSchema.safeParse({ ...w, updatedAt: millis(w.updatedAt) }) : undefined;
        const seen = new Set<string>();
        const transactions = [...bought.docs, ...sold.docs].flatMap((d) => {
          if (seen.has(d.id)) return [];
          seen.add(d.id);
          const data = d.data();
          const r = walletTransactionSchema.safeParse({ ...data, id: d.id, createdAt: millis(data.createdAt) });
          return r.success ? [r.data] : [];
        }).sort((a, b) => b.createdAt - a.createdAt);
        return { enabled, signedIn: true, wallet: wallet?.success ? wallet.data : undefined, transactions };
      } catch {
        return { enabled, signedIn: true, transactions: [], message: 'Could not load your credits. Please try again.' };
      }
    },

    async claimStarterCredits() {
      if (!payments()) return { ok: false, message: 'Credits are not switched on yet.' };
      if (!publisher()) return { ok: false, message: 'Sign in with email or Google to get credits.' };
      if (!online()) return { ok: false, message: OFFLINE };
      const res = await callBazaar<Record<string, never>, { credits: number; created: boolean }>('kalamBazaarWallet', {});
      if (!res.ok) return { ok: false, message: res.message };
      return {
        ok: true,
        credits: res.data.credits,
        message: res.data.created ? `You have ${res.data.credits} credits to try paid apps.` : 'Your wallet is ready.',
      };
    },

    async reviews(listingId) {
      const db = fs();
      const u = user();
      if (!db || !online()) return { reviews: [], canReview: false };
      try {
        const snap = await getDocs(query(
          collection(db, 'listings', listingId, 'reviews'), where('status', '==', 'visible'), orderBy('updatedAt', 'desc'), limit(50),
        ));
        const reviews = snap.docs.flatMap((d) => toReview(d.id, d.data()) ?? []);
        if (!u) return { reviews, canReview: false };
        const [mineSnap, entitlement] = await Promise.all([
          getDoc(doc(db, 'listings', listingId, 'reviews', u.uid)).catch(() => undefined),
          myEntitlement(listingId),
        ]);
        return { reviews, mine: toReview(u.uid, mineSnap?.data()), canReview: entitlement?.status === 'active' };
      } catch {
        return { reviews: [], canReview: false };
      }
    },

    async saveReview(listing, rating, comment) {
      const db = fs();
      const u = user();
      if (!db) return { ok: false, message: NOT_SET_UP };
      if (!u) return { ok: false, message: SIGN_IN };
      if (!online()) return { ok: false, message: OFFLINE };
      const invalid = validateReviewInput(rating, comment);
      if (invalid) return { ok: false, message: invalid };
      const listingRef = doc(db, 'listings', listing.id);
      const reviewRef = doc(db, 'listings', listing.id, 'reviews', u.uid);
      try {
        await runTransaction(db, async (tx) => {
          const [l, existing] = await Promise.all([tx.get(listingRef), tx.get(reviewRef)]);
          const data = l.data();
          if (!data) throw new Error('missing listing');
          const before = existing.exists() ? Number(existing.data().rating) : null;
          const totals = applyReviewChange({ ratingSum: Number(data.ratingSum) || 0, ratingCount: Number(data.ratingCount) || 0 }, before, rating);
          const text = { rating, comment: comment.trim(), authorName: (u.displayName ?? '').slice(0, 40).replace(/[<>]/g, ''), appVersion: Number(data.specVersion) || 1 };
          if (existing.exists()) tx.update(reviewRef, { ...text, updatedAt: serverTimestamp() });
          else tx.set(reviewRef, { ...text, status: 'visible', response: null, respondedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          tx.update(listingRef, totals);
        });
        return { ok: true, message: 'Thank you. Your review is saved.' };
      } catch (e) {
        return {
          ok: false,
          message: errCode(e) === 'permission-denied'
            ? 'Install this app before you review it.'
            : 'Could not save your review. Please try again.',
        };
      }
    },

    async deleteReview(listing) {
      const db = fs();
      const u = user();
      if (!db || !u) return { ok: false, message: SIGN_IN };
      if (!online()) return { ok: false, message: OFFLINE };
      const listingRef = doc(db, 'listings', listing.id);
      const reviewRef = doc(db, 'listings', listing.id, 'reviews', u.uid);
      try {
        await runTransaction(db, async (tx) => {
          const [l, existing] = await Promise.all([tx.get(listingRef), tx.get(reviewRef)]);
          const data = l.data();
          if (!data || !existing.exists()) return;
          tx.delete(reviewRef);
          tx.update(listingRef, applyReviewChange(
            { ratingSum: Number(data.ratingSum) || 0, ratingCount: Number(data.ratingCount) || 0 }, Number(existing.data().rating), null,
          ));
        });
        return { ok: true, message: 'Your review is removed.' };
      } catch {
        return { ok: false, message: 'Could not remove your review. Please try again.' };
      }
    },

    async respondToReview(listingId, reviewerUid, response) {
      const db = fs();
      if (!db || !user()) return { ok: false, message: SIGN_IN };
      if (!online()) return { ok: false, message: OFFLINE };
      const text = response.trim();
      if (!text || text.length > 500 || /[<>]/.test(text)) return { ok: false, message: 'Write a reply of up to 500 characters, without < or >.' };
      try {
        await updateDoc(doc(db, 'listings', listingId, 'reviews', reviewerUid), { response: text, respondedAt: serverTimestamp() });
        return { ok: true, message: 'Your reply is posted.' };
      } catch {
        return { ok: false, message: 'Could not post your reply. Please try again.' };
      }
    },

    async library() {
      const apps = await deps.db.apps.list();
      const items = new Map<string, BazaarLibraryItem>();
      const cards = await cachedListings();
      for (const app of apps) {
        const listingId = listingIdFromBasedOn(app.spec.meta.basedOn);
        if (!listingId || app.spec.meta.source !== 'import') continue;
        const from = await installedFrom(app.id);
        const listing = cards.find((l) => l.id === listingId);
        items.set(`${listingId}:${app.id}`, {
          listingId, listing, localAppId: app.id, localName: app.spec.name, installedVersion: from?.specVersion,
          updateAvailable: !!(listing && from && listing.status === 'published' && listing.specVersion > from.specVersion),
        });
      }
      const db = fs();
      const u = user();
      if (db && online()) {
        // Fresh listing cards for update checks; the cached copy stays when a read fails.
        const ids = [...new Set([...items.values()].map((i) => i.listingId))];
        const fresh = await Promise.all(ids.map((id) => service.getListing(id).catch(() => undefined)));
        for (const got of fresh) {
          if (!got) continue;
          for (const item of items.values()) {
            if (item.listingId !== got.listing.id) continue;
            item.listing = got.listing;
            item.updateAvailable = got.listing.status === 'published' && item.installedVersion !== undefined && got.listing.specVersion > item.installedVersion;
          }
        }
      }
      if (db && u && online()) {
        try {
          const snap = await getDocs(collection(db, 'users', u.uid, 'purchases'));
          for (const d of snap.docs) {
            const data = d.data();
            const e = entitlementSchema.safeParse({ ...data, purchasedAt: millis(data.purchasedAt) });
            if (!e.success) continue;
            const local = [...items.values()].filter((i) => i.listingId === e.data.listingId);
            if (local.length) for (const i of local) i.entitlement = e.data;
            else items.set(e.data.listingId, { listingId: e.data.listingId, entitlement: e.data, listing: cards.find((l) => l.id === e.data.listingId), updateAvailable: false });
          }
        } catch {
          /* offline or not allowed: the local part still works (§19.1) */
        }
      }
      return [...items.values()];
    },

    async checkUpdate(appId) {
      const app = await deps.db.apps.get(appId);
      const listingId = listingIdFromBasedOn(app?.spec.meta.basedOn);
      if (!app || !listingId) return { available: false, changes: [], localEdits: false };
      const from = await installedFrom(appId);
      const localEdits = (await deps.db.versions.list(appId)).length > 1;
      const got = await service.getListing(listingId);
      if (!got) return { available: false, changes: [], localEdits, message: 'This app is no longer in Kalam Bazaar. Your copy keeps working.' };
      const { listing } = got;
      if (!from || listing.specVersion <= from.specVersion) return { available: false, listing, installedVersion: from?.specVersion, changes: [], localEdits };
      const spec = await service.loadSpec(listing);
      if (!spec.ok) return { available: true, listing, installedVersion: from.specVersion, changes: [], localEdits, message: spec.message };
      return { available: true, listing, installedVersion: from.specVersion, changes: diffSpecs(app.spec, spec.spec), localEdits };
    },

    async applyUpdate(appId, mode) {
      const app = await deps.db.apps.get(appId);
      const listingId = listingIdFromBasedOn(app?.spec.meta.basedOn);
      if (!app || !listingId) return { ok: false, message: 'This app did not come from Kalam Bazaar.' };
      const got = await service.getListing(listingId);
      if (!got) return { ok: false, message: 'This app is no longer in Kalam Bazaar. Your copy keeps working.' };
      if (mode === 'copy') return installLocal(got.listing, 'install');
      // Replace: same app id, so entries stay; the old design stays in this app's history (§10.4).
      const raw = await rawSpec(got.listing);
      if ('error' in raw) return { ok: false, message: raw.error };
      const prepared = await prepareInstall({ listing: got.listing, specDoc: raw.doc, sha256, appId, now: now(), mode: 'install' });
      if (!prepared.ok) return { ok: false, message: prepared.message };
      try {
        await deps.db.apps.save(
          { ...app, spec: { ...prepared.app.spec, name: app.spec.name } },
          { summary: `Updated from Kalam Bazaar to version ${got.listing.specVersion}`, source: 'import' },
        );
      } catch {
        return { ok: false, message: 'Could not update the app. Your current version is unchanged.' };
      }
      await rememberInstalled(appId, { listingId, specVersion: got.listing.specVersion, specHash: got.listing.specHash });
      return { ok: true, appId, message: 'Updated. Your entries are kept, and the old design is in the app history.' };
    },

    async creatorStats(listings) {
      const count = (s: BazaarListing['status']) => listings.filter((l) => l.status === s).length;
      const ratingCount = listings.reduce((n, l) => n + l.ratingCount, 0);
      const ratingSum = listings.reduce((n, l) => n + l.ratingSum, 0);
      let creditsEarned = 0;
      const db = fs();
      const u = publisher();
      if (payments() && db && u && online()) {
        try {
          const sold = await getDocs(query(collection(db, 'walletTransactions'), where('sellerUid', '==', u.uid), limit(500)));
          for (const d of sold.docs) {
            const t = walletTransactionSchema.safeParse({ ...d.data(), id: d.id, createdAt: millis(d.data().createdAt) });
            if (!t.success) continue;
            if (t.data.type === 'purchase' && t.data.status === 'completed') creditsEarned += t.data.amount;
          }
        } catch {
          /* earnings are optional on this screen */
        }
      }
      return {
        listings: listings.length,
        published: count('published'),
        waiting: count('pending_review'),
        needsChanges: count('rejected'),
        unpublished: count('unpublished'),
        installs: listings.reduce((n, l) => n + l.installs, 0),
        likes: listings.reduce((n, l) => n + l.likes, 0),
        ratingCount,
        ratingAvg: ratingCount ? Math.round((ratingSum * 10) / ratingCount) / 10 : 0,
        creditsEarned,
      };
    },

    drafts: () => cachedDrafts(),
    saveDraft: (draft) => rememberDraft(draft),
    removeDraft: (appId) => forgetDraft(appId),
  };
  return service;
}
