/**
 * Firebase AI Logic provider — the real hybrid path (docs/07 §5, §6). One `GenerativeModel` per
 * request with `HybridParams`: the SDK decides Gemini Nano (Chrome Prompt API) vs Gemini cloud from
 * the mode, and we report the SDK's own `response.inferenceSource`, never an assumption.
 * Verified against firebase@13.4 `@firebase/ai` (ai-public.d.ts + esm build).
 */
import {
  AgentPlatformBackend, getAI, getGenerativeModel, GoogleAIBackend, InferenceMode as SdkInferenceMode, ThinkingLevel,
  type AI, type HybridParams, type LanguageModelPromptOptions, type Part, type UsageMetadata,
} from 'firebase/ai';
import { cloudResponseSchema } from '@/core/ai/json-schema';
import { DEFAULT_TIMEOUT_MS } from '@/core/ai/limits';
import { modelForRole } from '@/core/ai/model-config';
import { withBudget } from '@/core/ai/orchestrator';
import { isFallback } from '@/core/ai/routing';
import type { AIErrorCode, AIExecutionResult, AIProvider, InferenceMode, StructuredRequest } from '@/core/contracts';
import { appCheckReady, getFirebaseApp, isFirebaseConfigured } from './app';
import { isSchemaRejection, mapFirebaseError } from './errors';
import { getLanguageModel, ON_DEVICE_MODEL_NAME, onDeviceStatus, prepareOnDevice, warmUpOnDevice } from './on-device';
import { textIO } from './prompt-io';
import { loadRemoteConfig } from './remote-config';

/** DOMException names the Prompt API and the native on-device bridges throw (see errors.ts). */
const ON_DEVICE_ERRORS: ReadonlySet<string> = new Set([
  'NotAllowedError', 'NotSupportedError', 'QuotaExceededError', 'UnknownError', 'InvalidStateError', 'OperationError',
]);

/** A debug-token exchange takes ~1 s and a first reCAPTCHA Enterprise token a few seconds. */
const APP_CHECK_BUDGET_MS = 8_000;

const SDK_MODE: Readonly<Record<InferenceMode, HybridParams['mode']>> = {
  only_on_device: SdkInferenceMode.ONLY_ON_DEVICE,
  prefer_on_device: SdkInferenceMode.PREFER_ON_DEVICE,
  only_in_cloud: SdkInferenceMode.ONLY_IN_CLOUD,
  prefer_in_cloud: SdkInferenceMode.PREFER_IN_CLOUD,
};

// Hermes (Android) lacks AbortSignal.any, which firebase/ai's makeRequest() calls on every cloud request.
const AbortSignalCtor = globalThis.AbortSignal as typeof AbortSignal | undefined;
if (AbortSignalCtor && typeof AbortSignalCtor.any !== 'function') {
  AbortSignalCtor.any = (signals: Iterable<AbortSignal>) => {
    const c = new AbortController();
    for (const s of signals) {
      if (s.aborted) { c.abort(s.reason); break; }
      s.addEventListener('abort', () => c.abort(s.reason), { once: true });
    }
    return c.signal;
  };
}

/**
 * Firebase AI Logic backend. `google` = Gemini Developer API (AI Studio billing; free tier on Spark);
 * `agent_platform` = Agent Platform (Vertex) Gemini API billed through the project's Cloud Billing (Blaze).
 * Both support hybrid on-device inference. Literal env reads so Expo inlines them.
 */
function createBackend() {
  const backend = process.env.EXPO_PUBLIC_AI_BACKEND;
  if (backend === 'agent_platform') {
    const location = process.env.EXPO_PUBLIC_AI_LOCATION;
    return location ? new AgentPlatformBackend(location) : new AgentPlatformBackend();
  }
  return new GoogleAIBackend();
}

const CLOUD_MIN_OUTPUT_TOKENS = 2048;

/**
 * Reasoning depth for cloud calls. LOW keeps latency/cost down; MINIMAL is rejected by
 * gemini-3.8-flash on Agent Platform (400 "Thinking level is unsupported", verified 2026-11-18).
 */
function thinkingLevelFor(_role: StructuredRequest<unknown>['role']): ThinkingLevel {
  return ThinkingLevel.LOW;
}

const stripFences = (s: string) => s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

