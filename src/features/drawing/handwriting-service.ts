/**
 * Reading handwriting (docs/08 §15.6). The order is fixed and every step is honest about what ran:
 *
 *   1. Digits are matched on this device with no model (model/handwriting.ts).
 *   2. Anything else goes to Gemini Nano on this device, through the central orchestrator, as
 *      `only_on_device`. Nothing leaves the phone or browser.
 *   3. Only if that fails, and cloud AI is allowed and online, the person is asked, and then one
 *      `only_in_cloud` call is made. That is the single cloud fallback (lead decision 2); it never repeats.
 *
 * The picture sent to a model holds only the selected strokes, in plain ink on white. The prompt is fixed
 * text. No drawing data, labels or app content go into it, and nothing is logged here.
 */
import { sanitizeJsonSchema } from '@/core/ai/json-schema';
import type { AIImage, AIOrchestrator, InferenceMode, InferenceSource, StructuredRequest } from '@/core/contracts';
import {
  cleanReading, HANDWRITING_JSON_SCHEMA, HANDWRITING_PROMPT, HANDWRITING_SYSTEM, parseHandwritingReply, readingWasShortened, recognizeDigits,
  type HandwritingReply, type StrokeElement,
} from './model';

export interface Reading {
  text: string;
  source: InferenceSource;
  /** The model said a word was hard to read. */
  unsure: boolean;
  /** The reading was longer than a label, so the end of it was cut off. */
  shortened?: boolean;
}

export type LocalOutcome =
  | { kind: 'read'; reading: Reading }
  | { kind: 'nothing'; source: InferenceSource }
  /** On-device reading did not work. `cloudPossible` is true when the person may be offered one cloud try. */
  | { kind: 'failed'; message: string; cloudPossible: boolean };

export type CloudOutcome =
  | { kind: 'read'; reading: Reading }
  | { kind: 'nothing'; source: InferenceSource }
  | { kind: 'failed'; message: string };

export interface HandwritingDeps {
  ai: Pick<AIOrchestrator, 'run'>;
  /** The picture of just these strokes. Supplied by the screen, which owns the platform renderer. */
  picture(strokes: readonly StrokeElement[]): AIImage;
  /** Cloud AI is on in Settings, not offline-only, and the device is online. */
  cloudAllowed(): Promise<boolean>;
  languages?: readonly string[];
  signal?: AbortSignal;
}

export function buildHandwritingRequest(
  image: AIImage, mode: InferenceMode, languages?: readonly string[], signal?: AbortSignal,
): StructuredRequest<HandwritingReply> {
  return {
    taskType: 'extract_data',
    system: HANDWRITING_SYSTEM,
    prompt: HANDWRITING_PROMPT,
    images: [image],
    jsonSchema: sanitizeJsonSchema(HANDWRITING_JSON_SCHEMA),
    parse: parseHandwritingReply,
    mode,
    temperature: 0,
    maxOutputTokens: 300,
    timeoutMs: 30_000,
    ...(languages ? { languages } : {}),
    ...(signal ? { signal } : {}),
  };
}

/** Step 1. Pure and instant, so the sheet can show the answer before it opens. */
export function readDigits(strokes: readonly StrokeElement[]): Reading | undefined {
  const m = recognizeDigits(strokes);
  return m ? { text: m.text, source: 'deterministic', unsure: false } : undefined;
}

async function ask(deps: HandwritingDeps, strokes: readonly StrokeElement[], mode: InferenceMode) {
  const req = buildHandwritingRequest(deps.picture(strokes), mode, deps.languages, deps.signal);
  return deps.ai.run(req, { taskType: 'extract_data', complexity: 'simple' });
}

function readingOf(output: HandwritingReply, source: InferenceSource): { kind: 'read'; reading: Reading } | { kind: 'nothing'; source: InferenceSource } {
  const text = cleanReading(output.text);
  if (!text) return { kind: 'nothing', source };
  return { kind: 'read', reading: { text, source, unsure: !!output.unsure, ...(readingWasShortened(output.text) ? { shortened: true } : {}) } };
}

/** Failures that mean "the person turned this off" or "no network": asking for a cloud try would not help. */
const NO_CLOUD_CODES = new Set(['consent_denied', 'offline', 'cancelled', 'quota', 'not_configured', 'app_check_failed']);

/** Step 2. Stays on this device. */
export async function readOnDevice(strokes: readonly StrokeElement[], deps: HandwritingDeps): Promise<LocalOutcome> {
  const res = await ask(deps, strokes, 'only_on_device');
  if (res.success && res.output) return readingOf(res.output, res.source);
  const cloudPossible = !NO_CLOUD_CODES.has(res.errorCode ?? '') && (await deps.cloudAllowed());
  return {
    kind: 'failed',
    cloudPossible,
    message: res.errorMessage?.trim() || 'Gemini Nano could not read this handwriting on this device.',
  };
}

/** Step 3. One call, only after the person agreed. The source on the result is whatever actually ran. */
export async function readInCloud(strokes: readonly StrokeElement[], deps: HandwritingDeps): Promise<CloudOutcome> {
  if (!(await deps.cloudAllowed())) return { kind: 'failed', message: 'Cloud AI is turned off or this device is offline, so nothing was sent.' };
  const res = await ask(deps, strokes, 'only_in_cloud');
  if (res.success && res.output) return readingOf(res.output, res.source);
  return { kind: 'failed', message: res.errorMessage?.trim() || 'The cloud could not read this handwriting. Try again, or type it instead.' };
}
