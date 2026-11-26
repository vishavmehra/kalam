/**
 * kalamCollabJoin as a pure plan (docs/14 §17.6: "The owner explicitly invites collaborators").
 * The callable in ./index.ts reads the invite, the shared app or team and any existing membership in
 * one transaction, calls `planJoin`, and writes exactly what it returns. Clients can never add
 * themselves as members (firestore.rules), so this is the only way in.
 */
import { z } from 'zod';

export type TargetKind = 'app' | 'team';
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

/** `<sharedId or teamId>.<20 base32 characters>`; mirrors src/core/collab/invite.ts. */
const TOKEN_RE = /^([st][a-z0-9]{19})\.([A-Z2-7]{20})$/;

export const joinRequestSchema = z.object({ token: z.string().min(22).max(64) }).strict();

export function parseInviteToken(token: string): { kind: TargetKind; id: string; secret: string } | null {
  const m = TOKEN_RE.exec(token.trim());
  if (!m?.[1] || !m[2]) return null;
  return { kind: m[1].startsWith('s') ? 'app' : 'team', id: m[1], secret: m[2] };
}

export interface InviteState { role: string; expiresAtMs: number; maxUses: number; uses: number; createdBy: string }
export interface TargetState { status: string; ownerUid: string }

export type JoinError = 'bad_request' | 'invalid_invite' | 'expired' | 'used_up' | 'gone';

export const JOIN_MESSAGES: Record<JoinError, string> = {
  bad_request: 'That invite code does not look right. Paste the whole link or code you were sent.',
  invalid_invite: 'This invite does not work. It may have been cancelled. Ask for a new one.',
  expired: 'This invite has expired. Ask for a new one.',
  used_up: 'This invite has been used as many times as it allows. Ask for a new one.',
  gone: 'This shared app or team no longer exists.',
};

export type JoinPlan =
  | { ok: true; already: true; role: Role }
  | { ok: true; already: false; role: Role; uses: number }
  | { ok: false; code: JoinError };

const INVITE_ROLES = new Set(['admin', 'editor', 'viewer']);
const ROLES = new Set(['owner', 'admin', 'editor', 'viewer']);
const RANK: Record<string, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };
export const roleRank = (role: unknown): number => (typeof role === 'string' ? RANK[role] ?? 0 : 0);

/**
 * The rank the invite's creator holds now, read in the same transaction (mirrors appRank and teamRank in
 * firestore.rules): the owner is 4; otherwise their own row, or for an app their team row capped at admin
 * while the team is active. An admin who was removed or demoted since takes their invites' power with them.
 */
export function inviterRank(input: { creatorUid: string; ownerUid: string; directRole: unknown; teamRole?: unknown; teamActive?: boolean }): number {
  if (input.creatorUid && input.creatorUid === input.ownerUid) return 4;
  const team = input.teamActive ? Math.min(3, roleRank(input.teamRole)) : 0;
  return Math.max(roleRank(input.directRole), team);
}

export function planJoin(input: {
  uid: string;
  invite: InviteState | null;
  target: TargetState | null;
  existingRole: string | null;
  /** From `inviterRank`: the creator must still manage people and outrank the role the invite gives. */
  creatorRank: number;
  nowMs: number;
}): JoinPlan {
  const { invite, target } = input;
  if (!target || target.status !== 'active') return { ok: false, code: 'gone' };
  // Someone already in keeps their role; an invite never lowers or raises it.
  if (target.ownerUid === input.uid) return { ok: true, already: true, role: 'owner' };
  if (input.existingRole && ROLES.has(input.existingRole)) return { ok: true, already: true, role: input.existingRole as Role };
  if (!invite || !INVITE_ROLES.has(invite.role)) return { ok: false, code: 'invalid_invite' };
  if (input.creatorRank < 3 || roleRank(invite.role) >= input.creatorRank) return { ok: false, code: 'invalid_invite' };
  if (invite.expiresAtMs <= input.nowMs) return { ok: false, code: 'expired' };
  if (invite.uses >= invite.maxUses) return { ok: false, code: 'used_up' };
  return { ok: true, already: false, role: invite.role as Role, uses: invite.uses + 1 };
}

/** The public name shown to other members: never the email address, no markup, at most 40 characters. */
export function publicName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/[<>]/g, '').trim().slice(0, 40) : '';
}
