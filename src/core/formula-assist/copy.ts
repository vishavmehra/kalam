/**
 * Every sentence the formula helper says, in one place so the later language work can move it.
 * Plain English, no dashes as punctuation, no exclamation marks.
 */
import type { FormulaAssistReason } from './types';

export const COPY = {
  // Describing a formula in words (docs/14 §8.2 step 6).
  shows: 'Shows',
  unreadable: 'This formula cannot be read, so it cannot be put into words.',
  unknownPart: 'something that cannot be put into words',
  empty: 'nothing',
  yes: 'yes',
  no: 'no',
  today: 'today',
  currentTime: 'the current time',
  sameMonth: 'in the same month',
  thisMonth: 'in this month',
  plus: 'plus',
  minus: 'minus',
  times: 'times',
  dividedBy: 'divided by',
  is: 'is',
  isNot: 'is not',
  lessThan: 'is less than',
  atMost: 'is at most',
  moreThan: 'is more than',
  atLeast: 'is at least',
  and: 'and',
  or: 'or',
  not: 'not',
  rounding: (digits: number | undefined): string =>
    digits === undefined || digits === 0 ? 'rounded to a whole number' : `rounded to ${digits} decimal place${digits === 1 ? '' : 's'}`,
  noSign: 'ignoring any minus sign',
  joined: 'joined into one text',

  // Why a request gave no formula.
  reasons: {
    empty: 'Describe what the number should show, for example "total amount this month".',
    unsupported_period: 'Formulas can only look at today or this month for now. Try one of those.',
    cannot_answer: 'I could not find a way to work that out from the fields in this app. Try naming the fields, for example "total amount this month".',
    invalid_formula: 'I could not turn that into a formula I trust, so I did not use it. Try asking in a simpler way.',
    ai_unavailable: 'That needs AI, and AI is not available right now. Requests like "how many orders" or "total amount" still work.',
    not_single_value: 'That would list your entries. A number needs one answer, such as a count, a total or an average.',
    calc_failed: 'The formula was valid, but it could not be worked out on example values.',
    timeout: 'That took too long. Try again.',
    error: 'Something went wrong. Try again.',
  } satisfies Record<FormulaAssistReason, string>,

  // Warnings shown with a suggestion.
  warnNoValue: 'On these values the formula gives no result. It stays empty when a value is missing or when it divides by zero.',
  warnTextForNumber: (format: string): string => `This stat is shown as ${format}, but the formula gives text or yes or no.`,
  formatNames: { number: 'a number', integer: 'a whole number', currency: 'money', percent: 'a percentage' } as const,
  readFailed: 'I could not read your entries, so the values shown are examples.',

  // Labels for the sample values.
  sampleConstant: 'This formula does not use any of your entries.',
  sampleEntries: (n: number): string => `Worked out from your ${n} ${n === 1 ? 'entry' : 'entries'} on this device.`,
  sampleCounters: 'Worked out from your counters on this device.',
  sampleExamplesEntries: 'Example only. These are made-up entries, not yours.',
  sampleExamplesInputs: 'Example only. These are made-up values, not yours.',
  sampleExamplesBoth: 'Example only. These are made-up entries and values, not yours.',
  sampleMixed: 'Your entries are real. The values you would type are examples.',
  noValue: 'No value',
  yesText: 'Yes',
  noText: 'No',
} as const;
