/**
 * Maps Firebase AI Logic / Chrome Prompt API failures to Kalam's AIErrorCode (docs/07 §18.1) with a
 * message a user or developer can act on. Duck-typed (no SDK import) so it is unit-testable in Node.
 * Codes mirror firebase@13.4 `AIErrorCode` and `makeRequest()` (403 SERVICE_DISABLED →
 * 'api-not-enabled'; other HTTP failures → 'fetch-error' + customErrorData.status; network → 'error').
 * The code decides retries (core/ai/limits.ts): 429 → quota, 5xx → provider_error and network →
 * offline are retried with backoff. A request the SDK or service refuses (bad_request: 400 and every
 * other 4xx not named below, a blocked answer, input too large for the on-device model) never is.
 * core/ai/errors.ts turns a code into the docs/13 §21 category, recovery step and user message.
 */
import type { AIErrorCode } from '@/core/contracts';

export interface MappedError { code: AIErrorCode; message: string }

interface ErrorLike {
  name?: string;
  code?: string;
  message?: string;
  customErrorData?: { status?: number };
}

const clip = (s: string) => (s.length > 400 ? `${s.slice(0, 400)}…` : s);

/** What browsers, Hermes and Node say when a request never reached the server. */
const NETWORK_FAILURE = /failed to fetch|networkerror|network request failed|load failed|network error|ERR_INTERNET|ERR_NETWORK|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i;
const OFFLINE: MappedError = { code: 'offline', message: 'Could not reach Firebase. Check your connection.' };

/**
 * The SDK rewraps every non-HTTP failure as code 'error' with "Error fetching from <url>: <cause>",
 * so only the cause after that prefix says whether the network failed.
 */
function isNetworkFailure(msg: string): boolean {
  if ((globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine === false) return true;
  const cause = /Error fetching from \S+: (.*)$/s.exec(msg)?.[1] ?? msg;
  return NETWORK_FAILURE.test(cause);
}

/** The service refused the response schema itself: worth one attempt without constrained decoding. */
export function isSchemaRejection(e: unknown): boolean {
  const err: ErrorLike = typeof e === 'object' && e !== null ? (e as ErrorLike) : {};
  return err.code === 'invalid-schema' || (err.code === 'fetch-error' && err.customErrorData?.status === 400);
}

export function mapFirebaseError(e: unknown): MappedError {
  const err: ErrorLike = typeof e === 'object' && e !== null ? (e as ErrorLike) : { message: String(e) };
  const msg = clip(err.message ?? 'Unknown error');
  const status = err.customErrorData?.status;

  if (err.name === 'AbortError') return { code: 'cancelled', message: 'The request was cancelled.' };
  switch (err.code) {
    case 'api-not-enabled':
      // ONLY_ON_DEVICE meeting an unavailable adapter (web, Android and iOS all throw this one).
      if (/LanguageModel/.test(msg)) return { code: 'model_unavailable', message: 'On-device AI is not available on this device right now.' };
      return {
        code: 'not_configured',
        message: 'Firebase AI Logic is not enabled for this Firebase project. In the Firebase console open AI Logic → Get started '
          + '(Gemini Developer API), wait a few minutes, then retry.',
      };
    case 'no-api-key': case 'no-app-id': case 'no-project-id': case 'no-model': case 'already-initialized':
      return { code: 'not_configured', message: `Firebase is not fully configured: ${msg}` };
    case 'request-error': case 'invalid-content': case 'invalid-schema':
      // The SDK refused to build the request: the same request would fail again, so it is not retried.
      return { code: 'bad_request', message: `The request could not be sent: ${msg}` };
    case 'unsupported':
      return { code: 'model_unavailable', message: `On-device model unavailable: ${msg}` };
    case 'parse-failed':
      return { code: 'invalid_output', message: msg };
    case 'response-error':
      // A blocked or empty answer comes back the same way when asked again.
      return { code: 'bad_request', message: `The model declined or the answer was blocked: ${msg}` };
    case 'fetch-error':
      if (status === 429) return { code: 'quota', message: 'AI quota or rate limit reached. Try again later.' };
      if ((status === 401 || status === 403) && /app.?check/i.test(msg)) {
        return { code: 'app_check_failed', message: 'Firebase App Check rejected this app. Register the debug token or configure reCAPTCHA.' };
      }
      if (status === 401 || status === 403) return { code: 'not_configured', message: `Firebase denied the request (${status}): ${msg}` };
      if (status === 404) return { code: 'model_unavailable', message: `Model not available for this project: ${msg}` };
      if (status === 400) return { code: 'bad_request', message: `The model service rejected the request: ${msg}` };
      if (status === 408 || status === 504) return { code: 'timeout', message: msg };
      // Any other 4xx (409, 413, 422 ...) is a refused request: the same request fails again.
      if (status !== undefined && status >= 400 && status < 500) return { code: 'bad_request', message: `The model service refused the request (${status}): ${msg}` };
      return { code: 'provider_error', message: msg };
    case 'error':
      if (isNetworkFailure(msg)) return OFFLINE;
      return { code: 'provider_error', message: msg };
  }
  // Chrome Prompt API DOMExceptions (on-device leg).
  if (err.name === 'NotSupportedError' || err.name === 'NotAllowedError') return { code: 'model_unavailable', message: msg };
  if (err.name === 'QuotaExceededError') return { code: 'bad_request', message: `Input too large for the on-device model: ${msg}` };
  if (err.name === 'TypeError' && isNetworkFailure(msg)) return OFFLINE;
  return { code: 'provider_error', message: msg };
}
