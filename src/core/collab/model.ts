/**
 * Collaborative apps and Kalam for Teams (docs/14 §17, §21): the shapes that cross the device and
 * cloud boundary. Every document read from Firestore and every row read from local storage is parsed
 * with these schemas first; anything that does not parse is dropped, never trusted.
 *
 * Firestore layout (named database `kalam`, rules in firestore.rules):
 *   collabApps/{sharedId}                 the shared app: owner, title, gzip spec, spec version, team
 *     members/{uid}                       role, public name, installed design version
 *     records/{recordId}                  one entry: values, version, tombstone flag, who changed it
 *     audit/{entryId}                     who did what and when; never record values
 *     invites/{sha256(secret)}            role, expiry, use count (the secret itself is never stored)
 *     installs/{uid}                      which design version each person has (direct or team member)
 *   collabTeams/{teamId}                  a team: name, owner, a directory of its shared apps
 *     members/{uid}, invites/{hash}       as above
 */
import { z } from 'zod';
import { LIMITS, idSchema } from '../spec/schema';

export const ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);
/** Roles an invite can grant. Nobody is invited as owner. */
export const INVITE_ROLES = ['admin', 'editor', 'viewer'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export const SHARED_ID_RE = /^s[a-z0-9]{19}$/;
export const TEAM_ID_RE = /^t[a-z0-9]{19}$/;
export const RECORD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const HASH_RE = /^[0-9a-f]{64}$/;
/** Firebase uids are 28 letters and digits; the emulator accepts any short name. */
export const uidSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export const COLLAB_LIMITS = {
  /** Same cap as published specs (docs/11 §11.1). */
  specBytes: 100_000,
  /** gzip+base64 of at most 100 KB of JSON. */
  specGzChars: 140_000,
  titleLength: 60,
  nameLength: 40,
  valueChars: 10_000,
  teamApps: 30,
  inviteMaxUses: 50,
  inviteMaxDays: 30,
  /** Pull window overlap: a write that commits a moment after a newer one is still picked up. */
  pullOverlapMs: 60_000,
  pullPage: 300,
  /** Sync state is saved after this many local writes during a pull, and always when a pull ends. */
  checkpointEvery: 25,
} as const;

export type TargetKind = 'app' | 'team';
export interface Target { kind: TargetKind; id: string }

// ─── Values ──────────────────────────────────────────────────────────────────
/** One synced value. Photos never sync (lead decision 3): image fields are left out before upload. */
export const syncValueSchema = z.union([z.string().max(COLLAB_LIMITS.valueChars), z.number().finite(), z.boolean(), z.null()]);
export type SyncValue = z.infer<typeof syncValueSchema>;
export const syncValuesSchema = z
  .record(idSchema, syncValueSchema)
  .refine((v) => Object.keys(v).length <= LIMITS.fieldsPerCollection, 'Too many fields');
export type SyncValues = Record<string, SyncValue>;

// ─── Cloud documents (already converted from Firestore types by the adapter) ─
export const remoteSpaceSchema = z.object({
  sharedId: z.string().regex(SHARED_ID_RE),
  ownerUid: uidSchema,
  title: z.string().min(1).max(COLLAB_LIMITS.titleLength),
  status: z.enum(['active', 'deleted']),
  specGz: z.string().min(24).max(COLLAB_LIMITS.specGzChars),
  specHash: z.string().regex(HASH_RE),
  specVersion: z.number().int().min(1),
  teamId: z.string().regex(TEAM_ID_RE).nullable(),
  updatedAt: z.number().int().nonnegative(),
});
export type RemoteSpace = z.infer<typeof remoteSpaceSchema>;

export const remoteRecordSchema = z.object({
  id: z.string().regex(RECORD_ID_RE),
  collectionId: idSchema,
  values: syncValuesSchema,
  version: z.number().int().min(1),
  deleted: z.boolean(),
  createdBy: uidSchema,
  updatedBy: uidSchema,
  updatedAt: z.number().int().nonnegative(),
});
export type RemoteRecord = z.infer<typeof remoteRecordSchema>;

export const memberSchema = z.object({
  uid: uidSchema,
  role: roleSchema,
  name: z.string().max(COLLAB_LIMITS.nameLength),
  joinedAt: z.number().int().nonnegative(),
  installedVersion: z.number().int().min(0),
});
export type Member = z.infer<typeof memberSchema>;

export const inviteSchema = z.object({
  hash: z.string().regex(HASH_RE),
  role: z.enum(INVITE_ROLES),
  createdBy: uidSchema,
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  maxUses: z.number().int().min(1).max(COLLAB_LIMITS.inviteMaxUses),
  uses: z.number().int().min(0),
});
export type Invite = z.infer<typeof inviteSchema>;

export const teamAppSchema = z.object({ sharedId: z.string().regex(SHARED_ID_RE), title: z.string().min(1).max(COLLAB_LIMITS.titleLength) });
export type TeamApp = z.infer<typeof teamAppSchema>;
export const teamSchema = z.object({
  teamId: z.string().regex(TEAM_ID_RE),
  name: z.string().min(1).max(COLLAB_LIMITS.titleLength),
  ownerUid: uidSchema,
  status: z.enum(['active', 'deleted']),
  /** A directory only. Access to each app is checked on the app itself. Bad entries are dropped. */
  apps: z.array(z.unknown()).max(COLLAB_LIMITS.teamApps).transform((list) => list.flatMap((a) => {
    const p = teamAppSchema.safeParse(a);
    return p.success ? [p.data] : [];
  })),
});
export type Team = z.infer<typeof teamSchema>;

export const AUDIT_KINDS = [
  'shared', 'spec_updated', 'record_created', 'record_updated', 'record_deleted', 'member_joined', 'member_role_changed',
  'member_removed', 'member_left', 'invite_created', 'invite_revoked', 'team_app_added', 'team_app_removed', 'stopped',
] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];
export const auditEntrySchema = z.object({
  id: z.string().max(200),
  actor: uidSchema,
  kind: z.enum(AUDIT_KINDS),
  at: z.number().int().nonnegative(),
  target: z.string().max(128).optional(),
  collectionId: idSchema.optional(),
  version: z.number().int().optional(),
  role: roleSchema.optional(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

// ─── Local state (this device only) ──────────────────────────────────────────
/** What this device last agreed with the cloud for one entry. `base` drives the three-way merge. */
export const trackedSchema = z.object({
  /** '' for an entry that was deleted before this device ever had it. */
  localId: z.string().max(64),
  collectionId: idSchema,
  version: z.number().int().min(0),
  base: syncValuesSchema,
  deleted: z.boolean(),
});
export type Tracked = z.infer<typeof trackedSchema>;

export const CONFLICT_KINDS = ['both_changed', 'deleted_here', 'deleted_there'] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];
export const conflictFieldSchema = z.object({ field: idSchema, mine: syncValueSchema, theirs: syncValueSchema });
export type ConflictField = z.infer<typeof conflictFieldSchema>;
export const conflictSchema = z.object({
  /** The remote record id: one open conflict per entry. */
  id: z.string().regex(RECORD_ID_RE),
  collectionId: idSchema,
  kind: z.enum(CONFLICT_KINDS),
  fields: z.array(conflictFieldSchema).max(LIMITS.fieldsPerCollection),
  theirs: syncValuesSchema,
  /** This device's values when the conflict was found, so the screen can show which entry it is. Never leaves the device. */
  mine: syncValuesSchema.optional(),
  theirVersion: z.number().int().min(1),
  theirActor: uidSchema,
  detectedAt: z.number().int().nonnegative(),
});
export type Conflict = z.infer<typeof conflictSchema>;

export const localSpaceSchema = z.object({
  v: z.literal(1),
  sharedId: z.string().regex(SHARED_ID_RE),
  localAppId: z.string().min(1).max(64),
  role: roleSchema,
  ownerUid: uidSchema,
  myUid: uidSchema,
  teamId: z.string().regex(TEAM_ID_RE).nullable(),
  title: z.string().max(COLLAB_LIMITS.titleLength),
  /** Design version this device has applied (member) or uploaded (owner). */
  specVersion: z.number().int().min(1),
  /** Hash of the design at that version, to notice the owner's own edits. */
  designHash: z.string().regex(HASH_RE),
  /** Newest `updatedAt` pulled so far. */
  cursor: z.number().int().nonnegative(),
  tracked: z.record(z.string().regex(RECORD_ID_RE), trackedSchema),
  conflicts: z.array(conflictSchema),
  lastSyncAt: z.number().int().nonnegative().optional(),
  lastError: z.string().max(40).optional(),
  /** A pull was writing to the device database when it stopped: the next sync finishes it before sending anything. */
  pulling: z.boolean().optional(),
  /** Entries from others the device could not add in the last pull. They are fetched again until they fit. */
  skipped: z.number().int().nonnegative().optional(),
  /** When this person agreed to the sharing notice for this app (owner: share; others: join or get). */
  ackAt: z.number().int().nonnegative().optional(),
});
export type LocalSpace = z.infer<typeof localSpaceSchema>;

export const localTeamSchema = z.object({
  v: z.literal(1),
  teamId: z.string().regex(TEAM_ID_RE),
  name: z.string().min(1).max(COLLAB_LIMITS.titleLength),
  role: roleSchema,
  myUid: uidSchema,
});
export type LocalTeam = z.infer<typeof localTeamSchema>;

/** Shown once after this device lost access to a shared app and removed its copy. */
export const endedNoticeSchema = z.object({ sharedId: z.string().regex(SHARED_ID_RE), title: z.string().max(COLLAB_LIMITS.titleLength), at: z.number().int() });
export type EndedNotice = z.infer<typeof endedNoticeSchema>;

export const parseLocalSpace = (row: unknown): LocalSpace | undefined => {
  const p = localSpaceSchema.safeParse(row);
  return p.success ? p.data : undefined;
};
