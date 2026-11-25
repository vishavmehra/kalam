/**
 * On-device state for Bazaar (docs/12 §19, §20): listing cards for read-only offline browsing,
 * downloaded spec documents (so an app opened before can still be installed offline), which
 * listing version each installed copy came from, publish drafts (form content is never lost when
 * offline, §19.3) and safety verdicts keyed by content (no repeated review calls, §20.1).
 * AsyncStorage works on web (localStorage) and Android. Everything read back is re-validated.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import {
  BAZAAR_CATEGORIES, LICENSES, listingSchema, listingSpecDocSchema, safetyVerdictSchema, type BazaarListing,
  type ListingSpecDoc, type SafetyVerdict,
} from '@/core/bazaar';
import type { BazaarDraft } from '@/core/contracts';

const LISTINGS_KEY = 'kalam.bazaar.listings.v2';
const SPEC_INDEX_KEY = 'kalam.bazaar.specs.v2';
const specKey = (id: string) => `kalam.bazaar.spec.v2.${id}`;
const PUBLISHED_KEY = 'kalam.bazaar.published.v1';
const INSTALLED_KEY = 'kalam.bazaar.installed.v1';
const DRAFTS_KEY = 'kalam.bazaar.drafts.v1';
const REVIEWS_KEY = 'kalam.bazaar.reviews.v1';
// ponytail: small fixed caps (cards ~2-10 KB, compressed specs ~10-40 KB) keep localStorage well under 5 MB.
const MAX_LISTINGS = 120;
const MAX_SPECS = 12;
const MAX_REVIEWS = 50;

async function readJson(key: string): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}
async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Cache only: a full or blocked storage never breaks the Bazaar.
  }
}
const record = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

// ─── Listing cards ────────────────────────────────────────────────────────────

export async function cachedListings(): Promise<BazaarListing[]> {
  const raw = await readJson(LISTINGS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const r = listingSchema.safeParse(x);
    return r.success ? [r.data] : [];
  });
}

/** Newest first; replaces older copies of the same listing. */
export async function rememberListings(listings: BazaarListing[]): Promise<void> {
  if (!listings.length) return;
  const fresh = new Map(listings.map((l) => [l.id, l]));
  const kept = (await cachedListings()).filter((l) => !fresh.has(l.id));
  await writeJson(LISTINGS_KEY, [...fresh.values(), ...kept].slice(0, MAX_LISTINGS));
}

export async function forgetListing(id: string): Promise<void> {
  const all = await cachedListings();
  if (all.some((l) => l.id === id)) await writeJson(LISTINGS_KEY, all.filter((l) => l.id !== id));
}

// ─── Spec documents ───────────────────────────────────────────────────────────

export async function cachedSpec(id: string): Promise<ListingSpecDoc | undefined> {
  const r = listingSpecDocSchema.safeParse(await readJson(specKey(id)));
  return r.success ? r.data : undefined;
}

export async function rememberSpec(id: string, doc: ListingSpecDoc): Promise<void> {
  const index = await readJson(SPEC_INDEX_KEY);
  const ids = [id, ...(Array.isArray(index) ? index.filter((x): x is string => typeof x === 'string' && x !== id) : [])];
  for (const old of ids.slice(MAX_SPECS)) {
    try { await AsyncStorage.removeItem(specKey(old)); } catch { /* cache only */ }
  }
  await writeJson(specKey(id), doc);
  await writeJson(SPEC_INDEX_KEY, ids.slice(0, MAX_SPECS));
}

// ─── Published and installed copies ───────────────────────────────────────────

/** Which local app a listing of mine was published from (so "new version" can preselect it). */
export async function rememberPublishedApp(listingId: string, appId: string): Promise<void> {
  await writeJson(PUBLISHED_KEY, { ...record(await readJson(PUBLISHED_KEY)), [listingId]: appId });
}

export async function publishedAppFor(listingId: string): Promise<string | undefined> {
  const v = record(await readJson(PUBLISHED_KEY))[listingId];
  return typeof v === 'string' ? v : undefined;
}

const installedSchema = z.object({ listingId: z.string(), specVersion: z.number().int().min(1), specHash: z.string() });
export type InstalledFrom = z.infer<typeof installedSchema>;

/** The listing version each installed copy came from (docs/12 §10.3 update checks). */
export async function rememberInstalled(appId: string, from: InstalledFrom): Promise<void> {
  await writeJson(INSTALLED_KEY, { ...record(await readJson(INSTALLED_KEY)), [appId]: from });
}

export async function installedFrom(appId: string): Promise<InstalledFrom | undefined> {
  const r = installedSchema.safeParse(record(await readJson(INSTALLED_KEY))[appId]);
  return r.success ? r.data : undefined;
}

// ─── Drafts (docs/12 §19.3) ───────────────────────────────────────────────────

const draftSchema = z.object({
  appId: z.string().min(1),
  listingId: z.string().optional(),
  makerName: z.string().max(40),
  savedAt: z.number(),
  form: z.object({
    title: z.string().max(200),
    description: z.string().max(2000),
    category: z.enum(BAZAAR_CATEGORIES),
    tags: z.array(z.string().max(60)).max(20),
    license: z.enum(LICENSES),
    price: z.number().int().optional(),
    lang: z.string().max(12).optional(),
    changeSummary: z.string().max(400).optional(),
    iconSvg: z.string().max(16_000).optional(),
    screenshotCount: z.number().int().optional(),
  }),
});

export async function cachedDrafts(): Promise<BazaarDraft[]> {
  const raw = await readJson(DRAFTS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const r = draftSchema.safeParse(x);
    return r.success ? [r.data as BazaarDraft] : [];
  }).sort((a, b) => b.savedAt - a.savedAt);
}

export async function rememberDraft(draft: BazaarDraft): Promise<void> {
  const rest = (await cachedDrafts()).filter((d) => d.appId !== draft.appId);
  await writeJson(DRAFTS_KEY, [draft, ...rest].slice(0, 20));
}

export async function forgetDraft(appId: string): Promise<void> {
  await writeJson(DRAFTS_KEY, (await cachedDrafts()).filter((d) => d.appId !== appId));
}

// ─── Safety verdicts by content (docs/12 §20.1, §24) ──────────────────────────

const reviewEntry = z.object({ key: z.string(), verdict: safetyVerdictSchema, model: z.string().optional(), at: z.number() });

export async function cachedVerdict(key: string): Promise<{ verdict: SafetyVerdict; model?: string } | undefined> {
  const raw = await readJson(REVIEWS_KEY);
  if (!Array.isArray(raw)) return undefined;
  for (const x of raw) {
    const r = reviewEntry.safeParse(x);
    if (r.success && r.data.key === key) return { verdict: r.data.verdict, model: r.data.model };
  }
  return undefined;
}

export async function rememberVerdict(key: string, verdict: SafetyVerdict, model?: string): Promise<void> {
  const raw = await readJson(REVIEWS_KEY);
  const rest = Array.isArray(raw) ? raw.filter((x) => reviewEntry.safeParse(x).success && (x as { key: string }).key !== key) : [];
  await writeJson(REVIEWS_KEY, [{ key, verdict, ...(model ? { model } : {}), at: Date.now() }, ...rest].slice(0, MAX_REVIEWS));
}
