import type { AIOrchestrator, FormulaValue, InferenceSource, KeyValueRepository, RecordRepository } from '../contracts';

export type FormulaAssistReason =
  | 'empty' | 'unsupported_period' | 'cannot_answer' | 'invalid_formula' | 'ai_unavailable'
  | 'not_single_value' | 'calc_failed' | 'timeout' | 'error';

/** One value that fed the sample calculation, so the person can check it by hand. */
export interface SampleInput {
  label: string;
  value: string;
  /** Field id of a typed value, so a changed value can be sent back through `FormulaAssistContext.typed`. */
  id?: string;
  /** True for a made-up number the person typed or may change to try the formula. */
  editable?: boolean;
}

/** The made-up entries a formula was worked out on, only the fields it reads, so the result can be checked by hand. */
export interface SampleTable { title: string; columns: string[]; rows: string[][] }

/**
 * The formula worked out on values, always labelled (docs/14 §8.5).
 * `entries`: the person's own entries. `examples`: made-up values. `constant`: nothing to look up.
 */
export interface SampleValues {
  kind: 'entries' | 'examples' | 'constant';
  /** One plain sentence that says which of the three it is. */
  label: string;
  inputs: SampleInput[];
  result: Exclude<FormulaValue, ReadonlyArray<unknown>>;
  resultText: string;
  /** Number of the person's entries read, when kind is `entries`. */
  entries?: number;
  /** The made-up entries used, when kind is `examples` and the formula reads entries. Never the person's own entries. */
  tables?: SampleTable[];
}

export interface FormulaSuggestion {
  ok: true;
  formula: string;
  /** Plain-language sentence, written by Kalam's own describer and never by a model. */
  explanation: string;
  /** Collections, fields and counters the formula reads, as people name them. */
  references: string[];
  sampleValues: SampleValues;
  warnings: string[];
  /** Who wrote the formula: ordinary app logic, Gemini Nano, or Gemini in the cloud. The calculation always runs here. */
  source: InferenceSource;
  badge: string;
  model?: string;
  eventId?: string;
}

export interface FormulaFailure {
  ok: false;
  reason: FormulaAssistReason;
  message: string;
  source: InferenceSource;
  warnings: string[];
  /** Why a typed formula was refused, in plain words, one line each. Only set by checkFormula. */
  problems?: string[];
  model?: string;
  eventId?: string;
}

export type FormulaAssistResult = FormulaSuggestion | FormulaFailure;

export interface FormulaAssistContext {
  ai: AIOrchestrator;
  /** Read only for the collections the formula uses, and only after the formula passed every check. */
  records?: Pick<RecordRepository, 'list'>;
  state?: Pick<KeyValueRepository, 'all'>;
  /** Defaults to `spec.id`. */
  appId?: string;
  /** The stat the formula is for. Gives the screen (its typed values) and the way the number is shown. */
  componentId?: string;
  /** Use when there is no component yet, for the typed values of one screen. */
  screenId?: string;
  now?: Date;
  /** Numbers the person typed into the example, by field id. Only number fields use them. */
  typed?: Readonly<Record<string, number>>;
  /** Never fall back to the cloud (the request text stays on this device). */
  onDeviceOnly?: boolean;
  signal?: AbortSignal;
}

/** What checkFormula needs: it never asks a model. */
export type FormulaCheckContext = Omit<FormulaAssistContext, 'ai' | 'onDeviceOnly' | 'signal'>;
