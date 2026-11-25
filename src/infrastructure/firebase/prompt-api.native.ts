/**
 * The Prompt API shape that firebase/ai's hybrid router calls (ChromeAdapterImpl in the @firebase/ai 3.1 esm
 * build that Metro bundles for Android and iOS), backed by a native on-device model: Gemini Nano on Android
 * (on-device.native.ts, modules/kalam-nano) and Apple Foundation Models on iOS (on-device.ios.ts,
 * modules/kalam-apple). Installed as globalThis.LanguageModel, so getGenerativeModel({ mode }) picks the
 * device or the cloud and response.inferenceSource says which one ran. firebase-provider.ts has no
 * platform branch.
 *
 * Structured output: neither native SDK takes a runtime JSON Schema for constrained decoding, so the schema
 * goes in the prompt; firebase-provider parses the JSON and the caller's Zod parser decides.
 */
import type {
  LanguageModelCreateCoreOptions, LanguageModelCreateOptions, LanguageModelMessage, LanguageModelPromptOptions,
} from 'firebase/ai';
import type { LanguageModelStatic } from './on-device.web';

type Availability = Awaited<ReturnType<LanguageModelStatic['availability']>>;

/** The part of a Prompt API session that firebase/ai calls (ChromeAdapterImpl.generateContent). */
interface PromptSession {
  prompt(input: LanguageModelMessage[], options?: LanguageModelPromptOptions & { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}
export interface PromptLanguageModel extends LanguageModelStatic {
  create(options?: LanguageModelCreateOptions): Promise<PromptSession>;
}

/** What a native on-device bridge provides to the adapter. */
export interface NativePromptEngine {
  /** True when the model can answer text in all these primary language codes now. Never downloads. */
  ready(languages: string[]): Promise<boolean>;
  generate(requestId: string, options: { prompt: string }): Promise<{ text: string; source: 'on_device' | 'cloud' }>;
  cancel(requestId: string): boolean;
  /** Turns a native failure into one of the Prompt API error names below. */
  toPromptError(e: unknown): Error;
}

/** Names Chrome's Prompt API uses, so errors.ts maps every platform's failures the same way (docs/07 §18.1). */
const PROMPT_ERRORS = new Set(['AbortError', 'NotAllowedError', 'NotSupportedError', 'QuotaExceededError', 'UnknownError']);

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const promptError = (name: string, msg: string) => Object.assign(new Error(msg), { name });
const primary = (tag: string) => tag.toLowerCase().split(/[-_]/)[0] ?? '';

let requestSeq = 0;

export function createPromptLanguageModel(engine: NativePromptEngine, idPrefix: string): PromptLanguageModel {
  return {
    async availability(options?: LanguageModelCreateCoreOptions): Promise<Availability> {
      // Text only (firebase/ai passes images as ImageBitmap, which React Native lacks). 'unavailable' sends
      // anything else to the cloud under PREFER_ON_DEVICE, as Chrome does. Never 'downloadable': the SDK
      // would then start a download by itself (ChromeAdapterImpl.downloadIfAvailable).
      const io = [...(options?.expectedInputs ?? []), ...(options?.expectedOutputs ?? [])];
      if (io.some((e) => e.type !== 'text')) return 'unavailable';
      const languages = [...new Set(io.flatMap((e) => e.languages ?? []).map(primary))];
      try {
        return (await engine.ready(languages)) ? 'available' : 'unavailable';
      } catch {
        return 'unavailable';
      }
    },
    async create(options?: LanguageModelCreateOptions): Promise<PromptSession> {
      const system = textOf(options?.initialPrompts?.filter((m) => m.role === 'system') ?? []);
      return {
        prompt: (input, promptOptions) => generate(
          engine, idPrefix, composePrompt(system, input, promptOptions?.responseConstraint), promptOptions?.signal ?? options?.signal,
        ),
        destroy() {},
      };
    },
  };
}

function textOf(messages: LanguageModelMessage[]): string {
  return messages
    .flatMap((m) => m.content)
    .map((c) => (c.type === 'text' && typeof c.value === 'string' ? c.value : ''))
    .filter(Boolean)
    .join('\n\n');
}

/** One single-turn prompt: on-device inference is single turn and does not keep roles apart. */
function composePrompt(system: string, input: LanguageModelMessage[], schema?: object): string {
  const format = schema
    ? `Reply with only one JSON value that matches this JSON Schema. No other text.\n${JSON.stringify(schema)}`
    : '';
  return [system, textOf(input), format].filter(Boolean).join('\n\n');
}

async function generate(engine: NativePromptEngine, idPrefix: string, prompt: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw promptError('AbortError', 'The request was cancelled.');
  const id = `${idPrefix}-${++requestSeq}`;
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      engine.cancel(id);
      reject(promptError('AbortError', 'The request was cancelled.'));
    };
  });
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const call = engine.generate(id, { prompt });
    call.catch(() => {}); // after a cancel its rejection is expected
    const result = await Promise.race([call, aborted]);
    // The native side only runs the on-device model; never pass anything else off as on-device.
    if (result.source !== 'on_device') throw promptError('NotSupportedError', 'The answer did not come from the on-device model.');
    return result.text;
  } catch (e) {
    throw e instanceof Error && PROMPT_ERRORS.has(e.name) ? e : engine.toPromptError(e);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
