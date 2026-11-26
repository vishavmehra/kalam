/**
 * Kalam Bazaar data model (docs/12 §6, §16, §18.3). Pure TypeScript + Zod.
 *
 * Listings are public, compact browse cards (< 20 KB). The KalamSpec lives in a separate
 * `listingSpecs` doc (gzip + hash) and is fetched only for preview / install (docs/12 §5.5).
 * Everything read back from Firestore is untrusted and is parsed with these schemas first.
 */
import { z } from 'zod';
import { iconSchema, LIMITS, PERMISSION_KINDS } from '../spec/schema';

export const BAZAAR_CATEGORIES = [
  'business', 'education', 'finance', 'productivity', 'health', 'personal', 'field_work', 'utilities', 'creative',
] as const;
export type BazaarCategory = (typeof BAZAAR_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<BazaarCategory, string> = {
  business: 'Business', education: 'Education', finance: 'Finance', productivity: 'Productivity',
  health: 'Health and wellness', personal: 'Personal', field_work: 'Field work', utilities: 'Utilities', creative: 'Creative',
};
/** Sensitive-use categories get an extra line on the listing (docs/12 §5.2). */
export const SENSITIVE_CATEGORIES: ReadonlySet<BazaarCategory> = new Set(['health', 'finance']);

// ─── Listing state machine (docs/12 §18.3, implemented once, here) ────────────

/** Stored statuses. `suspended`, `reviewed: true` and `featured: true` are set only by the trusted function. */
export const LISTING_STATUSES = ['pending_review', 'published', 'rejected', 'unpublished', 'suspended'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];
/** Stages that exist only on the publisher's device and are never written. */
export type LocalListingStatus = 'draft' | 'pending_validation';
export type LifecycleStatus = LocalListingStatus | ListingStatus;
/** What a maker's own client may write (firestore.rules mirrors this list). */
export const CLIENT_STATUSES: readonly ListingStatus[] = ['pending_review', 'published', 'rejected', 'unpublished'];

const MAKER_MOVES: Record<LifecycleStatus, readonly LifecycleStatus[]> = {
  draft: ['draft', 'pending_validation'],
  pending_validation: ['draft', 'pending_review', 'published', 'rejected'],
  pending_review: ['pending_review', 'published', 'rejected', 'unpublished'],
  published: ['published', 'pending_review', 'rejected', 'unpublished'],
  rejected: ['rejected', 'pending_review', 'published', 'unpublished'],
  unpublished: ['unpublished', 'pending_review', 'published', 'rejected'],
  suspended: [],
};

/** The single transition check used by the service, the UI and mirrored by firestore.rules. */
export function canMove(from: LifecycleStatus, to: LifecycleStatus, actor: 'maker' | 'moderator'): boolean {
  if (actor === 'moderator') return to !== 'draft' && to !== 'pending_validation';
  return MAKER_MOVES[from].includes(to);
}

export type MakerAction = 'view' | 'unpublish' | 'recheck' | 'show_again' | 'new_version' | 'edit_details';
/** Buttons a maker sees for a listing in Creator Studio. */
export function makerActions(status: ListingStatus): MakerAction[] {
  switch (status) {
    case 'published': return ['view', 'edit_details', 'new_version', 'unpublish'];
    case 'pending_review': return ['recheck', 'edit_details', 'new_version', 'unpublish'];
    case 'rejected': return ['edit_details', 'new_version'];
    case 'unpublished': return ['show_again', 'edit_details', 'new_version'];
    case 'suspended': return [];
  }
}

/** Plain-language status for badges. A creator publishing never counts as "reviewed" (docs/12 §6.1). */
export function statusLabel(l: { status: LifecycleStatus; reviewed?: boolean }): string {
  switch (l.status) {
    case 'draft': return 'Draft';
    case 'pending_validation': return 'Checking';
    case 'published': return l.reviewed ? 'Reviewed' : 'Passed automatic checks';
    case 'pending_review': return 'Waiting for checks';
    case 'rejected': return 'Needs changes';
    case 'unpublished': return 'Unpublished';
    case 'suspended': return 'Suspended';
  }
}

// ─── Licence and price ────────────────────────────────────────────────────────

/** Reuse policy (docs/12 §15.3). Mirrors `meta.license` in the KalamSpec schema. */
export const LICENSES = ['personal', 'remix_allowed', 'all_rights_reserved'] as const;
export type ListingLicense = (typeof LICENSES)[number];
/** Only `remix_allowed` permits remixing; the other two allow installing and using a copy. */
export const remixAllowedFor = (license: ListingLicense): boolean => license === 'remix_allowed';
export const LICENSE_LABELS: Record<ListingLicense, string> = {
  remix_allowed: 'You may remix it. The maker stays credited.',
  all_rights_reserved: 'Install and use only. Remixing is not allowed.',
  personal: 'For personal use. Remixing is not allowed.',
};

/** Prototype credit economy (docs/12 §12): not real money. */
export const STARTING_CREDITS = 100;
export const MAX_PRICE = 1000;
export const priceLabel = (price: number): string => (price === 0 ? 'Free' : `${price} ${price === 1 ? 'credit' : 'credits'}`);
export function validatePrice(price: number): string | undefined {
  if (!Number.isInteger(price) || price < 0) return 'Use a whole number of credits.';
  if (price > MAX_PRICE) return `The highest price is ${MAX_PRICE} credits.`;
  return undefined;
}

export const REPORT_REASONS = ['malicious', 'misleading', 'privacy', 'copyright', 'spam', 'inappropriate', 'broken'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Size limits shared with firestore.rules. */
export const BAZAAR_LIMITS = {
  title: LIMITS.nameLength,
  description: 500,
  tags: 8,
  tagLength: 24,
  keywords: 40,
  keywordLength: 30,
  makerName: 40,
  capabilities: 12,
  capabilityLength: 80,
  reasons: 5,
  reasonLength: 200,
  changeSummary: 200,
  /** Published spec JSON, UTF-8 bytes (docs/11 §11.1: under 100 KB). */
  specBytes: 100_000,
  /** base64 of the gzip of at most `specBytes` (incompressible worst case, with headroom). */
  specGzChars: 140_000,
  /** Browse card document target (docs/12 §16.1). */
  listingBytes: 20_000,
  reportNote: 500,
  pageSize: 20,
} as const;

const sha = z.string().regex(/^[0-9a-f]{64}$/);

/** Result of the publish-time checks (deterministic + Firebase cloud safety review). Client-asserted. */
export const safetySchema = z.object({
  verdict: z.enum(['pass', 'flagged', 'unavailable']),
  reasons: z.array(z.string().max(BAZAAR_LIMITS.reasonLength)).max(BAZAAR_LIMITS.reasons),
  /** Hash of the spec the check ran on: a check never carries over to different content. */
  specHash: sha,
  model: z.string().max(80).optional(),
  checkedAt: z.number().int().nonnegative(),
});
export type SafetyResult = z.infer<typeof safetySchema>;

/** One line of the permissions disclosure, the permission and its reason. firestore.rules bounds the list (4 lines, 600 characters). */
export const PERMISSION_LINE_LENGTH = 150;

/** Derived from the validated spec, never from creator claims (docs/12 §7.2-7.4). */
export const disclosureSchema = z.object({
  /** Collection labels: what records the app keeps on the installer's device. */
  stores: z.array(z.string().max(LIMITS.labelLength)).max(LIMITS.collections),
  usesPhotos: z.boolean(),
  /** Plain-language AI feature names. Empty when the app has no AI blocks. */
  aiFeatures: z.array(z.string().max(BAZAAR_LIMITS.capabilityLength)).max(LIMITS.aiBlocks),
  /** True when some AI feature may need a connection (cloud) at least as a fallback. */
  cloudPossible: z.boolean(),
  /**
   * KalamSpec 1.1: what the app asks the phone for, each with its reason ("Camera: To take photos for
   * this app"). Left out when the app asks for nothing, and on listings made before 1.1.
   */
  permissions: z.array(z.string().max(PERMISSION_LINE_LENGTH)).max(PERMISSION_KINDS.length).optional(),
});
export type ListingDisclosure = z.infer<typeof disclosureSchema>;

const listingIdPattern = /^l[a-z0-9]{19}$/;
export const listingIdSchema = z.string().regex(listingIdPattern);

/** Remix lineage kept on republished remixes (docs/12 §15.2). */
export const lineageSchema = z.object({
  listingId: listingIdSchema,
  title: z.string().max(BAZAAR_LIMITS.title),
  makerName: z.string().max(BAZAAR_LIMITS.makerName),
});

/** `listings/{listingId}` as the app sees it (timestamps converted to epoch ms). */
export const listingSchema = z.object({
  id: listingIdSchema,
  title: z.string().min(1).max(BAZAAR_LIMITS.title),
  description: z.string().max(BAZAAR_LIMITS.description),
  category: z.enum(BAZAAR_CATEGORIES),
  tags: z.array(z.string().min(1).max(BAZAAR_LIMITS.tagLength)).max(BAZAAR_LIMITS.tags),
  lang: z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/),
  /** Price in credits (docs/12 §12). 0 = free. */
  price: z.number().int().min(0).max(MAX_PRICE),
  makerUid: z.string().min(1).max(128),
  makerName: z.string().min(1).max(BAZAAR_LIMITS.makerName),
  icon: iconSchema.optional(),
  /** Sanitised custom icon (docs/12 §6.2 `iconSvg`). Re-sanitised on every read. */
  iconSvg: z.string().max(8_000).optional(),
  appColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  specHash: sha,
  specVersion: z.number().int().min(1),
  kalamSpecVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  specBytes: z.number().int().min(1).max(BAZAAR_LIMITS.specBytes),
  changeSummary: z.string().max(BAZAAR_LIMITS.changeSummary),
  screenshotCount: z.number().int().min(0).max(3),
  status: z.enum(LISTING_STATUSES),
  /** Trusted human/server review. Clients can never set this to true. */
  reviewed: z.boolean(),
  /** Editorial placement, set only by the trusted function and always labelled (docs/12 §5.1, §5.6). */
  featured: z.boolean(),
  safety: safetySchema,
  license: z.enum(LICENSES),
  remixAllowed: z.boolean(),
  basedOn: lineageSchema.nullable(),
  capabilities: z.array(z.string().max(BAZAAR_LIMITS.capabilityLength)).max(BAZAAR_LIMITS.capabilities),
  disclosure: disclosureSchema,
  searchKeywords: z.array(z.string().max(BAZAAR_LIMITS.keywordLength)).max(BAZAAR_LIMITS.keywords),
  installs: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  ratingSum: z.number().int().nonnegative(),
  ratingCount: z.number().int().nonnegative(),
  ratingAvg: z.number().min(0).max(5),
  createdAt: z.number().nonnegative(),
  updatedAt: z.number().nonnegative(),
});
export type BazaarListing = z.infer<typeof listingSchema>;

/** `listingSpecs/{listingId}` (current) and `.../versions/{n}` (history): gzip+base64 of the exact JSON text. */
export const listingSpecDocSchema = z.object({
  specGz: z.string().min(24).max(BAZAAR_LIMITS.specGzChars),
  specHash: sha,
  specVersion: z.number().int().min(1),
  makerUid: z.string().min(1).max(128),
  previousSpecHash: sha.nullable(),
  changeSummary: z.string().max(BAZAAR_LIMITS.changeSummary),
});
export type ListingSpecDoc = z.infer<typeof listingSpecDocSchema>;

/** `users/{uid}/purchases/{listingId}`: install entitlement (free) or credit purchase (trusted function). */
export const entitlementSchema = z.object({
  listingId: listingIdSchema,
  sellerUid: z.string().min(1).max(128),
  pricePaid: z.number().int().min(0).max(MAX_PRICE),
  currency: z.literal('credits'),
  installedVersion: z.number().int().min(1),
  purchasedAt: z.number().nonnegative(),
  status: z.enum(['active', 'reversed']),
  purchaseId: z.string().max(200).optional(),
});
export type Entitlement = z.infer<typeof entitlementSchema>;

/** `wallets/{uid}` (written only by the trusted function). */
export const walletSchema = z.object({
  credits: z.number().int(),
  currency: z.literal('credits'),
  version: z.number().int().nonnegative(),
  updatedAt: z.number().nonnegative(),
});
export type Wallet = z.infer<typeof walletSchema>;

/** `walletTransactions/{id}`: append-only ledger (docs/12 §12.5). Reversals are new entries (§12.7). */
export const walletTransactionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['grant', 'purchase', 'reversal']),
  buyerUid: z.string().max(128).nullable(),
  sellerUid: z.string().max(128).nullable(),
  listingId: listingIdSchema.nullable(),
  amount: z.number().int(),
  currency: z.literal('credits'),
  status: z.enum(['completed', 'reversed']),
  purchaseId: z.string().max(200).nullable(),
  createdAt: z.number().nonnegative(),
});
export type WalletTransaction = z.infer<typeof walletTransactionSchema>;

