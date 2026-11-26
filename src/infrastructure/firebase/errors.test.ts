import { describe, expect, it } from 'vitest';
import { isSchemaRejection, mapFirebaseError } from './errors';

const aiError = (code: string, message: string, status?: number) =>
  Object.assign(new Error(message), { name: 'FirebaseError', code, customErrorData: status ? { status } : undefined });

describe('mapFirebaseError', () => {
  it.each([
    [aiError('api-not-enabled', 'enable it', 403), 'not_configured'],
    [aiError('no-api-key', 'missing'), 'not_configured'],
    [aiError('unsupported', 'ONLY_ON_DEVICE but no model'), 'model_unavailable'],
    [aiError('fetch-error', '[429 Too Many Requests] Resource exhausted', 429), 'quota'],
    [aiError('fetch-error', '[401 Unauthorized] Firebase App Check token is invalid.', 401), 'app_check_failed'],
    [aiError('fetch-error', '[403 Forbidden] PERMISSION_DENIED', 403), 'not_configured'],
    [aiError('fetch-error', '[404 Not Found] models/x is not found', 404), 'model_unavailable'],
    [aiError('fetch-error', '[400 Bad Request] Request contains an invalid argument.', 400), 'bad_request'],
    [aiError('fetch-error', '[503 Service Unavailable]', 503), 'provider_error'],
    [aiError('fetch-error', '[504 Gateway Timeout]', 504), 'timeout'],
    [aiError('error', 'Error fetching from https://x: Failed to fetch'), 'offline'],
    [aiError('error', 'AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent: Load failed (AI/error)'), 'offline'],
    [aiError('error', 'AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent: Network request failed (AI/error)'), 'offline'],
    // The SDK puts "Error fetching from" in front of every non-HTTP failure: that alone is not a network failure.
    [aiError('error', 'AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/models/x:generateContent: Invalid header value (AI/error)'), 'provider_error'],
    [aiError('response-error', 'SAFETY'), 'bad_request'],
    [aiError('fetch-error', '[413 Payload Too Large]', 413), 'bad_request'],
    [aiError('fetch-error', '[409 Conflict]', 409), 'bad_request'],
    [aiError('fetch-error', '[422 Unprocessable Entity]', 422), 'bad_request'],
    [aiError('parse-failed', 'bad json'), 'invalid_output'],
    [aiError('invalid-schema', 'Schema has an unsupported keyword'), 'bad_request'],
    [aiError('invalid-content', 'Content has no parts'), 'bad_request'],
    [aiError('request-error', 'Bad request options'), 'bad_request'],
    [aiError('already-initialized', 'getAI() options differ'), 'not_configured'],
    [aiError('fetch-error', '[500 Internal Server Error]', 500), 'provider_error'],
    [aiError('session-closed', 'Session closed'), 'provider_error'],
    [Object.assign(new Error('Timeout has expired.'), { name: 'AbortError' }), 'cancelled'],
    [aiError('api-not-enabled', 'Local LanguageModel API not available in this environment.'), 'model_unavailable'],
    [Object.assign(new Error('unsupported language'), { name: 'NotSupportedError' }), 'model_unavailable'],
    [Object.assign(new Error('too long'), { name: 'QuotaExceededError' }), 'bad_request'],
    [new TypeError('Network request failed'), 'offline'],
    ['weird', 'provider_error'],
  ])('%s → %s', (e, code) => {
    expect(mapFirebaseError(e).code).toBe(code);
  });

  it('reads navigator.onLine === false as offline whatever the SDK says', () => {
    const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
    try {
      expect(mapFirebaseError(aiError('error', 'Error fetching from https://x: something odd')).code).toBe('offline');
    } finally {
      if (nav) Object.defineProperty(globalThis, 'navigator', nav);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

  it('only a refused response schema earns the attempt without constrained decoding', () => {
    expect(isSchemaRejection(aiError('fetch-error', '[400]', 400))).toBe(true);
    expect(isSchemaRejection(aiError('invalid-schema', 'bad keyword'))).toBe(true);
    for (const e of [aiError('fetch-error', '[413]', 413), aiError('response-error', 'SAFETY'), aiError('request-error', 'x'), 'boom', null]) {
      expect(isSchemaRejection(e)).toBe(false);
    }
  });

  it('gives an actionable message when AI Logic is not enabled', () => {
    expect(mapFirebaseError(aiError('api-not-enabled', 'x', 403)).message).toMatch(/AI Logic → Get started/);
  });
});
