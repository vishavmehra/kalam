import { describe, expect, it } from 'vitest';
import { mapFirebaseError } from './errors';

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
    [aiError('response-error', 'SAFETY'), 'provider_error'],
    [aiError('parse-failed', 'bad json'), 'invalid_output'],
    [aiError('invalid-schema', 'Schema has an unsupported keyword'), 'bad_request'],
    [aiError('invalid-content', 'Content has no parts'), 'bad_request'],
    [aiError('request-error', 'Bad request options'), 'bad_request'],
    [aiError('already-initialized', 'getAI() options differ'), 'not_configured'],
    [aiError('fetch-error', '[500 Internal Server Error]', 500), 'provider_error'],
    [aiError('session-closed', 'Session closed'), 'provider_error'],
    [Object.assign(new Error('Timeout has expired.'), { name: 'AbortError' }), 'cancelled'],
    [Object.assign(new Error('unsupported language'), { name: 'NotSupportedError' }), 'model_unavailable'],
    [Object.assign(new Error('too long'), { name: 'QuotaExceededError' }), 'provider_error'],
    [new TypeError('Network request failed'), 'offline'],
    ['weird', 'provider_error'],
  ])('%s → %s', (e, code) => {
    expect(mapFirebaseError(e).code).toBe(code);
  });

  it('gives an actionable message when AI Logic is not enabled', () => {
    expect(mapFirebaseError(aiError('api-not-enabled', 'x', 403)).message).toMatch(/AI Logic → Get started/);
  });
});