export type BazaarSort = 'new' | 'popular' | 'rating';
export interface BazaarQuery {
  text?: string;
  category?: BazaarCategory;
  sort?: BazaarSort;
  price?: 'free' | 'paid';
  lang?: string;
  /** Editorial row on Discover. */
  featured?: boolean;
  /** Page size (default 20). */
  limit?: number;
  /** Opaque cursor from the previous page. */
  cursor?: string;
}
export interface BazaarPage {
  listings: BazaarListing[];
  /** Present when another page may exist. */
  cursor?: string;
  /** True when the page came from the on-device cache (offline or Firestore unreachable). */
  fromCache: boolean;
}

/** Lowercase, `l` + 19 chars: valid as a Firestore id and inside `meta.basedOn` / app ids. */
export function newListingId(random: (n: number) => Uint8Array = defaultRandom): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return `l${Array.from(random(19), (b) => alphabet[b % 36]).join('')}`;
}
function defaultRandom(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

/** `meta.basedOn` marker for apps installed or remixed from Bazaar. */
export const BASED_ON_PREFIX = 'bazaar:';
export function listingIdFromBasedOn(basedOn: string | undefined): string | undefined {
  if (!basedOn?.startsWith(BASED_ON_PREFIX)) return undefined;
  const id = basedOn.slice(BASED_ON_PREFIX.length);
  return listingIdPattern.test(id) ? id : undefined;
}

/** Filters that Firestore cannot combine in one query are applied to the fetched page (docs/12 §5.4). */
export function matchesFilters(l: BazaarListing, q: BazaarQuery, tokens: readonly string[]): boolean {
  if (l.status !== 'published') return false;
  if (q.category && l.category !== q.category) return false;
  if (q.price === 'free' && l.price !== 0) return false;
  if (q.price === 'paid' && l.price === 0) return false;
  if (q.lang && l.lang.split('-')[0] !== q.lang.split('-')[0]) return false;
  if (q.featured && !l.featured) return false;
  return tokens.every((t) => l.searchKeywords.some((k) => k.startsWith(t)));
}

export function sortListings(list: readonly BazaarListing[], sort: BazaarSort | undefined): BazaarListing[] {
  const key = (l: BazaarListing) => (sort === 'popular' ? l.installs : sort === 'rating' ? l.ratingAvg : 0);
  return [...list].sort((a, b) => key(b) - key(a) || b.createdAt - a.createdAt);
}
