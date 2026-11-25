/**
 * Everything the person reads in the sharing screens (docs/14 §16). One file so the i18n migration can
 * move it. Plain English: short sentences, no dashes as punctuation, no exclamation marks, no ids.
 * Sentences that explain a link come from `src/core/share/copy.ts`.
 */
import { joinList } from '@/core/share';
import type { ShareIntent } from './model';

export const SHARE_UI = {
  button: 'Share',
  buttonHint: 'Share entries with another app on this device',

  sheetTitle: (appName: string) => `Sharing for ${appName}`,
  sheetIntro:
    'A link lets two of your apps use each other\'s entries. You choose what is shared, and you can turn a link off at any time. Nothing leaves this device.',
  loading: 'Looking for links',
  loadFailed: 'The links could not be read from this device. Close this and try again.',

  empty: {
    title: 'No links yet',
    description: 'Link two of your apps to show one app\'s entries in the other, or to send entries from one to the other.',
  },
  newLink: 'New link',
  listHeading: 'Links for this app',

  card: {
    status: { on: 'On', paused: 'Paused', off: 'Turned off' },
    kind: { read: 'Shows entries', write: 'Sends entries' },
    to: (source: string, destination: string) => `${source} to ${destination}`,
    fields: (labels: readonly string[]) => `Shared fields: ${joinList(labels)}`,
    bazaar: (name: string) => `${name} is from the Bazaar`,
    sentFromThere: (source: string) => `Entries are sent from ${source}. Open that app to send them.`,
    turnedOffOn: (date: string) => `Turned off on ${date}.`,
    history: 'History',
    send: 'Send entries',
    turnOff: 'Turn off',
    remove: 'Remove',
  },

  confirmOff: {
    title: 'Turn off this link?',
    message: (source: string, destination: string) =>
      `${destination} stops using entries from ${source} straight away. Entries that were already sent stay where they are.`,
    confirm: 'Turn off',
  },
  confirmRemove: {
    title: 'Remove this link?',
    message: 'The link and its history are deleted from this device.',
    confirm: 'Remove',
  },
  turnedOff: 'The link is turned off.',
  removed: 'The link is removed.',
  actionFailed: 'That did not work. Nothing was changed.',
  cancel: 'Cancel',
  close: 'Done',

  history: {
    created: 'Link made',
    revoked: 'Turned off',
    sent: (created: number, updated: number) => {
      const parts: string[] = [];
      if (created) parts.push(`${created} sent`);
      if (updated) parts.push(`${updated} updated`);
      return parts.length ? parts.join(', ') : 'Send finished, nothing new';
    },
    blocked: 'Stopped because the link was paused',
    someRejected: 'some were not accepted',
  },

  intent: {
    view_from: {
      label: 'Show entries from another app in this app',
      description: 'This app displays entries that stay in the other app. Nothing is copied.',
    },
    let_view: {
      label: 'Let another app show this app\'s entries',
      description: 'The other app displays your entries here. It cannot change them.',
    },
    send_to: {
      label: 'Send entries from this app to another app',
      description: 'You choose the entries and confirm each time. The other app checks them.',
    },
    receive_from: {
      label: 'Receive entries sent from another app',
      description: 'You choose the entries in the other app. This app checks each one.',
    },
  } satisfies Record<ShareIntent, { label: string; description: string }>,

  form: {
    title: 'New link',
    intentLabel: 'What do you want to do?',
    appLabel: 'Which app?',
    noOtherApp: 'You need a second app on this device before you can share.',
    sourceList: (appName: string) => `Entries to share (list in ${appName})`,
    destinationList: (appName: string) => `Where they go (list in ${appName})`,
    noLists: 'This app has no lists to share.',
    fieldsHeading: 'Which fields?',
    fieldsHelp: 'Choose where each field goes. Fields left as "Not shared" stay in their own app.',
    notShared: 'Not shared',
    fieldGroup: (label: string) => `Where does "${label}" go?`,
    noFields: 'These two lists have no fields that fit each other.',
    previewHeading: 'What this link allows',
    bazaarSwitch: (name: string) => `I trust ${name} with this information`,
    bazaarHelp: (name: string) => `${name} came from the Bazaar and was made by someone else.`,
    allow: 'Allow sharing',
    back: 'Back',
    blockers: {
      pickApp: 'Choose the other app.',
      pickLists: 'Choose a list in each app.',
      pickFields: 'Choose at least one field to share.',
      bazaar: (name: string) => `Confirm that you trust ${name}.`,
    },
  },

  send: {
    title: (destination: string) => `Send entries to ${destination}`,
    help: (fields: readonly string[]) => `Choose the entries to send. Only ${joinList(fields)} are sent.`,
    loading: 'Looking for entries',
    empty: 'There are no entries to send yet.',
    failed: 'The entries could not be read. Go back and try again.',
    selectAll: 'Choose all',
    clear: 'Clear choice',
    sentBefore: 'sent before',
    more: (shown: number, total: number) => `Showing the newest ${shown} of ${total} entries.`,
    update: 'Update entries sent before',
    updateHelp: 'Entries you sent earlier are changed to match this app.',
    action: (n: number) => `Send ${n} ${n === 1 ? 'entry' : 'entries'}`,
    confirmTitle: (destination: string) => `Send to ${destination}?`,
    confirmMessage: (n: number, fields: readonly string[], destination: string, changing: number) =>
      `${n} ${n === 1 ? 'entry is' : 'entries are'} sent. Only ${joinList(fields)} are sent. ${destination} checks each entry before it keeps it.${
        changing ? ` ${changing} of them are already there and will be changed.` : ''
      }`,
    confirm: 'Send',
    back: 'Back',
    limit: (n: number) => `You can choose up to ${n} entries at a time.`,
  },
} as const;
