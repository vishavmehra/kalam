/**
 * User-facing words for KalamSpec 1.1 (validation messages, permission reasons, summaries).
 * Plain English; the runtime's own words live in src/runtime/engine/v11/copy.ts.
 */
import type { PermissionKind } from './schema';

export const PERMISSION_REASON: Record<PermissionKind, string> = {
  camera: 'To take photos for this app',
  notifications: 'To remind you about entries on their date',
};

export const PERMISSION_LABEL: Record<PermissionKind, string> = {
  camera: 'Camera',
  notifications: 'Notifications',
};

const q = (s: string) => `"${s}"`;

export const V11_MESSAGES = {
  // Relations
  refUnknownCollection: (c: string) => `This link points to ${q(c)}, which does not exist.`,
  refUnknownDisplay: (c: string, f: string) => `${q(c)} has no field ${q(f)} to show.`,
  refDisplayType: (f: string) => `${q(f)} cannot be shown for a linked entry. Use a text, number, date or choice field.`,
  refClearRequired: (f: string) =>
    `${q(f)} is required, so it cannot be emptied when the linked entry is deleted. Choose "block the delete" or "delete these too".`,
  refProperty: (f: string, prop: string) => `${q(f)} stores a linked entry, so it cannot have ${prop}. Remove it.`,
  refPlaceholder: (f: string) => `${q(f)} is picked from a list, so its placeholder is never shown.`,
  sortByLink: (f: string) => `Sorting by ${q(f)} orders the list by hidden codes, not by names. Sort by a field of this list instead.`,
  aiIntoMachineField: (f: string) => `${q(f)} holds a linked entry or a signature, so an AI step cannot fill it.`,
  // Components
  chart: (msg: string) => msg,
  timerNeedsDuration: 'A countdown needs a length in seconds.',
  timerNoDuration: 'A stopwatch has no set length. Remove the length.',
  timerNeedsNumber: (f: string) => `A timer writes a number, but ${q(f)} is not a number field.`,
  unitNeedsField: 'The unit only matters when the timer fills a field.',
  reminderUnknownField: (c: string, f: string) => `${q(c)} has no field ${q(f)}.`,
  reminderNeedsDate: (f: string) => `Reminders need a date field, and ${q(f)} is not one.`,
  reminderNeedsYesNo: (f: string) => `${q(f)} must be a yes/no field to mark entries as done.`,
  reminderTitleType: (f: string) => `${q(f)} cannot name an entry in a reminder. Use a text or choice field.`,
  tooManyReminders: (max: number) => `An app can have at most ${max} reminders.`,
  signatureNeedsText: (f: string) => `A signature is saved as text, but ${q(f)} is not a text field.`,
  signatureOnRelation: (f: string) => `${q(f)} links to another entry, so it cannot hold a signature.`,
  signatureTooShort: (f: string, n: number) => `${q(f)} is too short for a signature. Remove its length limit or allow ${n} characters.`,
  // Layout
  layoutUnknown: (id: string) => `The layout names ${q(id)}, which is not on this screen.`,
  layoutTwice: (id: string) => `${q(id)} is placed in the layout twice.`,
  layoutTooDeep: (max: number) => `Groups can sit inside each other at most ${max} deep.`,
  layoutTooMany: (max: number) => `A screen can have at most ${max} groups.`,
  layoutColumns: 'Only a grid has columns.',
  layoutTitle: 'Only a card has a title.',
  // Sections
  permissionTwice: (k: string) => `The ${k} permission is listed twice.`,
  permissionUnused: (k: string) => `Nothing in the app uses the ${k}.`,
  permissionMissing: (k: string) => `The app uses the ${k} but does not say why.`,
  termTwice: (t: string) => `${q(t)} is in the word list twice.`,
  termKeepAndTranslate: (t: string) => `${q(t)} is marked to stay as it is and also has translations. Pick one.`,
  termNoRule: (t: string) => `${q(t)} needs either "keep" or at least one translation.`,
  termTooManyLanguages: (t: string) => `${q(t)} has translations for more than 12 languages.`,
  versionRaised: 'This app was saved in the newer Kalam format, because it uses newer parts.',
  // Simple mode levels (docs/10 §4.3)
  importanceConflict: (id: string, level: string) =>
    `${q(id)} is marked ${level} and also secondary. The level wins, so it is not folded away.`,
  foldedSaves: (title: string) =>
    `Every button that saves on ${q(title)} is folded away in Simple mode, so nothing can be saved there. Keep one of them standard or essential.`,
  foldedRequired: (id: string) =>
    `${q(id)} is folded away in Simple mode but the app needs an answer for it, so the form cannot be saved there. Keep it standard or essential.`,
} as const;

/** "Describe this app" lines for the new components (src/core/spec/describe.ts). */
export const V11_DESCRIBE = {
  chart: (label: string) => `Chart: ${label}`,
  timer: (label: string, mode: 'countdown' | 'stopwatch') => `${mode === 'countdown' ? 'Countdown timer' : 'Stopwatch'}: ${label}`,
  reminder: (label: string) => `Reminder: ${label} (off until you switch it on)`,
  signature: (label: string) => `Signature: ${label}`,
  relation: (collection: string) => `Linked to one of ${collection}`,
} as const;
