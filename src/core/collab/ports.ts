/**
 * What the collaboration engine needs from the outside world. Firestore implements `CollabRemote`
 * (src/infrastructure/collab/firestore-remote.ts); tests use the fake in ./test-kit.ts. Local state is
 * per device (src/infrastructure/collab/state-store.ts); the memory store below is for tests.
 */
import type { AuditEntry, EndedNotice, Invite, InviteRole, LocalSpace, LocalTeam, Member, RemoteRecord, RemoteSpace, Role, SyncValues, Target, Team, TeamApp } from './model';
import { endedNoticeSchema, localSpaceSchema, localTeamSchema } from './model';

/** `offline`: no connection. `denied`: the rules said no. `not_found`: no such document. */
export type RemoteError = 'offline' | 'denied' | 'not_found' | 'unavailable' | 'invalid' | 'not_set_up';
export type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: RemoteError; message?: string };

export interface RecordWrite {
  id: string;
  collectionId: string;
  values: SyncValues;
  deleted: boolean;
  /** Version this device last saw (0 for a new entry). */
  baseVersion: number;
}
export type PushOutcome = { status: 'written'; version: number } | { status: 'conflict'; current: RemoteRecord | null };

export interface CollabRemote {
  createSpace(input: { sharedId: string; title: string; specGz: string; specHash: string; ownerName: string }): Promise<RemoteResult<void>>;
  getSpace(sharedId: string): Promise<RemoteResult<RemoteSpace>>;
  /** This person's own member row (always readable by them). `null` = definitely not a member. */
  myMembership(target: Target): Promise<RemoteResult<Member | null>>;
  updateSpec(sharedId: string, input: { specGz: string; specHash: string; specVersion: number }): Promise<RemoteResult<void>>;
  /** Entries changed at or after `since` (ms), oldest first. */
  pullRecords(sharedId: string, since: number): Promise<RemoteResult<RemoteRecord[]>>;
  /** Writes one entry and its audit line in a transaction, refusing if the stored version is not `baseVersion`. */
  pushRecord(sharedId: string, write: RecordWrite): Promise<RemoteResult<PushOutcome>>;
  /** Records which design version this person has (their own `installs` row; direct and team members alike). */
  setInstalledVersion(sharedId: string, version: number): Promise<RemoteResult<void>>;
  /** Managers only: uid to installed design version, for everyone who opened the app. */
  listInstalls(sharedId: string): Promise<RemoteResult<Record<string, number>>>;
  /**
   * Owner only: marks the app stopped (everyone loses access at once), then removes every document. Safe to
   * call again: a clean-up cut short resumes where it stopped.
   */
  deleteSpace(sharedId: string): Promise<RemoteResult<void>>;
  /** Trusted step (kalamCollabJoin): checks the invite and adds this person as a member. */
  join(token: string): Promise<RemoteResult<{ target: Target; role: Role; already: boolean }>>;
  listMembers(target: Target): Promise<RemoteResult<Member[]>>;
  setRole(target: Target, uid: string, role: Role): Promise<RemoteResult<void>>;
  /** Removes a member, or leaves when `uid` is this person. */
  removeMember(target: Target, uid: string, leaving: boolean): Promise<RemoteResult<void>>;
  createInvite(target: Target, invite: { hash: string; role: InviteRole; expiresAt: number; maxUses: number }): Promise<RemoteResult<void>>;
  listInvites(target: Target): Promise<RemoteResult<Invite[]>>;
  deleteInvite(target: Target, hash: string): Promise<RemoteResult<void>>;
  readAudit(sharedId: string, limit: number): Promise<RemoteResult<AuditEntry[]>>;
  createTeam(input: { teamId: string; name: string; ownerName: string }): Promise<RemoteResult<void>>;
  getTeam(teamId: string): Promise<RemoteResult<Team>>;
  /** Puts a shared app in a team (or takes it out with `teamId` null) and updates the team's directory. */
  setAppTeam(sharedId: string, change: { from: string | null; to: string | null; app: TeamApp; fromApps: TeamApp[]; toApps: TeamApp[] }): Promise<RemoteResult<void>>;
  deleteTeam(teamId: string): Promise<RemoteResult<void>>;
}

/** Collaboration state on this device. Every row is validated on the way out. */
export interface CollabStateStore {
  list(): Promise<LocalSpace[]>;
  get(localAppId: string): Promise<LocalSpace | undefined>;
  put(space: LocalSpace): Promise<void>;
  remove(localAppId: string): Promise<void>;
  teams(): Promise<LocalTeam[]>;
  putTeam(team: LocalTeam): Promise<void>;
  removeTeam(teamId: string): Promise<void>;
  notices(): Promise<EndedNotice[]>;
  addNotice(notice: EndedNotice): Promise<void>;
  clearNotices(): Promise<void>;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function createMemoryCollabStore(): CollabStateStore {
  const spaces = new Map<string, unknown>();
  const teams = new Map<string, unknown>();
  let notices: unknown[] = [];
  const parseAll = <T>(rows: Iterable<unknown>, schema: { safeParse(v: unknown): { success: boolean; data?: T } }) =>
    [...rows].flatMap((r) => {
      const p = schema.safeParse(r);
      return p.success && p.data ? [p.data] : [];
    });
  return {
    list: async () => parseAll<LocalSpace>(spaces.values(), localSpaceSchema),
    get: async (id) => parseAll<LocalSpace>([spaces.get(id)], localSpaceSchema)[0],
    async put(space) {
      spaces.set(space.localAppId, clone(localSpaceSchema.parse(space)));
    },
    async remove(id) {
      spaces.delete(id);
    },
    teams: async () => parseAll<LocalTeam>(teams.values(), localTeamSchema),
    async putTeam(team) {
      teams.set(team.teamId, clone(localTeamSchema.parse(team)));
    },
    async removeTeam(id) {
      teams.delete(id);
    },
    notices: async () => parseAll<EndedNotice>(notices, endedNoticeSchema),
    async addNotice(n) {
      notices = [...notices, endedNoticeSchema.parse(n)].slice(-10);
    },
    async clearNotices() {
      notices = [];
    },
  };
}
