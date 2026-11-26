/**
 * Every sentence a person sees for shared apps and teams (copy rule: plain English, no em dashes,
 * no exclamation marks). The engine returns codes; screens look the words up here.
 */
import type { AuditKind, ConflictKind, Role } from './model';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const quote = (v: string | number | boolean | null) => (v === null || v === '' ? 'empty' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : `"${String(v)}"`);

export const COLLAB_COPY = {
  untitled: 'Untitled',
  someone: 'Someone',
  you: 'You',

  errors: {
    sign_in: 'Sign in to share apps with people.',
    guest_account: 'This old guest session cannot share apps. Sign in with email or Google first.',
    offline: 'You are offline. Connect to the internet and try again.',
    no_consent: 'Read what sharing does and agree to it first.',
    no_app: 'This app is no longer on this device.',
    already_shared: 'This app is already shared.',
    not_shared: 'This app is not shared.',
    spec_too_big: 'This app is too large to share. Remove a few screens or fields and try again.',
    spec_invalid: 'The latest shared design did not pass the checks on this device, so the previous one is kept.',
    spec_newer: 'This shared app needs a newer version of Kalam. Update Kalam to get the latest design.',
    denied: 'You do not have permission to do that.',
    not_set_up: 'Sharing is not set up in this build of Kalam.',
    unavailable: 'Could not reach Kalam\'s cloud. Try again in a moment.',
    invalid_code: 'That code does not look right. Paste the whole link or code you were sent.',
    invite_refused: 'This invite does not work any more. Ask for a new one.',
    not_allowed: 'Your role does not allow that.',
    owner_cannot_leave: 'You own this. Stop sharing it instead of leaving.',
    gone: 'This shared app or team no longer exists.',
    read_only: 'You can view this shared app but not change it. Ask its owner for editor access.',
    structure_owner_only: 'Only the owner of this shared app can change its design. Your entries still sync.',
    team_full: 'This team already has 30 apps.',
    team_name: 'Give the team a name.',
    cannot_apply: 'Their version does not fit this app on this device (a full list, or a value the design does not allow), so nothing changed.',
  },

  summary: {
    designUpdate: 'New design from the owner of this shared app',
    photosOptional: 'Photo fields made optional, because photos stay on each device in a shared app',
    joined: (title: string) => `Joined the shared app "${title}"`,
  },

  roles: {
    owner: { name: 'Owner', description: 'Changes the design, manages people, can stop sharing' },
    admin: { name: 'Admin', description: 'Invites and manages editors and viewers, edits entries' },
    editor: { name: 'Editor', description: 'Adds, changes and deletes entries' },
    viewer: { name: 'Viewer', description: 'Sees entries but cannot change them' },
  } satisfies Record<Role, { name: string; description: string }>,

  status: {
    upToDate: 'Up to date',
    syncing: 'Syncing',
    waiting: (n: number) => `${plural(n, 'change', 'changes')} waiting to send`,
    offline: 'Offline. Changes send when you are back online',
    conflicts: (n: number) => `${plural(n, 'entry needs', 'entries need')} a decision`,
    error: 'Could not sync. Kalam will try again',
    /** Short badge words for problems that trying again does not fix. */
    problems: {
      spec_too_big: 'Design too large to share',
      spec_invalid: 'New design did not pass the checks',
      spec_newer: 'Update Kalam to get the new design',
      denied: 'Not allowed. Ask the owner',
      not_set_up: 'Sharing is not set up',
    } as Partial<Record<string, string>>,
    skipped: (n: number) => `${plural(n, 'entry', 'entries')} could not be added here`,
    signedOut: 'Sign in to sync this shared app',
    viewOnly: 'View only',
    a11y: (state: string, role: string) => (role ? `Shared app, ${role.toLowerCase()}. ${state}` : `Shared app. ${state}`),
  },

  share: {
    title: (app: string) => `Share "${app}" with people`,
    intro: 'Invite people to use this app with you. Everyone sees the same entries, and changes reach each other when they are online.',
    whatHappens: 'What sharing does',
    points: [
      'The app\'s design and its entries are stored in Kalam\'s cloud, so the people you invite can see them.',
      'Photos stay on this device. They are never uploaded, so photo fields become optional in the shared app.',
      'Kalam keeps a history of who added, changed or deleted entries, and when. It never stores the values in that history.',
      'Only people you invite can open it. You can remove anyone, or stop sharing, at any time.',
      'When you remove someone, the copy on their phone is deleted the next time it is online. A phone that never goes online again keeps what it had.',
      'Only you change the design. Others get each new version automatically.',
    ],
    consent: 'I understand. Store this app and its entries in the cloud for the people I invite.',
    signInFirst: 'Sign in to share.',
    teamLabel: 'Also give it to a team (optional)',
    noTeam: 'No team',
    button: 'Share this app',
    working: 'Sharing',
    done: 'Shared. Now invite people.',
    yourRole: (role: string) => `You are the ${role.toLowerCase()} of this shared app.`,
    syncNow: 'Sync now',
    synced: 'Synced',
    syncedSkipped: (n: number) =>
      `Synced, but ${plural(n, 'entry', 'entries')} from others could not be added on this device. Kalam fetches ${n === 1 ? 'it' : 'them'} again each time. A full list or an older version of Kalam can cause this.`,
    teamFailed: (reason: string) => `Shared, but it was not added to the team. ${reason}`,
  },

  invite: {
    heading: 'Invite someone',
    roleLabel: 'Invite as',
    create: 'Create invite',
    created: (days: number, uses: number) => `Send this link or code to the people you want to invite. It works for ${plural(days, 'day', 'days')}, for up to ${plural(uses, 'person', 'people')}.`,
    codeLabel: 'Invite code',
    copyLink: 'Copy link',
    copyCode: 'Copy code',
    send: 'Send',
    copied: 'Copied',
    message: (title: string) => `Join "${title}" on Kalam with this link:`,
    openHeading: 'Open invites',
    openLine: (role: string, uses: number, max: number, expires: string) => `${role}, used ${uses} of ${max}, until ${expires}`,
    cancel: 'Cancel invite',
    cancelled: 'Invite cancelled. Its code no longer works.',
    none: 'No open invites.',
  },

  members: {
    heading: 'People',
    you: (name: string) => `${name} (you)`,
    unnamed: 'Someone without a name',
    changeRole: (name: string) => `Change role for ${name}`,
    remove: (name: string) => `Remove ${name}`,
    removeTitle: (name: string) => `Remove ${name}?`,
    removeMessage: 'They lose access straight away. The copy on their phone is deleted the next time it is online.',
    removed: (name: string) => `${name} was removed.`,
    roleChanged: (name: string, role: string) => `${name} is now ${role.toLowerCase()}.`,
    loadFailed: 'Could not load the people in this app.',
    teamNote: 'Members of the team this app belongs to also have access, with their team role.',
  },

  conflicts: {
    heading: 'Needs your decision',
    intro: 'Someone else changed these entries while you did. Nothing was overwritten. Choose which version to keep.',
    title: (kind: ConflictKind, who: string): string => ({
      both_changed: `${who} changed this entry too`,
      deleted_here: `You deleted an entry that ${who} changed`,
      deleted_there: `${who} deleted an entry you changed`,
    })[kind],
    field: (label: string, mine: string | number | boolean | null, theirs: string | number | boolean | null) =>
      `${label}: yours ${quote(mine)}, theirs ${quote(theirs)}`,
    value: (label: string, v: string | number | boolean | null) => `${label}: ${quote(v)}`,
    entry: (name: string) => `Entry: ${name}`,
    unnamedEntry: 'an entry without a name',
    yourVersion: 'Your version',
    theirVersion: 'Their version',
    forEntry: (name: string) => `For ${name}`,
    keepMine: 'Keep mine',
    useTheirs: 'Use theirs',
    keepDeleted: 'Keep it deleted',
    restore: 'Bring back their version',
    keepEntry: 'Keep my entry',
    acceptDelete: 'Delete it',
    resolved: 'Saved your choice.',
  },

  history: {
    heading: 'Recent changes',
    empty: 'No changes yet.',
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
    button: 'Leave this shared app',
    title: (app: string) => `Leave "${app}"?`,
    message: 'The app and its entries are removed from this device. The owner can invite you again.',
    confirm: 'Leave',
    done: 'You left the shared app.',
  },

  stop: {
    button: 'Stop sharing',
    title: (app: string) => `Stop sharing "${app}"?`,
    message: 'Everyone else loses access and the cloud copy is deleted. The app and all its entries stay on this device.',
    confirm: 'Stop sharing',
    done: 'Sharing stopped. The app is only on this device now.',
  },

  /** For the lead: the confirmation shown before deleting a shared app from the shelf. */
  deleteShared: {
    owner: 'This app is shared. Deleting it also deletes the cloud copy, and everyone you invited loses access.',
    member: 'This app is shared with you. Deleting it removes you from it. The owner can invite you again.',
  },

  join: {
    title: 'Join a shared app or team',
    intro: 'Paste the invite link or code someone sent you.',
    noticeHeading: 'What joining does',
    notice: [
      "The app and its entries are copied to this device from Kalam's cloud.",
      'Entries you add or change are sent to the cloud. Everyone in the shared app, including its owner and admins, can see them.',
      'Kalam keeps a history of who added, changed or deleted entries, and when. It never stores the values in that history.',
      'Photos you add stay on this device. They are never uploaded.',
      'If you leave or are removed, the copy on this device is deleted.',
    ],
    consent: 'I understand. Sync my entries with the people in this shared app or team.',
    label: 'Invite link or code',
    button: 'Join',
    working: 'Joining',
    joinedApp: 'You joined. The app is on your shelf now.',
    joinedTeam: (name: string) => `You joined the team "${name}". Open Teams to get its apps.`,
    signInFirst: 'Sign in to join.',
  },

  teams: {
    title: 'Teams',
    intro: 'A team is a group of people with a set of shared apps. Everyone in the team can get the team\'s apps, with their team role.',
    privacy: 'Kalam does not collect usage reports about team members. Admins see who is in the team, their roles, and which design version each person has of the apps they manage. Nothing else.',
    empty: 'You are not in any team yet.',
    emptyHint: 'Create one below, or join one with an invite code someone sent you.',
    newLabel: 'New team name',
    create: 'Create team',
    created: (name: string) => `Team "${name}" created. Invite people next.`,
    open: (name: string) => `Open team ${name}`,
    back: 'Back to teams',
    appsHeading: 'Apps in this team',
    noApps: 'No apps in this team yet.',
    getApp: 'Get this app',
    getTitle: (title: string) => `Get "${title}"?`,
    getMessage: "Its entries sync through Kalam's cloud, and everyone with access, including the team's admins, sees what you add or change. Kalam keeps a history of who changed what, without the values. Photos stay on this device. If you leave the team, the copy is deleted.",
    gotApp: 'The app is on your shelf now.',
    onShelf: 'On your shelf',
    addHeading: 'Add one of your shared apps',
    add: (title: string) => `Add ${title}`,
    added: 'Added to the team.',
    removeApp: (title: string) => `Take ${title} out of the team`,
    removedApp: 'Taken out of the team.',
    leave: 'Leave team',
    leaveTitle: (name: string) => `Leave the team "${name}"?`,
    leaveMessage: 'You lose access to the team\'s apps. Their copies leave this device the next time it syncs.',
    left: 'You left the team.',
    delete: 'Delete team',
    deleteTitle: (name: string) => `Delete the team "${name}"?`,
    deleteMessage: 'Everyone loses access through this team. The apps themselves stay shared with the people invited to them directly.',
    deleted: 'Team deleted.',
  },

  deployment: {
    heading: 'Design versions',
    intro: 'Which version of the design each person has. Only the owner and admins see this.',
    latest: (v: number) => `The latest design is version ${v}.`,
    line: (name: string, v: number, latest: number) =>
      v === 0 ? `${name}: has not opened it yet` : v >= latest ? `${name}: up to date` : `${name}: version ${v}, update not opened yet`,
    loadFailed: 'Could not load the design versions.',
  },

  notices: {
    ended: (title: string) => `You no longer have access to "${title}". Its owner stopped sharing it or removed you, so its copy was removed from this device.`,
    dismiss: 'OK',
  },

  loading: 'Loading',
  close: 'Close',
  cancel: 'Cancel',
  tryAgain: 'Try again',
};

export const roleName = (role: Role): string => COLLAB_COPY.roles[role].name;
