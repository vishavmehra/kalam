/**
 * Client adapter for the server-side specialist providers (Claude, Nebius — docs/07 §7, §8, CP8/CP9).
 * The browser / Android app never holds a provider key: it calls the App Check-protected callable
 * `kalamSpecialistReason` (functions/src/index.ts), which validates server-side; this adapter then
 * runs the request's own Zod parser as the final authority. Disabled unless explicitly enabled
 * (EXPO_PUBLIC_SPECIALIST_ENABLED=true) and Firebase is configured; the orchestrator additionally
 * requires the user's external-provider consent before routing here.
 */
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import type {
  AIErrorCode, AIExecutionResult, AIProvider, AIProviderName, OnDeviceStatus, StructuredRequest, TaskType,
} from '@/core/contracts';
import { getFirebaseApp, isFirebaseConfigured } from '@/infrastructure/firebase/app';

export const SPECIALIST_CALLABLE = 'kalamSpecialistReason';
const SPECIALIST_TASKS: ReadonlySet<TaskType> = new Set<TaskType>(['plan_app', 'repair_spec', 'interpret_sketch']);
const DEFAULT_TIMEOUT_MS = 150_000;
const ERROR_CODES: ReadonlySet<string> = new Set<AIErrorCode>([
  'offline', 'consent_denied', 'model_unavailable', 'not_configured', 'timeout', 'invalid_output', 'provider_error',
  'quota', 'unsupported_modality', 'cancelled', 'app_check_failed',
]);

/** The server pins instructions and the output schema per task (SECURITY_REVIEW R-01): only data goes up. */
interface CallableRequest {
  task: TaskType;
  prompt: string;
  images?: Array<{ mimeType: string; base64: string }>;
  maxOutputTokens?: number;
}
interface CallableResponse {
  output: unknown;
  provider: 'claude' | 'nebius';
  model: string;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Maps a `FunctionsError` (code `functions/<code>`, optional `details.kalamCode`) to AIErrorCode. */
export function mapSpecialistError(e: unknown): { code: AIErrorCode; message: string } {
  const err = (typeof e === 'object' && e !== null ? e : {}) as { code?: string; message?: string; details?: { kalamCode?: unknown } };
  const message = err.message || 'The specialist request failed.';
  const kalam = err.details?.kalamCode;
  if (typeof kalam === 'string' && ERROR_CODES.has(kalam)) return { code: kalam as AIErrorCode, message };
  switch (err.code) {
    case 'functions/unauthenticated':
    case 'functions/permission-denied':
      return { code: 'app_check_failed', message: 'Firebase App Check rejected this app, so the specialist could not be used.' };
    case 'functions/deadline-exceeded': return { code: 'timeout', message: 'The specialist took too long to answer.' };
    case 'functions/resource-exhausted': return { code: 'quota', message: 'Specialist limit reached. Try again later.' };
    case 'functions/not-found': return { code: 'not_configured', message: 'The specialist function is not deployed for this project.' };
    case 'functions/cancelled': return { code: 'cancelled', message: 'The request was cancelled.' };
    default: return { code: 'provider_error', message };
  }
}

/**
 * Local Functions emulator, development builds only (SECURITY_REVIEW R-07): a release build never
 * talks to 127.0.0.1 even if EXPO_PUBLIC_FUNCTIONS_EMULATOR was left set at build time.
 */
export function emulatorAddress(
  raw = process.env.EXPO_PUBLIC_FUNCTIONS_EMULATOR,
  production = process.env.NODE_ENV === 'production',
): { host: string; port: number } | undefined {
  if (production) return undefined;
  const m = raw ? /^\s*([^:\s]+):(\d{2,5})\s*$/.exec(raw) : null;
  return m?.[1] && m[2] ? { host: m[1], port: Number(m[2]) } : undefined;
}

export function createSpecialistProvider(): AIProvider {
  let functions: Functions | undefined;
  const getInstance = (): Functions | undefined => {
    if (functions) return functions;
    const app = getFirebaseApp();
    if (!app) return undefined;
    functions = getFunctions(app);
    const emulator = emulatorAddress();
    if (emulator) connectFunctionsEmulator(functions, emulator.host, emulator.port);
    return functions;
  };
  const isConfigured = () => isFirebaseConfigured() && process.env.EXPO_PUBLIC_SPECIALIST_ENABLED === 'true';

  return {
    name: 'claude',
    isConfigured,
    async onDeviceStatus(): Promise<OnDeviceStatus> {
      return { platform: 'other', apiExposed: false, availability: 'unavailable', detail: 'Specialist providers run on the server.' };
    },
    async generateStructured<T>(req: StructuredRequest<T>): Promise<AIExecutionResult<T>> {
      const started = Date.now();
      const fail = (code: AIErrorCode, errorMessage: string, provider: AIProviderName = 'none', model?: string): AIExecutionResult<T> => ({
        success: false, provider, source: 'cloud', model, latencyMs: Date.now() - started, fallbackUsed: false,
        errorCode: code, errorMessage,
      });

      if (!SPECIALIST_TASKS.has(req.taskType)) {
        return fail('not_configured', `Specialist providers only handle ${[...SPECIALIST_TASKS].join(', ')}.`);
      }
      const instance = isConfigured() ? getInstance() : undefined;
      if (!instance) return fail('not_configured', 'Specialist providers are not enabled for this build.');
      if (req.signal?.aborted) return fail('cancelled', 'The request was cancelled.');

      const payload: CallableRequest = {
        task: req.taskType,
        prompt: req.prompt,
        ...(req.taskType === 'interpret_sketch' && req.images?.length
          ? { images: req.images.slice(0, 4).map((i) => ({ mimeType: i.mimeType, base64: i.base64 })) }
          : {}),
        ...(req.maxOutputTokens ? { maxOutputTokens: Math.min(32_000, Math.max(256, req.maxOutputTokens)) } : {}),
      };
      const callable = httpsCallable<CallableRequest, CallableResponse>(instance, SPECIALIST_CALLABLE, {
        // Pairs with consumeAppCheckToken on the server: a captured token works once (R-01c).
        limitedUseAppCheckTokens: true,
        timeout: Math.min(req.timeoutMs ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
      });

      let data: CallableResponse;
      try {
        const call = callable(payload);
        const aborted = new Promise<never>((_, reject) => {
          req.signal?.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'functions/cancelled' })), { once: true });
        });
        data = (await (req.signal ? Promise.race([call, aborted]) : call)).data;
      } catch (e) {
        const { code, message } = mapSpecialistError(e);
        return fail(code, message);
      }

      const provider: AIProviderName = data?.provider === 'nebius' ? 'nebius' : 'claude';
      const parsed = req.parse(data?.output);
      if (!parsed.success) return fail('invalid_output', `Specialist output failed validation: ${parsed.error}`, provider, data?.model);
      return {
        success: true, output: parsed.data, provider, source: 'cloud', model: data.model,
        latencyMs: Date.now() - started, fallbackUsed: false,
      };
    },
  };
}