/**
 * Token counts from the response (docs/07 §16.4). Thinking tokens are billed as output, so they are
 * counted there. The on-device leg reports none.
 */
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function reportUsage(req: StructuredRequest<unknown>, usage: UsageMetadata | undefined): void {
  if (!usage || !req.onUsage) return;
  // The SDK types say number, but the service leaves counts out (no candidates when thinking used the cap).
  const input = count(usage.promptTokenCount);
  const answer = count(usage.candidatesTokenCount);
  const thoughts = count(usage.thoughtsTokenCount);
  const output = answer === undefined && thoughts === undefined ? undefined : (answer ?? 0) + (thoughts ?? 0);
  if (input === undefined && output === undefined) return;
  try {
    req.onUsage({ input, output });
  } catch {
    /* accounting must never fail a request */
  }
}

/**
 * How the cloud leg is told the output shape. `config`: constrained decoding via
 * `responseJsonSchema` (see cloudResponseSchema). `prompt`: plain JSON mode with
 * the schema in the system instruction, used once when the service rejects the schema itself (400).
 * Either way `req.parse` (Zod) is the final authority.
 */
type SchemaPlacement = 'config' | 'prompt';

export function createFirebaseProvider(): AIProvider {
  let ai: AI | undefined;

  return {
    name: 'firebase',
    isConfigured: isFirebaseConfigured,
    onDeviceStatus,
    prepareOnDevice,
    warmUpOnDevice,

    async generateStructured<T>(req: StructuredRequest<T>): Promise<AIExecutionResult<T>> {
      const started = Date.now();
      const images = req.images ?? [];
      const audio = req.audio ?? [];
      // Which leg the SDK will use, so a failure reports where it happened (the orchestrator's one
      // cloud fallback depends on it). prefer_on_device mirrors the SDK: on-device only when available.
      const leg: 'on_device' | 'cloud' = req.mode === 'only_on_device'
        || (req.mode === 'prefer_on_device' && !audio.length && !!getLanguageModel()
          && (await withBudget(onDeviceStatus(), 1_500, { platform: 'web', apiExposed: true, availability: 'unknown' })).availability === 'available')
        ? 'on_device' : 'cloud';
      const fail = (code: AIErrorCode, message: string, source: 'on_device' | 'cloud' = leg, model?: string): AIExecutionResult<T> => ({
        success: false, provider: 'firebase', source, model, latencyMs: Date.now() - started, fallbackUsed: false,
        errorCode: code, errorMessage: message,
      });

      const app = getFirebaseApp();
      if (!app) return fail('not_configured', 'Firebase is not configured: set EXPO_PUBLIC_FIREBASE_* in .env.local.');
      if (req.mode !== 'only_on_device') {
        // Model names, prompt versions and flags (docs/04 §11.6). Started once, never awaited: this
        // request uses whatever is active now, later ones pick up the fetched values. Only when cloud
        // use is allowed: the orchestrator sends only_on_device when consent, offline-only mode or the
        // caller rules the cloud out, and then nothing may contact Google (docs/07 §9.5).
        void loadRemoteConfig();
      } else {
        // Without the Prompt API the SDK builds no on-device adapter and would silently call the cloud.
        if (!getLanguageModel()) return fail('model_unavailable', 'On-device AI is not available on this platform.');
        if (images.some((i) => i.mimeType === 'image/webp')) return fail('unsupported_modality', 'On-device AI accepts JPEG or PNG images only.');
        if (audio.length) return fail('unsupported_modality', 'On-device AI does not hear recordings here. Transcription runs in the cloud.');
      }

      // The SDK awaits an App Check token before each cloud request with no timeout of its own.
      const mayUseCloud = leg === 'cloud';
      const appCheckBudget = Math.min(APP_CHECK_BUDGET_MS, req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      if (mayUseCloud && !(await appCheckReady(appCheckBudget))) {
        return fail('app_check_failed', `Firebase App Check gave no token within ${Math.round(appCheckBudget / 1000)} s.`, 'cloud');
      }

      const model = modelForRole(req.role ?? 'compiler');
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const forwardAbort = () => controller.abort();
      if (req.signal?.aborted) controller.abort();
      req.signal?.addEventListener('abort', forwardAbort, { once: true });
      // The on-device leg may ignore signals; racing guarantees timeout/cancel always return.
      const aborted = new Promise<never>((_, reject) => {
        const rejectAbort = () => reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
        if (controller.signal.aborted) rejectAbort();
        else controller.signal.addEventListener('abort', rejectAbort, { once: true });
      });

      const cloudSchema = cloudResponseSchema(req.jsonSchema);
      // Only languages the Prompt API supports, English always (prompt-io.ts).
      const io = textIO(req.languages);
      const generativeModel = (placement: SchemaPlacement) => {
        ai ??= getAI(app, { backend: createBackend() });
        const promptOptions: LanguageModelPromptOptions & { signal: AbortSignal } = {
          responseConstraint: req.jsonSchema, signal: controller.signal,
        };
        const schemaNote = `Reply with one JSON value that matches this JSON Schema:\n${JSON.stringify(cloudSchema)}`;
        return getGenerativeModel(ai, {
          // The device models are not assumed to hear audio: a recording always goes to the cloud leg.
          mode: audio.length && req.mode === 'prefer_on_device' ? SDK_MODE.only_in_cloud : SDK_MODE[req.mode],
          inCloudParams: {
            model,
            systemInstruction: placement === 'config' ? req.system : [req.system, schemaNote].filter(Boolean).join('\n\n'),
            generationConfig: {
              responseMimeType: 'application/json',
              ...(placement === 'config' ? { responseJsonSchema: cloudSchema } : {}),
              // Gemini 3.x thinking tokens count against maxOutputTokens; a small cap truncates the JSON.
              // The cap is a ceiling, not a charge: billing counts tokens actually produced.
              maxOutputTokens:
                req.maxOutputTokens === undefined ? undefined : Math.max(req.maxOutputTokens, CLOUD_MIN_OUTPUT_TOKENS),
              thinkingConfig: { thinkingLevel: thinkingLevelFor(req.role) },
              ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
            },
          },
          onDeviceParams: {
            createOptions: {
              expectedInputs: images.length ? [...(io.expectedInputs ?? []), { type: 'image' }] : io.expectedInputs,
              expectedOutputs: io.expectedOutputs,
              // The SDK drops systemInstruction on-device; a system initial prompt keeps instructions
              // separate from user content there too (docs/07 §17.4).
              initialPrompts: req.system ? [{ role: 'system', content: [{ type: 'text', value: req.system }] }] : undefined,
              signal: controller.signal,
            },
            promptOptions,
          },
        });
      };
      const parts: Part[] = [
        { type: 'text', text: req.prompt },
        ...images.map((img): Part => ({ type: 'inlineData', inlineData: { mimeType: img.mimeType, data: img.base64 } })),
        // Gemini names an MP3 "audio/mp3"; the file sniffer (core/media/sniff.ts) calls it "audio/mpeg".
        ...audio.map((a): Part => ({ type: 'inlineData', inlineData: { mimeType: a.mimeType === 'audio/mpeg' ? 'audio/mp3' : a.mimeType, data: a.base64 } })),
      ];
      const generate = async (placement: SchemaPlacement) => {
        const call = generativeModel(placement).generateContent(parts, {
          signal: controller.signal, timeout: (req.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 5_000,
        });
        call.catch(() => {}); // if the race is lost, its later rejection is expected
        return (await Promise.race([call, aborted])).response;
      };

      try {
        let response: Awaited<ReturnType<typeof generate>>;
        try {
          response = await generate('config');
        } catch (e) {
          // A 400 means the service refused the request shape (not billed, never transient). Retrying
          // once without constrained decoding is a deterministic degrade, not a provider cascade.
          if (timedOut || req.mode === 'only_on_device' || !isSchemaRejection(e)) throw e;
          response = await generate('prompt');
        }

        const source = response.inferenceSource === 'on_device' ? 'on_device' : 'cloud';
        const usedModel = source === 'on_device' ? ON_DEVICE_MODEL_NAME : model;
        reportUsage(req, response.usageMetadata);
        let raw: unknown;
        try {
          raw = JSON.parse(stripFences(response.text()));
        } catch {
          return fail('invalid_output', 'The model returned text that is not valid JSON.', source, usedModel);
        }
        const parsed = req.parse(raw);
        if (!parsed.success) return fail('invalid_output', `Model output failed validation: ${parsed.error}`, source, usedModel);
        return {
          success: true, output: parsed.data, provider: 'firebase', source, model: usedModel,
          latencyMs: Date.now() - started, fallbackUsed: isFallback(req.mode, source),
        };
      } catch (e) {
        if (timedOut) return fail('timeout', `No response within ${Math.round((req.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} s.`);
        const mapped = mapFirebaseError(e);
        // The status probe can time out and label the leg 'cloud' although the device ran and threw. A Prompt API
        // error name proves the device leg, so the orchestrator's one cloud fallback (lead decision 2) still runs.
        const onDeviceError = req.mode === 'prefer_on_device' && ON_DEVICE_ERRORS.has(String((e as { name?: unknown } | null)?.name));
        return fail(mapped.code, mapped.message, onDeviceError ? 'on_device' : undefined);
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener('abort', forwardAbort);
      }
    },
  };
}
