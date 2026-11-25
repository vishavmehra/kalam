/**
 * Install / remix (docs/12 §11, §15; docs/05 §17). A listing's review badge never replaces local
 * validation: the downloaded spec is hash-checked, migrated and fully validated on this device
 * before anything is saved. Pure TypeScript (gzip + SHA-256 in codec.ts).
 */
import type { SpecIssue, StoredApp } from '../contracts';
import { migrateSpec } from '../spec/migrate';
import { LIMITS, type KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { gunzipFromBase64, sha256Hex } from './codec';
import { BASED_ON_PREFIX, BAZAAR_LIMITS, listingSpecDocSchema, type BazaarListing, type ListingSpecDoc } from './model';
import { isCompatible } from './update';

type Sha256 = (text: string) => Promise<string>;
const defaultSha256: Sha256 = async (text) => sha256Hex(text);

/**
 * Never trust provenance claimed by a downloaded spec (R-09): every AI block starts unverified on
 * this device (its verification record is dropped) and `meta.generator` is removed.
 */
export function stripClaimedTrust(spec: KalamSpec): KalamSpec {
  const aiBlocks = Object.fromEntries(
    Object.entries(spec.aiBlocks).map(([id, block]) => {
      const { verification: _claimed, ...rest } = block;
      return [id, { ...rest, verified: 'unverified' as const }];
    }),
  ) as KalamSpec['aiBlocks'];
  const { generator: _generator, ...meta } = spec.meta;
  return { ...spec, aiBlocks, meta };
}

export type InstallMode = 'install' | 'remix';

export type PreparedInstall =
  | { ok: true; app: StoredApp; summary: string }
  | { ok: false; code: 'hash_mismatch' | 'invalid_spec' | 'unsupported_version' | 'not_allowed'; message: string; issues: SpecIssue[] };

/**
 * Parses + validates a downloaded spec. Used for both install and the read-only preview, so the
 * preview never renders anything the installer would reject.
 */
export async function verifyListingSpec(
  listing: Pick<BazaarListing, 'specHash'> & Partial<Pick<BazaarListing, 'kalamSpecVersion'>>,
  rawDoc: unknown,
  sha256: Sha256 = defaultSha256,
): Promise<{ ok: true; spec: KalamSpec; doc: ListingSpecDoc; specJson: string } | Extract<PreparedInstall, { ok: false }>> {
  if (listing.kalamSpecVersion && !isCompatible(listing.kalamSpecVersion)) {
    return { ok: false, code: 'unsupported_version', message: 'This app was made with a newer version of Kalam. Update Kalam to install it.', issues: [] };
  }
  const doc = listingSpecDocSchema.safeParse(rawDoc);
  if (!doc.success) return { ok: false, code: 'invalid_spec', message: 'The downloaded app is damaged.', issues: [] };
  let specJson: string;
  try {
    specJson = gunzipFromBase64(doc.data.specGz, BAZAAR_LIMITS.specBytes);
  } catch {
    return { ok: false, code: 'invalid_spec', message: 'The downloaded app is damaged.', issues: [] };
  }
  const actual = await sha256(specJson);
  if (doc.data.specHash !== listing.specHash || actual !== listing.specHash) {
    return { ok: false, code: 'hash_mismatch', message: 'The downloaded app does not match its listing, so it was not installed.', issues: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(specJson);
  } catch {
    return { ok: false, code: 'invalid_spec', message: 'The downloaded app is damaged.', issues: [] };
  }
  const migrated = migrateSpec(parsed);
  if (!migrated.ok || !migrated.spec) {
    return { ok: false, code: 'unsupported_version', message: 'This app was made with a newer version of Kalam. Update Kalam to install it.', issues: [] };
  }
  const checked = validateSpec(migrated.spec);
  if (!checked.ok || !checked.spec) {
    return { ok: false, code: 'invalid_spec', message: 'This app failed the safety checks on your device, so it was not installed.', issues: checked.errors };
  }
  return { ok: true, spec: checked.spec, doc: doc.data, specJson };
}

/**
 * Builds the local copy: new app id, version 1, attribution in `meta`, and no records (the
 * installer starts empty). Remix requires the listing's license to allow it.
 */
export async function prepareInstall(input: {
  listing: BazaarListing;
  specDoc: unknown;
  sha256?: Sha256;
  appId: string;
  now: number;
  mode: InstallMode;
}): Promise<PreparedInstall> {
  const { listing, mode, now } = input;
  if (mode === 'remix' && !listing.remixAllowed) {
    return { ok: false, code: 'not_allowed', message: 'The maker of this app does not allow remixes. You can still install it.', issues: [] };
  }
  const verified = await verifyListingSpec(listing, input.specDoc, input.sha256);
  if (!verified.ok) return verified;
  const name = mode === 'remix'
    ? `${verified.spec.name.slice(0, LIMITS.nameLength - 8)} (remix)`
    : verified.spec.name;
  const trusted = stripClaimedTrust(verified.spec);
  const spec: KalamSpec = {
    ...trusted,
    id: input.appId,
    version: 1,
    name,
    meta: {
      ...trusted.meta,
      author: listing.makerName.slice(0, LIMITS.nameLength),
      basedOn: `${BASED_ON_PREFIX}${listing.id}`,
      // A remix is still a copy of a listing; it is marked so the shelf and Publish can tell them apart.
      source: mode === 'remix' ? 'remix' : 'import',
      license: listing.license,
      remixAllowed: listing.remixAllowed,
      createdAt: now,
      updatedAt: now,
    },
  };
  const final = validateSpec(spec);
  if (!final.ok || !final.spec) {
    return { ok: false, code: 'invalid_spec', message: 'This app failed the safety checks on your device, so it was not installed.', issues: final.errors };
  }
  return {
    ok: true,
    // Fresh StoredApp: no creationInput and no origin/provider from the publisher ever reach this device.
    app: { id: input.appId, spec: final.spec, createdAt: now, updatedAt: now, origin: { route: 'import' } },
    summary: mode === 'remix'
      ? `Remixed from "${listing.title}" by ${listing.makerName}`
      : `Installed from Kalam Bazaar: "${listing.title}" by ${listing.makerName}`,
  };
}
