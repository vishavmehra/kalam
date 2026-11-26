/**
 * Who may do what in a shared app or team (docs/14 §17.3). The same ranks are enforced by
 * firestore.rules; this copy only decides what the screens offer, so a refused action is never shown.
 *
 * | Role   | Can do                                                           |
 * |--------|------------------------------------------------------------------|
 * | owner  | everything; the only one who changes the app's design or stops sharing |
 * | admin  | invite, change and remove editors and viewers; add and edit entries |
 * | editor | add, change and delete entries                                   |
 * | viewer | read entries                                                     |
 */
import { INVITE_ROLES, type InviteRole, type Role } from './model';

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };
export const roleRank = (role: Role | undefined): number => (role ? RANK[role] : 0);

/** A team role carries over to the team's apps, but a team owner is an admin there: each app keeps one owner. */
export function effectiveRole(direct: Role | undefined, team: Role | undefined): Role | undefined {
  const fromTeam: Role | undefined = team === 'owner' ? 'admin' : team;
  return roleRank(direct) >= roleRank(fromTeam) ? direct : fromTeam;
}

export const canRead = (r: Role | undefined) => roleRank(r) >= 1;
export const canEditEntries = (r: Role | undefined) => roleRank(r) >= 2;
export const canManageMembers = (r: Role | undefined) => roleRank(r) >= 3;
/** Only the owner changes screens, fields and actions; everyone else gets the owner's versions. */
export const canChangeStructure = (r: Role | undefined) => r === 'owner';
export const canStopSharing = (r: Role | undefined) => r === 'owner';
export const canLeave = (r: Role | undefined) => !!r && r !== 'owner';

/** Roles `me` may hand out in an invite: strictly below their own. */
export const invitableRoles = (me: Role | undefined): InviteRole[] => INVITE_ROLES.filter((r) => roleRank(r) < roleRank(me) && canManageMembers(me));

/** `me` may change `target` from its current role to `next`. Never to or from owner. */
export function canAssign(me: Role | undefined, target: Role, next: Role): boolean {
  return canManageMembers(me) && target !== 'owner' && next !== 'owner' && roleRank(target) < roleRank(me) && roleRank(next) < roleRank(me);
}

/** `me` may remove someone holding `target`. The owner is never removed. */
export const canRemove = (me: Role | undefined, target: Role) => canManageMembers(me) && target !== 'owner' && roleRank(target) < roleRank(me);
