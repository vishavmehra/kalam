import type { FormulaValue, InferenceSource } from '../contracts';
import type { KalamSpec } from '../spec/schema';

export type RefusalReason =
  | 'empty' | 'unsafe' | 'no_data' | 'cannot_answer' | 'invalid_formula' | 'ai_unavailable'
  | 'not_single_value' | 'calc_failed' | 'timeout' | 'error';

/** What the assistant says back. Always carries an honest source (docs/14 §13.6). */
export interface AssistantAnswer {
  kind: 'help' | 'calculation' | 'refused';
  /** Plain-language answer or reason, ready to show. */
  text: string;
  /** Steps or short lines that go with `text` (how-to help). */
  lines?: string[];
  /** The formula that was calculated. Shown so the person can check it. */
  formula?: string;
  value?: FormulaValue;
  /** Who produced the answer or the formula: ordinary app logic, Gemini Nano, or Gemini in the cloud. */
  source: InferenceSource;
  /** True for every calculation: the formula runs on this device, on this device's entries. */
  calculatedOnDevice: boolean;
  /** Source badge text. Absent on refusals. */
  badge?: string;
  model?: string;
  /** Inference event id when a model was asked. */
  eventId?: string;
  reason?: RefusalReason;
}

export interface AssistantContext {
  /** Defaults to `spec.id`. Records are always read for this one app only. */
  appId?: string;
  now?: Date;
  /** Never fall back to the cloud (the question text stays on this device). */
  onDeviceOnly?: boolean;
  signal?: AbortSignal;
}

export interface AppAssistant {
  ask(spec: KalamSpec, question: string, ctx?: AssistantContext): Promise<AssistantAnswer>;
  /** Questions worth asking about this app. All of them answer without a model. */
  suggest(spec: KalamSpec): string[];
}

export const BADGE_DEVICE = 'Calculated on this device';
export const BADGE_CLOUD_FORMULA = 'Formula written online, calculated on this device';
export const BADGE_HELP = 'Answered on this device';
