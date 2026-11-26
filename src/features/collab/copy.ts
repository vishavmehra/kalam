/**
 * Every sentence a person sees for shared apps and teams (copy rule: plain English, no em dashes,
 * no exclamation marks). The engine returns codes; screens look the words up here.
 */
import type { AuditKind, ConflictKind, Role } from '@/core/collab';
import { t as gt } from '@/i18n/active';

const quote = (v: string | number | boolean | null) => (v === null || v === '' ? 'empty' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : `"${String(v)}"`);

export const COLLAB_COPY = {
  get untitled() { return gt('collab.ui.untitled'); },
  get someone() { return gt('collab.ui.someone'); },
  get you() { return gt('collab.ui.you'); },

  errors: {
    get sign_in() { return gt('collab.ui.errors.sign_in'); },
    get guest_account() { return gt('collab.ui.errors.guest_account'); },
    get offline() { return gt('collab.ui.errors.offline'); },
    get no_consent() { return gt('collab.ui.errors.no_consent'); },
    get no_app() { return gt('collab.ui.errors.no_app'); },
    get already_shared() { return gt('collab.ui.errors.already_shared'); },
    get not_shared() { return gt('collab.ui.errors.not_shared'); },
    get spec_too_big() { return gt('collab.ui.errors.spec_too_big'); },
    get spec_invalid() { return gt('collab.ui.errors.spec_invalid'); },
    get spec_newer() { return gt('collab.ui.errors.spec_newer'); },
    get denied() { return gt('collab.ui.errors.denied'); },
    get not_set_up() { return gt('collab.ui.errors.not_set_up'); },
    get unavailable() { return gt('collab.ui.errors.unavailable'); },
    get invalid_code() { return gt('collab.ui.errors.invalid_code'); },
    get invite_refused() { return gt('collab.ui.errors.invite_refused'); },
    get not_allowed() { return gt('collab.ui.errors.not_allowed'); },
    get owner_cannot_leave() { return gt('collab.ui.errors.owner_cannot_leave'); },
    get gone() { return gt('collab.ui.errors.gone'); },
    get read_only() { return gt('collab.ui.errors.read_only'); },
    get structure_owner_only() { return gt('collab.ui.errors.structure_owner_only'); },
    get team_full() { return gt('collab.ui.errors.team_full'); },
    get team_name() { return gt('collab.ui.errors.team_name'); },
    get cannot_apply() { return gt('collab.ui.errors.cannot_apply'); },
  },

  summary: {
    get designUpdate() { return gt('collab.ui.summary.designUpdate'); },
    get photosOptional() { return gt('collab.ui.summary.photosOptional'); },
    joined: (title: string) => gt('collab.ui.summary.joined', { title }),
  },

  roles: {
    owner: { get name() { return gt('collab.ui.roles.owner.name'); }, get description() { return gt('collab.ui.roles.owner.description'); } },
    admin: { get name() { return gt('collab.ui.roles.admin.name'); }, get description() { return gt('collab.ui.roles.admin.description'); } },
    editor: { get name() { return gt('collab.ui.roles.editor.name'); }, get description() { return gt('collab.ui.roles.editor.description'); } },
    viewer: { get name() { return gt('collab.ui.roles.viewer.name'); }, get description() { return gt('collab.ui.roles.viewer.description'); } },
  } satisfies Record<Role, { name: string; description: string }>,

  status: {
    get upToDate() { return gt('collab.ui.status.upToDate'); },
    get syncing() { return gt('collab.ui.status.syncing'); },
    waiting: (n: number) => gt('collab.ui.status.waiting', { count: n }),
    get offline() { return gt('collab.ui.status.offline'); },
    conflicts: (n: number) => gt('collab.ui.status.conflicts', { count: n }),
    get error() { return gt('collab.ui.status.error'); },
    /** Short badge words for problems that trying again does not fix. */
    problems: {
      get spec_too_big() { return gt('collab.ui.status.problems.spec_too_big'); },
      get spec_invalid() { return gt('collab.ui.status.problems.spec_invalid'); },
      get spec_newer() { return gt('collab.ui.status.problems.spec_newer'); },
      get denied() { return gt('collab.ui.status.problems.denied'); },
      get not_set_up() { return gt('collab.ui.status.problems.not_set_up'); },
    } as Partial<Record<string, string>>,
    skipped: (n: number) => gt('collab.ui.status.skipped', { count: n }),
    get signedOut() { return gt('collab.ui.status.signedOut'); },
    get viewOnly() { return gt('collab.ui.status.viewOnly'); },
    a11y: (state: string, role: string) => (role ? gt('collab.ui.status.a11yRole', { role: role.toLowerCase(), state }) : gt('collab.ui.status.a11yNoRole', { state })),
  },

  share: {
    title: (app: string) => gt('collab.ui.share.title', { app }),
    get intro() { return gt('collab.ui.share.intro'); },
    get whatHappens() { return gt('collab.ui.share.whatHappens'); },
    points: [
      'The app\'s design and its entries are stored in Kalam\'s cloud, so the people you invite can see them.',
      'Photos stay on this device. They are never uploaded, so photo fields become optional in the shared app.',
      'Kalam keeps a history of who added, changed or deleted entries, and when. It never stores the values in that history.',
      'Only people you invite can open it. You can remove anyone, or stop sharing, at any time.',
      'When you remove someone, the copy on their phone is deleted the next time it is online. A phone that never goes online again keeps what it had.',
      'Only you change the design. Others get each new version automatically.',
    ],
    get consent() { return gt('collab.ui.share.consent'); },
    get signInFirst() { return gt('collab.ui.share.signInFirst'); },
    get teamLabel() { return gt('collab.ui.share.teamLabel'); },
    get noTeam() { return gt('collab.ui.share.noTeam'); },
    get button() { return gt('collab.ui.share.button'); },
    get working() { return gt('collab.ui.share.working'); },
    get done() { return gt('collab.ui.share.done'); },
    yourRole: (role: string) => gt('collab.ui.share.yourRole', { role: role.toLowerCase() }),
    get syncNow() { return gt('collab.ui.share.syncNow'); },
    get synced() { return gt('collab.ui.share.synced'); },
    syncedSkipped: (n: number) => gt('collab.ui.share.syncedSkipped', { count: n }),
    teamFailed: (reason: string) => gt('collab.ui.share.teamFailed', { reason }),
  },

  invite: {
    get heading() { return gt('collab.ui.invite.heading'); },
    get roleLabel() { return gt('collab.ui.invite.roleLabel'); },
    get create() { return gt('collab.ui.invite.create'); },
    created: (days: number, uses: number) => gt('collab.ui.invite.created', { days: gt('collab.ui.days', { count: days }), uses: gt('collab.ui.people', { count: uses }) }),
    get codeLabel() { return gt('collab.ui.invite.codeLabel'); },
    get copyLink() { return gt('collab.ui.invite.copyLink'); },
    get copyCode() { return gt('collab.ui.invite.copyCode'); },
    get send() { return gt('collab.ui.invite.send'); },
    get copied() { return gt('collab.ui.invite.copied'); },
    message: (title: string) => gt('collab.ui.invite.message', { title }),
    get openHeading() { return gt('collab.ui.invite.openHeading'); },
    openLine: (role: string, uses: number, max: number, expires: string) => gt('collab.ui.invite.openLine', { role, uses, max, expires }),
    get cancel() { return gt('collab.ui.invite.cancel'); },
    get cancelled() { return gt('collab.ui.invite.cancelled'); },
    get none() { return gt('collab.ui.invite.none'); },
  },

  members: {
    get heading() { return gt('collab.ui.members.heading'); },
    you: (name: string) => gt('collab.ui.members.you', { name }),
    get unnamed() { return gt('collab.ui.members.unnamed'); },
    changeRole: (name: string) => gt('collab.ui.members.changeRole', { name }),
    remove: (name: string) => gt('collab.ui.members.remove', { name }),
    removeTitle: (name: string) => gt('collab.ui.members.removeTitle', { name }),
    get removeMessage() { return gt('collab.ui.members.removeMessage'); },
    removed: (name: string) => gt('collab.ui.members.removed', { name }),
    roleChanged: (name: string, role: string) => gt('collab.ui.members.roleChanged', { name, role: role.toLowerCase() }),
    get loadFailed() { return gt('collab.ui.members.loadFailed'); },
    get teamNote() { return gt('collab.ui.members.teamNote'); },
  },

  conflicts: {
    get heading() { return gt('collab.ui.conflicts.heading'); },
    get intro() { return gt('collab.ui.conflicts.intro'); },
    title: (kind: ConflictKind, who: string): string => ({
      both_changed: `${who} changed this entry too`,
      deleted_here: `You deleted an entry that ${who} changed`,
      deleted_there: `${who} deleted an entry you changed`,
    })[kind],
    field: (label: string, mine: string | number | boolean | null, theirs: string | number | boolean | null) =>
      `${label}: yours ${quote(mine)}, theirs ${quote(theirs)}`,
    value: (label: string, v: string | number | boolean | null) => `${label}: ${quote(v)}`,
    entry: (name: string) => gt('collab.ui.conflicts.entry', { name }),
    get unnamedEntry() { return gt('collab.ui.conflicts.unnamedEntry'); },
    get yourVersion() { return gt('collab.ui.conflicts.yourVersion'); },
    get theirVersion() { return gt('collab.ui.conflicts.theirVersion'); },
    forEntry: (name: string) => gt('collab.ui.conflicts.forEntry', { name }),
    get keepMine() { return gt('collab.ui.conflicts.keepMine'); },
    get useTheirs() { return gt('collab.ui.conflicts.useTheirs'); },
    get keepDeleted() { return gt('collab.ui.conflicts.keepDeleted'); },
    get restore() { return gt('collab.ui.conflicts.restore'); },
    get keepEntry() { return gt('collab.ui.conflicts.keepEntry'); },
    get acceptDelete() { return gt('collab.ui.conflicts.acceptDelete'); },
    get resolved() { return gt('collab.ui.conflicts.resolved'); },
  },

  history: {
    get heading() { return gt('collab.ui.history.heading'); },
    get empty() { return gt('collab.ui.history.empty'); },
    line: (who: string, kind: AuditKind, when: string): string => `${who} ${({
      shared: 'shared the app',
      spec_updated: 'changed the design',
      record_created: 'added an entry',
      record_updated: 'changed an entry',
      record_deleted: 'deleted an entry',
      member_joined: 'joined',
      member_role_changed: 'changed someone\'s role',
      member_removed: 'removed someone',
      member_left: 'left',
      invite_created: 'created an invite',
      invite_revoked: 'cancelled an invite',
      team_app_added: 'added the app to a team',
      team_app_removed: 'took the app out of a team',
      stopped: 'stopped sharing',
    } satisfies Record<AuditKind, string>)[kind]}, ${when}`,
  },

  leave: {
    get button() { return gt('collab.ui.leave.button'); },
    title: (app: string) => gt('collab.ui.leave.title', { app }),
    get message() { return gt('collab.ui.leave.message'); },
    get confirm() { return gt('collab.ui.leave.confirm'); },
    get done() { return gt('collab.ui.leave.done'); },
  },

  stop: {
    get button() { return gt('collab.ui.stop.button'); },
    title: (app: string) => gt('collab.ui.stop.title', { app }),
    get message() { return gt('collab.ui.stop.message'); },
    get confirm() { return gt('collab.ui.stop.confirm'); },
    get done() { return gt('collab.ui.stop.done'); },
  },

  /** For the lead: the confirmation shown before deleting a shared app from the shelf. */
  deleteShared: {
    get owner() { return gt('collab.ui.deleteShared.owner'); },
    get member() { return gt('collab.ui.deleteShared.member'); },
  },

  join: {
    get title() { return gt('collab.ui.join.title'); },
    get intro() { return gt('collab.ui.join.intro'); },
    get noticeHeading() { return gt('collab.ui.join.noticeHeading'); },
    notice: [
      "The app and its entries are copied to this device from Kalam's cloud.",
      'Entries you add or change are sent to the cloud. Everyone in the shared app, including its owner and admins, can see them.',
      'Kalam keeps a history of who added, changed or deleted entries, and when. It never stores the values in that history.',
      'Photos you add stay on this device. They are never uploaded.',
      'If you leave or are removed, the copy on this device is deleted.',
    ],
    get consent() { return gt('collab.ui.join.consent'); },
    get label() { return gt('collab.ui.join.label'); },
    get button() { return gt('collab.ui.join.button'); },
    get working() { return gt('collab.ui.join.working'); },
    get joinedApp() { return gt('collab.ui.join.joinedApp'); },
    joinedTeam: (name: string) => gt('collab.ui.join.joinedTeam', { name }),
    get signInFirst() { return gt('collab.ui.join.signInFirst'); },
  },

  teams: {
    get title() { return gt('collab.ui.teams.title'); },
    get intro() { return gt('collab.ui.teams.intro'); },
    get privacy() { return gt('collab.ui.teams.privacy'); },
    get empty() { return gt('collab.ui.teams.empty'); },
    get emptyHint() { return gt('collab.ui.teams.emptyHint'); },
    get newLabel() { return gt('collab.ui.teams.newLabel'); },
    get create() { return gt('collab.ui.teams.create'); },
    created: (name: string) => gt('collab.ui.teams.created', { name }),
    open: (name: string) => gt('collab.ui.teams.open', { name }),
    get back() { return gt('collab.ui.teams.back'); },
    get appsHeading() { return gt('collab.ui.teams.appsHeading'); },
    get noApps() { return gt('collab.ui.teams.noApps'); },
    get getApp() { return gt('collab.ui.teams.getApp'); },
    getTitle: (title: string) => gt('collab.ui.teams.getTitle', { title }),
    get getMessage() { return gt('collab.ui.teams.getMessage'); },
    get gotApp() { return gt('collab.ui.teams.gotApp'); },
    get onShelf() { return gt('collab.ui.teams.onShelf'); },
    get addHeading() { return gt('collab.ui.teams.addHeading'); },
    add: (title: string) => gt('collab.ui.teams.add', { title }),
    get added() { return gt('collab.ui.teams.added'); },
    removeApp: (title: string) => gt('collab.ui.teams.removeApp', { title }),
    get removedApp() { return gt('collab.ui.teams.removedApp'); },
    get leave() { return gt('collab.ui.teams.leave'); },
    leaveTitle: (name: string) => gt('collab.ui.teams.leaveTitle', { name }),
    get leaveMessage() { return gt('collab.ui.teams.leaveMessage'); },
    get left() { return gt('collab.ui.teams.left'); },
    get delete() { return gt('collab.ui.teams.delete'); },
    deleteTitle: (name: string) => gt('collab.ui.teams.deleteTitle', { name }),
    get deleteMessage() { return gt('collab.ui.teams.deleteMessage'); },
    get deleted() { return gt('collab.ui.teams.deleted'); },
  },

  deployment: {
    get heading() { return gt('collab.ui.deployment.heading'); },
    get intro() { return gt('collab.ui.deployment.intro'); },
    latest: (v: number) => gt('collab.ui.deployment.latest', { v }),
    line: (name: string, v: number, latest: number) =>
      v === 0 ? `${name}: has not opened it yet` : v >= latest ? `${name}: up to date` : `${name}: version ${v}, update not opened yet`,
    get loadFailed() { return gt('collab.ui.deployment.loadFailed'); },
  },

  notices: {
    ended: (title: string) => gt('collab.ui.notices.ended', { title }),
    get dismiss() { return gt('collab.ui.notices.dismiss'); },
  },

  get loading() { return gt('collab.ui.loading'); },
  get close() { return gt('collab.ui.close'); },
  get cancel() { return gt('collab.ui.cancel'); },
  get tryAgain() { return gt('collab.ui.tryAgain'); },
};

export const roleName = (role: Role): string => COLLAB_COPY.roles[role].name;
