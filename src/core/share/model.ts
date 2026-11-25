/**
 * App-to-app sharing: the link model (docs/14 §16, data concept `appShares` in §24).
 *
 * A link is plain data that one person agreed to, never code. It names one list in a source app, one list
 * in a destination app, the fields that move between them (with their types), and what is allowed:
 *   - `read`:  the destination app shows the source entries live. Nothing is copied. They cannot be changed.
 *   - `write`: entries the person picks are sent to the destination, which checks each one.
 * Links are validated here before they are stored and again every time they are read back.
 */
import { z } from 'zod';
import { appIdSchema, FIELD_TYPES, idSchema, LIMITS, RESERVED_IDS } from '../spec/schema';

export const SHARE_LIMITS = {
  /** Links (active or turned off) that may involve one app. */
  linksPerApp: 20,
  fieldsPerLink: LIMITS.fieldsPerCollection,
  /** Entries one send may carry. */
  sendBatch: 100,
  /** Source entry to destination entry pairs remembered, so a second send can update instead of duplicate. */
  sentLedger: 500,
  /** Events kept on one link. Older ones are dropped. */
  auditPerLink: 50,
} as const;

export const SHARE_CONTRACT_VERSION = 1;

/** Every entry the destination gets through a `read` link has an id starting like this. They are never stored. */
export const SHARED_ID_PREFIX = 'shared:';
export const isSharedRecordId = (id: string): boolean => id.startsWith(SHARED_ID_PREFIX);

const RESERVED = new Set<string>(RESERVED_IDS);
const timestamp = z.number().int().nonnegative();
/** A field or list id as in a KalamSpec, minus the names a spec may not use. */
const safeId = idSchema.refine((v) => !RESERVED.has(v), 'This name is reserved');

export const SHARE_ACCESS = ['read', 'write'] as const;
export type ShareAccess = (typeof SHARE_ACCESS)[number];

export const shareFieldSchema = z
  .object({
    source: safeId,
    target: safeId,
    /** The type both sides agreed to. The source field must keep it. */
    type: z.enum(FIELD_TYPES),
    /** The source field's label when the link was made, so a later message can still name it. */
    label: z.string().min(1).max(LIMITS.labelLength).optional(),
  })
  .strict();

export const SHARE_AUDIT_KINDS = ['created', 'revoked', 'sent', 'blocked'] as const;
export const shareAuditSchema = z
  .object({
    at: timestamp,
    kind: z.enum(SHARE_AUDIT_KINDS),
    /** Entries created in the destination (sent). Counts only, never values. */
    count: z.number().int().min(0).max(SHARE_LIMITS.sendBatch).optional(),
    /** Entries already in the destination that were changed (sent). */
    updated: z.number().int().min(0).max(SHARE_LIMITS.sendBatch).optional(),
    /** Short code for why something was stopped (blocked). */
    reason: z.string().max(40).optional(),
  })
  .strict();

const recordId = z.string().min(1).max(64);

export const shareLinkSchema = z
  .object({
    id: z.string().regex(/^lnk_[a-z0-9]{8,32}$/),
    /** Versioned contract name, e.g. `customers-orders-v1` (docs/14 §16.3). */
    contractId: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
    contractVersion: z.literal(SHARE_CONTRACT_VERSION),
    sourceAppId: appIdSchema,
    sourceCollection: safeId,
    destinationAppId: appIdSchema,
    destinationCollection: safeId,
    fields: z.array(shareFieldSchema).min(1).max(SHARE_LIMITS.fieldsPerLink),
    access: z.enum(SHARE_ACCESS),
    status: z.enum(['active', 'revoked']),
    createdAt: timestamp,
    revokedAt: timestamp.optional(),
    /** `write` links: [source entry id, destination entry id] pairs, oldest first. */
    sent: z.array(z.tuple([recordId, recordId])).max(SHARE_LIMITS.sentLedger).optional(),
    audit: z.array(shareAuditSchema).max(SHARE_LIMITS.auditPerLink),
  })
  .strict()
  .refine((l) => l.sourceAppId !== l.destinationAppId, { message: 'An app cannot link to itself', path: ['destinationAppId'] })
  .refine((l) => new Set(l.fields.map((f) => f.source)).size === l.fields.length, { message: 'A source field is listed twice', path: ['fields'] })
  .refine((l) => new Set(l.fields.map((f) => f.target)).size === l.fields.length, { message: 'A target field is listed twice', path: ['fields'] })
  .refine((l) => (l.status === 'revoked') === (l.revokedAt !== undefined), { message: 'revokedAt belongs to turned off links only', path: ['revokedAt'] });

export type ShareLink = z.infer<typeof shareLinkSchema>;
export type ShareField = z.infer<typeof shareFieldSchema>;
export type ShareAuditEntry = z.infer<typeof shareAuditSchema>;

export type ParsedLink = { ok: true; link: ShareLink } | { ok: false; issues: string[] };

/** Validates untrusted link data. Issues name the part that is wrong and never repeat what was given. */
export function parseShareLink(input: unknown): ParsedLink {
  const r = shareLinkSchema.safeParse(input);
  if (r.success) return { ok: true, link: r.data };
  return { ok: false, issues: r.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || 'link'}: ${i.message}`) };
}

/** `lnk_` plus up to 20 lowercase letters and digits taken from `raw` (a random id from the caller). */
export function linkIdFrom(raw: string): string | undefined {
  const body = raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  return body.length >= 8 ? `lnk_${body}` : undefined;
}

/** `customers` and `orders` give `customers-orders-v1`. */
export function contractIdFor(sourceCollection: string, destinationCollection: string): string {
  const part = (s: string) => s.replace(/_/g, '-').slice(0, 28);
  return `${part(sourceCollection)}-${part(destinationCollection)}-v${SHARE_CONTRACT_VERSION}`;
}
