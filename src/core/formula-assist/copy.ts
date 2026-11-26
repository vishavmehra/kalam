/**
 * Every sentence the formula helper says, in one place so the later language work can move it.
 * Plain English, no dashes as punctuation, no exclamation marks.
 */
import type { FormulaAssistReason } from './types';

const AND = 'and';

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
  are: 'are',
  areNot: 'are not',
  isNot: 'is not',
  lessThan: 'is less than',
  atMost: 'is at most',
  moreThan: 'is more than',
  atLeast: 'is at least',
  and: AND,
  or: 'or',
  not: 'not',
  rounding: (digits: number | undefined): string =>
    digits === undefined || digits === 0 ? 'rounded to a whole number' : `rounded to ${digits} decimal place${digits === 1 ? '' : 's'}`,
  roundingBy: (digits: string): string => `rounded to ${digits} decimal places`,
  noSign: 'ignoring any minus sign',
  joined: 'joined into one text',

  // Phrases the describer builds sentences from.
  wordFor: { sum: 'total', avg: 'average', min: 'lowest', max: 'highest', earliest: 'earliest', latest: 'latest' } as const,
  the: (what: string): string => `the ${what}`,
  aggregate: (word: string, field: string, entries: string): string => `the ${word} ${field} of ${entries}`,
  aggregateOf: (word: string, values: string): string => `the ${word} of ${values}`,
  numberOf: (entries: string): string => `the number of ${entries}`,
  filledIn: (field: string, entries: string): string => `the number of ${field} values filled in for ${entries}`,
  filledInAmong: (values: string): string => `the number of values filled in among ${values}`,
  valuesIn: (field: string, entries: string): string => `the number of ${field} values in ${entries}`,
  charactersIn: (text: string): string => `the number of characters in ${text}`,
  entriesWhere: (entries: string, tests: string): string => `${entries} where ${tests}`,
  allOf: (entries: string): string => `all ${entries}`,
  everyEntry: (field: string, entries: string): string => `the ${field} of every entry in ${entries}`,
  counterNamed: (label: string): string => `the ${label} counter`,
  whenOtherwise: (value: string, test: string, other: string): string => `${value} when ${test}, otherwise ${other}`,
  monthOf: (date: string): string => `the month of ${date}`,
  weekOf: (date: string): string => `the week of ${date}`,
  streakOf: (dates: string): string => `the number of days in a row, up to today, in ${dates}`,
  openedEntry: 'the entry opened from the list',
  remainder: (a: string, b: string): string => `the remainder of ${a} divided by ${b}`,

  // Why a request gave no formula.
  reasons: {
    empty: 'Describe what the number should show, for example "total amount this month".',
    unsupported_period: 'Formulas can only look at today or this month for now. Try one of those.',
    cannot_answer: 'I could not find a way to work that out from the fields in this app. Try naming the fields, for example "total amount this month".',
    invalid_formula: 'I could not turn that into a formula I trust, so I did not use it. Try asking in a simpler way.',
    ai_unavailable: 'That needs AI, and AI is not available right now. Requests like "how many orders" or "total amount" still work.',
    not_single_value: 'That would list your entries. A number needs one answer, such as a count, a total or an average.',
    calc_failed: 'The formula was valid, but it could not be worked out here.',
    timeout: 'That took too long. Try again.',
    error: 'Something went wrong. Try again.',
  } satisfies Record<FormulaAssistReason, string>,

  // Checking a formula the person typed.
  checkEmpty: 'Type a formula to check.',
  checkProblem: 'That formula cannot be used yet. Fix what is listed, then check it again.',
  tooLong: (max: number): string => `The formula is longer than ${max} characters`,
  syntaxNear: (at: string | undefined): string =>
    at ? `This formula is not written correctly near character ${at}.` : 'This formula is not written correctly.',
  singleEquals: 'To compare two things, write == and not a single =.',

  // Warnings shown with a suggestion.
  warnNoValue: 'On these values the formula gives no result. It stays empty when a value is missing or when it divides by zero.',
  warnTextForNumber: (format: string): string => `This stat is shown as ${format}, but the formula gives text or yes or no.`,
  formatNames: { number: 'a number', integer: 'a whole number', currency: 'money', percent: 'a percentage' } as const,
  readFailed: 'I could not read your entries, so the values shown are examples.',
  readCountersFailed: 'I could not read your counters, so the values shown are examples.',
  warnTooManyEntries: 'Your entries are too many for this formula to be worked out here, so the values shown are examples.',

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
