/**
 * Sentences about widgets that the core writes: what a widget shows, why one could not be made, and the few
 * lines the home screen prints itself. Plain English, short sentences, no dashes as punctuation, no
 * exclamation marks. The screens' own words are in `src/features/widgets/copy.ts`.
 */
import type { WidgetProblemCode } from './sources';

/** The words the home-screen widget prints on its own. They travel inside the payload, so every platform says the same. */
export const WIDGET_HOME_LABELS = {
  /** A list or stat with nothing in it yet. */
  empty: 'Nothing to show yet',
  /** The device has not heard from Kalam for the whole look-ahead. */
  stale: 'Open Kalam to update',
  /** Shown over the numbers while the device is locked and the widget hides them. */
  locked: 'Unlock to see this',
  /** Android: a widget on the home screen that is not tied to any of the person's widgets yet. A tap lets them pick. */
  unboundAndroid: 'Tap to choose what this widget shows',
  /** iPhone: the same state. A tap does nothing there, so it says how to pick. */
  unboundIos: 'Touch and hold this widget, then choose Edit Widget',
  /** The words read out and shown for a tick in a list. */
  done: 'Done',
  notDone: 'Not done',
} as const;
export type WidgetHomeLabels = { -readonly [K in keyof typeof WIDGET_HOME_LABELS]: string };

/** What a widget shows when the thing it points at is gone. It never shows an old number as if it were current. */
export const WIDGET_BROKEN_NOTE: Record<WidgetProblemCode, string> = {
  app_missing: 'This app was deleted. Open Kalam to remove the widget.',
  source_missing: 'This part of the app was changed. Open Kalam to pick it again.',
  field_missing: 'A field this widget showed was removed. Open Kalam to pick it again.',
  screen_missing: 'The screen this widget opens was removed. Open Kalam to pick another.',
  collection_missing: 'The list this widget counted was removed. Open Kalam to pick it again.',
};

export const WIDGET_COPY = {
  refresh: {
    live: 'Updates when you add or change entries, and at midnight for dates.',
    on_open: 'Updates only when you open Kalam.',
  },
  lock: {
    hidden: 'Hides what it shows while the device is locked.',
    shown: 'Shows what it shows even while the device is locked.',
  },
  tap: {
    open_app: 'Opens the app.',
    open_screen: (title: string) => `Opens ${title}.`,
  },
  shows: {
    stat: (label: string, app: string) => `Shows ${label} from ${app}.`,
    count: (list: string, app: string) => `Shows how many entries are in ${list} in ${app}.`,
    list: (rows: number, label: string, app: string) => `Shows up to ${rows} ${rows === 1 ? 'row' : 'rows'} of ${label} from ${app}.`,
  },
  refuse: {
    app_missing: 'That app is not on this device any more.',
    source_missing: 'That part of the app is not there any more. Pick what to show again.',
    field_missing: 'One of the fields you picked is not in the app any more. Pick again.',
    screen_missing: 'The screen a tap should open is not in the app any more. Pick another.',
    collection_missing: 'That list is not in the app any more. Pick again.',
    not_found: 'That widget is not on this device.',
    invalid: 'That widget could not be saved. Check the name and what it shows.',
    too_many_device: (n: number) => `This device keeps up to ${n} widgets. Remove one first.`,
    too_many_app: (n: number) => `One app can have up to ${n} widgets. Remove one first.`,
    no_fields: 'Pick at least one field to show.',
    store: 'Widgets could not be saved on this device. Try again.',
    store_newer: 'These widgets were made by a newer version of Kalam. Update Kalam to change them.',
  },
  status: {
    /** The widget is kept, but the platform did not take the new text. */
    home_not_updated: 'The widget is saved, but your home screen could not be updated just now. Try again in a moment.',
  },
} as const;

/** "Total sales, Orders and Notes" */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
