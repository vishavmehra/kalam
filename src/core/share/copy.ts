/**
 * Words the person reads when a link is made, paused or used (docs/14 §16). Kept in one place so the
 * i18n migration can move them. Plain English: no dashes as punctuation, no exclamation marks, no ids.
 * Nothing here ever receives an entry's values, only app, list and field names.
 */
import type { KalamFieldType } from '../spec/schema';
import { SHARE_LIMITS, type ShareAccess } from './model';

/** Names a message may use. All of them come from app designs, never from entries. */
export interface NameContext {
  source: string;
  destination: string;
  /** List name in the app the message is about. */
  list?: string;
  field?: string;
  was?: string;
  now?: string;
  choices?: string;
  /** The link is being made now, so nothing "is now" different from before. */
  creating?: boolean;
}

export const TYPE_NAME: Record<KalamFieldType, string> = {
  text: 'text',
  number: 'a number',
  date: 'a date',
  boolean: 'yes or no',
  enum: 'a choice',
  image: 'a photo',
};

export const SHARE_COPY = {
  problem: {
    revoked: () => 'This link is turned off.',
    source_app_missing: () => 'The app that shares these entries is not on this device any more.',
    destination_app_missing: () => 'The app that uses these entries is not on this device any more.',
    source_collection_missing: (c: NameContext) => `${c.source} no longer has the list "${c.list}".`,
    destination_collection_missing: (c: NameContext) => `${c.destination} no longer has the list "${c.list}".`,
    source_field_missing: (c: NameContext) => `${c.source} no longer has the field "${c.field}".`,
    destination_field_missing: (c: NameContext) => `${c.destination} no longer has the field "${c.field}".`,
    source_type_changed: (c: NameContext) => `The field "${c.field}" in ${c.source} is now ${c.now}, but the link was made for ${c.was}.`,
    destination_type_changed: (c: NameContext) =>
      `The field "${c.field}" in ${c.destination} is ${c.creating ? '' : 'now '}${c.now} and cannot hold ${c.was}.`,
    destination_choices_missing: (c: NameContext) =>
      `The field "${c.field}" in ${c.destination} does not have these choices from ${c.source}: ${c.choices}.`,
    destination_required_missing: (c: NameContext) =>
      `${c.destination} needs "${c.field}" on every entry, and this link does not fill it. ${c.destination} would not take the entries.`,
  },
  /** Shown once under the problems of a link that is on but cannot pass anything right now. */
  pausedNote: 'The link is paused. Nothing passes through it until this is fixed.',

  create: {
    not_confirmed: 'Nothing was shared. Confirm the link first.',
    same_app: 'Choose a different app. An app cannot share with itself.',
    app_missing: 'One of the two apps is not on this device.',
    list_missing: 'One of the two lists is not in its app.',
    no_fields: 'Choose at least one field to share.',
    bad_fields: 'One of the chosen fields cannot be shared that way.',
    too_many_links: `An app can have up to ${SHARE_LIMITS.linksPerApp} links. Remove one first.`,
    duplicate: 'These two lists are already linked. Turn that link off first if you want to change it.',
    needs_bazaar_ack: (destination: string) =>
      `${destination} came from the Bazaar and was made by someone else. Confirm that you trust it with this information.`,
    required_unmapped: (destination: string, field: string) =>
      `${destination} needs "${field}" on every entry. Share a field into it, or it will not accept the entries.`,
    not_stored: 'The link could not be saved. Nothing was shared.',
    done: 'The link is on.',
  },

  revoke: {
    done: 'The link is turned off. Nothing more is shared through it.',
    missing: 'That link is no longer there.',
  },

  send: {
    not_confirmed: 'Nothing was sent. Confirm first.',
    no_link: 'There is no link for this.',
    revoked: 'This link is turned off. Nothing was sent.',
    read_only: 'This link only lets the other app look at entries. It cannot send them.',
    broken: 'The link is paused, so nothing was sent.',
    nothing_selected: 'Choose at least one entry to send.',
    too_many: `You can send up to ${SHARE_LIMITS.sendBatch} entries at a time.`,
    sent: (created: number, updated: number, destination: string): string => {
      const parts: string[] = [];
      if (created) parts.push(`${created} new ${created === 1 ? 'entry' : 'entries'}`);
      if (updated) parts.push(`${updated} ${updated === 1 ? 'entry' : 'entries'} updated`);
      return parts.length ? `Sent to ${destination}: ${parts.join(' and ')}.` : `Nothing new was sent to ${destination}.`;
    },
    skipped: (n: number) => `${n} ${n === 1 ? 'entry was' : 'entries were'} left out.`,
    turnedOffMidway: 'The link was turned off while sending, so the rest were not sent.',
    notRecorded: 'The history of this send could not be saved. Sending the same entries again may add them twice.',
    failed: (n: number, destination: string) => `${destination} would not take ${n} ${n === 1 ? 'entry' : 'entries'}.`,
  },

  skip: {
    not_found: 'The entry is no longer there.',
    already_sent: 'Already sent before.',
  },
  fail: {
    invalid: 'The other app would not accept it.',
    full: 'The other list is full.',
    error: 'It could not be saved.',
  },

  readOnlyEntry: 'This entry comes from another app. Change it there.',

  /**
   * Words for screens that belong to other features and end links as a side effect (docs/11 §6.3: say what
   * happens to the data). Add them to the text those screens already show.
   */
  elsewhere: {
    /** After the delete app question. */
    deleteApp:
      'Links with other apps are removed too. An app that was showing its entries stops showing them. Entries already sent to another app stay there.',
    /** After the "replace with backup" question. */
    replaceApps:
      'Links with other apps are removed for the apps that are replaced. The backup does not hold links, so make them again if you still want them.',
  },
} as const;

/** "A", "A and B", "A, B and C". */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** `customer_list` becomes `customer list`. Used only when a design gives no label. */
export function humanize(id: string): string {
  return id.replace(/_/g, ' ');
}

export interface LinkSentence {
  access: ShareAccess;
  source: string;
  destination: string;
  sourceList: string;
  destinationList: string;
  fields: readonly string[];
}

/** What a link lets happen, in sentences a shopkeeper would use. Shown before and after it is made. */
export function describeLink(s: LinkSentence): string[] {
  const fields = joinList(s.fields);
  if (s.access === 'read') {
    return [
      `${s.destination} shows ${fields} from the list "${s.sourceList}" in ${s.source}, as part of its list "${s.destinationList}".`,
      `${s.destination} can look at these entries. It cannot change or delete them.`,
      `The entries stay in ${s.source}. Nothing is copied, and nothing leaves this device.`,
    ];
  }
  return [
    `${s.source} can send entries from "${s.sourceList}" to the list "${s.destinationList}" in ${s.destination}. Only ${fields} are sent.`,
    `Each time, you choose the entries and confirm. ${s.destination} checks every entry before it keeps it.`,
    'Nothing leaves this device, and the two lists are not kept in step afterwards.',
  ];
}
