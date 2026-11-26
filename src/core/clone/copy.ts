/** Every sentence a person reads while cloning an app (docs/14 §19). Plain words, no em dashes. */
import type { CloneMode } from './plan';

export const CLONE_COPY = {
  title: 'Make a copy',
  intro: 'The copy is a separate app. Changing one never changes the other.',
  nameLabel: 'Name of the copy',
  nameHint: 'Up to 60 characters',
  chooseLabel: 'What should the copy include',
  modes: {
    design: {
      label: 'Design only',
      description: 'Screens, fields, buttons and calculations. It starts empty and with the standard look.',
    },
    design_theme: {
      label: 'Design and look',
      description: 'The same, with the colours and style of the original.',
    },
    with_records: {
      label: 'Design, look and entries',
      description: 'The same, and a copy of every entry you have saved.',
    },
  } satisfies Record<CloneMode, { label: string; description: string }>,
  entriesCount: (n: number): string => (n === 1 ? '1 saved entry' : `${n} saved entries`),
  noEntries: 'This app has no saved entries to copy yet.',
  confirmEntries: {
    title: (n: number): string => (n === 1 ? 'Copy 1 entry?' : `Copy ${n} entries?`),
    message: (app: string): string =>
      `Every entry in ${app} will be copied into the new app. After that the two apps keep their own entries. Copied entries show today as the day they were added.`,
    pictures: (n: number): string =>
      n === 1 ? 'One picture is not copied. Pictures stay with the original app.' : `${n} pictures are not copied. Pictures stay with the original app.`,
    confirm: 'Copy entries',
    cancel: 'Do not copy entries',
  },
  action: 'Make copy',
  working: 'Making the copy',
  done: (name: string): string => `${name} is on your shelf`,
  summary: (source: string): string => `Copied from ${source}`,
  /** Second version of a copy whose entries needed some required fields lifted while they were written. */
  summaryRules: 'Required fields set as in the original',
  /** After the copy, when something stayed behind. Empty when nothing did. */
  left: {
    entries: (n: number): string => (n === 1 ? '1 entry did not fit its list and was left out.' : `${n} entries did not fit their list and were left out.`),
    pictures: (n: number): string => (n === 1 ? '1 picture stays with the original.' : `${n} pictures stay with the original.`),
  },
  errors: {
    name: 'Give the copy a name of 1 to 60 characters.',
    confirm: 'Copying entries needs your confirmation first.',
    design: 'The design could not be copied, so nothing was saved.',
    save: 'The copy could not be saved. The original app has not changed.',
    leftover: 'The copy could not be finished and is still on your shelf. Delete it from your shelf, then try again. The original app has not changed.',
  },
  copySuffix: (n: number): string => (n <= 1 ? '(copy)' : `(copy ${n})`),
} as const;

/** What the toast says when a copy is on the shelf, and whether anything stayed behind. */
export function cloneDoneMessage(
  name: string, left: { skippedEntries: number; skippedPictures: number },
): { message: string; partial: boolean } {
  const more: string[] = [];
  if (left.skippedEntries > 0) more.push(CLONE_COPY.left.entries(left.skippedEntries));
  if (left.skippedPictures > 0) more.push(CLONE_COPY.left.pictures(left.skippedPictures));
  return { message: more.length ? [`${CLONE_COPY.done(name)}.`, ...more].join(' ') : CLONE_COPY.done(name), partial: more.length > 0 };
}
