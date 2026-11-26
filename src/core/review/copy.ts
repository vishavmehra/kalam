/**
 * The core's own sentences for the Understanding Review (docs/03 §13): why an edit was refused, and the
 * text of an uncertain item. Plain English: no dashes as punctuation, no exclamation marks, no ids.
 *
 * Words the screen puts on its own controls are not here. The button names, field and component kinds,
 * AI step policies and the screen reader label of an item button are translated, under `review.action`,
 * `review.actionFor`, `review.fieldType`, `review.componentType`, `review.fallback` and `review.onError`
 * in src/i18n/locales (all ten catalogues). The screen reads them with `useT()`.
 */

export const REVIEW_COPY = {
  unchanged: 'Kalam could not make that change. Your app is as it was.',
  missing: 'That part is no longer in the app.',
  appName: 'Give the app a name of up to 60 characters.',
  screenName: 'Give the screen a name of up to 60 characters.',
  fieldName: 'Give the field a name of up to 120 characters.',
  labelText: 'Use a label of up to 120 characters.',
  needOptions: 'Add at least one choice.',
  photoField: 'A photo field is added by asking for a photo in the app, not here.',
  optionText: 'Use up to 50 choices of up to 60 characters each.',
  lastScreen: 'An app needs at least one screen.',
  tooManyScreens: 'An app can have up to 8 screens.',
  tooManyFields: 'Each kind of entry can have up to 30 fields.',
  lastField: 'A list on a screen shows this field. Keep at least one other field so the list has something to show.',
  usedByAI: 'An AI step uses this field, so it has to stay.',
  cannotRemove: 'This cannot be removed here.',
  needAnswer: 'Write what Kalam should do instead.',
  /** Label of the button added to the start screen so a new or unreachable screen can be opened. */
  openScreen: (title: string): string => `Open ${title}`,
  /** First validation problem → plain sentence. */
  byCode: {
    RESOURCE_LIMIT: 'That is more than a Kalam app can hold.',
    INVALID_FORMULA: 'A total or filter in the app uses this, so it cannot change like that.',
    UNKNOWN_FIELD: 'Something in the app still uses this field.',
    FIELD_TYPE_MISMATCH: 'That type does not fit where this field is used in the app.',
    UNKNOWN_TARGET: 'A counting button uses this, so it has to stay a number.',
    INVALID_OPTIONS: 'A choice on a screen uses an option that is no longer in the list.',
    UNKNOWN_COLLECTION: 'Something in the app still uses these entries.',
    UNKNOWN_SCREEN: 'A button or list still opens this screen.',
    UNKNOWN_ACTION: 'A button still uses this.',
    UNKNOWN_AI_BLOCK: 'A button or photo still uses this AI step.',
    SECURITY_CONTENT: 'That text is not allowed.',
    SCHEMA_INVALID: 'That value is not allowed here.',
    PATCH_INVALID: 'That value is not allowed here.',
    PATCH_FAILED: 'That part is no longer in the app.',
  } as Readonly<Record<string, string>>,
  /** Uncertain items (docs/03 §13.4). */
  items: {
    unreachable: (title: string): string => `No button opens “${title}”, so nobody can reach it.`,
    unused: (name: string): string => `Nothing in the app uses “${name}”.`,
    noSelected: (label: string): string => `The button “${label}” changes an entry, but no list opens its screen.`,
    formMismatch: (label: string): string => `The button “${label}” saves to a different list than its screen fills in.`,
    untested: 'This AI step has not been tested on this device yet.',
  },
  /** Answers that need a rebuild become plain instructions for the compiler (docs/06 §11.5). */
  correction: {
    assumption: (assumed: string, answer: string): string => `Kalam assumed: ${assumed} Correction: ${answer}`,
    question: (question: string, answer: string): string => `${question} Answer: ${answer}`,
  },
} as const;
