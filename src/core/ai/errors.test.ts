import { describe, expect, it } from 'vitest';
import type { AIErrorCode } from '../contracts';
import { AI_COPY, AI_ERROR_MESSAGES } from './copy';
import { describeAIError, failureCategory, type FailureCategory } from './errors';

const CODES: AIErrorCode[] = [
  'offline', 'consent_denied', 'model_unavailable', 'not_configured', 'timeout', 'invalid_output', 'provider_error', 'quota',
  'unsupported_modality', 'cancelled', 'app_check_failed', 'bad_request',
];
/** docs/13 §21, plus CANCELLED (docs/07 §18.1). */
const DOC_CATEGORIES: FailureCategory[] = [
  'INPUT_INVALID', 'PREPROCESSING_FAILED', 'CAPABILITY_UNAVAILABLE', 'MODEL_NOT_READY', 'INFERENCE_FAILED', 'INFERENCE_TIMEOUT',
  'NETWORK_UNAVAILABLE', 'RATE_LIMITED', 'OUTPUT_INVALID', 'SEMANTIC_FAILURE', 'REPAIR_FAILED', 'STORAGE_FAILED',
  'MIGRATION_FAILED', 'PERMISSION_DENIED', 'SECURITY_REJECTED', 'CANCELLED',
];

describe('AI failure taxonomy (docs/13 §21)', () => {
  it.each(CODES)('%s has a category, a retry flag, a recovery step and a safe message', (code) => {
    const e = describeAIError(code, 'HTTP 503 from the service');
    expect(DOC_CATEGORIES).toContain(e.category);
    expect(typeof e.retryable).toBe('boolean');
    expect(e.recovery).toBeTruthy();
    expect(e.userMessage).toBe(AI_ERROR_MESSAGES[code]);
    expect(e.technical).toBe('HTTP 503 from the service');
  });

  it('maps the doc categories the inference layer can produce', () => {
    expect(failureCategory('offline')).toBe('NETWORK_UNAVAILABLE');
    expect(failureCategory('quota')).toBe('RATE_LIMITED');
    expect(failureCategory('timeout')).toBe('INFERENCE_TIMEOUT');
    expect(failureCategory('invalid_output')).toBe('OUTPUT_INVALID');
    expect(failureCategory('model_unavailable')).toBe('MODEL_NOT_READY');
    expect(failureCategory('not_configured')).toBe('CAPABILITY_UNAVAILABLE');
    expect(failureCategory('consent_denied')).toBe('PERMISSION_DENIED');
    expect(failureCategory('app_check_failed')).toBe('SECURITY_REJECTED');
    expect(failureCategory('unsupported_modality')).toBe('INPUT_INVALID');
    expect(failureCategory('bad_request')).toBe('INPUT_INVALID');
    expect(failureCategory('provider_error')).toBe('INFERENCE_FAILED');
    expect(failureCategory(undefined)).toBeUndefined();
  });

  it('says which failures can be tried again and offers the matching next step', () => {
    expect(describeAIError('offline')).toMatchObject({ retryable: true, recovery: 'retry_when_online' });
    expect(describeAIError('consent_denied')).toMatchObject({ retryable: false, recovery: 'turn_on_cloud' });
    expect(describeAIError('unsupported_modality')).toMatchObject({ retryable: false, recovery: 'change_input' });
    expect(describeAIError('quota')).toMatchObject({ retryable: true, recovery: 'retry_later' });
    expect(describeAIError('model_unavailable')).toMatchObject({ recovery: 'prepare_on_device' });
  });

  it('clips long technical text and falls back to the code', () => {
    expect(describeAIError('provider_error', 'x'.repeat(1000)).technical).toHaveLength(401);
    expect(describeAIError('timeout').technical).toBe('timeout');
  });
});

describe('AI copy follows the house copy rule', () => {
  const sentences = [
    ...Object.values(AI_ERROR_MESSAGES),
    ...Object.values(AI_COPY).map((v) => (typeof v === 'function' ? v('image_input' as never) : v)),
  ];
  it.each(sentences)('%s', (s) => {
    expect(s).not.toMatch(/[—–!]/);
    expect(s).not.toMatch(/seamless|effortless|unlock|empower|elevate|harness|delve|robust|magic/i);
    expect(s.length).toBeLessThan(140);
  });
});
