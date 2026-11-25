/**
 * One typed failure taxonomy for the AI layer (docs/13 §21, docs/07 §18.1, docs/04 §20.3, docs/14 §14).
 * Providers map SDK and network errors to an AIErrorCode (src/infrastructure/firebase/errors.ts for
 * Firebase AI Logic); this module turns a code into a KalamAIError: a stable category, whether trying
 * again can help, what the person can do next, a safe sentence for anyone, and the technical detail
 * for logs. Pure TypeScript.
 */
import type { AIErrorCode } from '../contracts';
import { AI_ERROR_MESSAGES, AI_ERROR_MESSAGES_BY_SOURCE } from './copy';

/** docs/13 §21 categories, plus CANCELLED for a person stopping a request (docs/07 §18.1). */
export type FailureCategory =
  | 'INPUT_INVALID' | 'PREPROCESSING_FAILED' | 'CAPABILITY_UNAVAILABLE' | 'MODEL_NOT_READY' | 'INFERENCE_FAILED'
  | 'INFERENCE_TIMEOUT' | 'NETWORK_UNAVAILABLE' | 'RATE_LIMITED' | 'OUTPUT_INVALID' | 'SEMANTIC_FAILURE'
  | 'REPAIR_FAILED' | 'STORAGE_FAILED' | 'MIGRATION_FAILED' | 'PERMISSION_DENIED' | 'SECURITY_REJECTED'
  | 'CANCELLED';

/** The safe next step to offer (docs/14 §14.3). */
export type RecoveryAction =
  | 'retry' | 'retry_later' | 'retry_when_online' | 'turn_on_cloud' | 'prepare_on_device' | 'change_input' | 'none';

export interface KalamAIError {
  code: AIErrorCode;
  category: FailureCategory;
  /** Asking again, now or later, may succeed. */
  retryable: boolean;
  recovery: RecoveryAction;
  /** Plain English, safe for anyone to read. */
  userMessage: string;
  /** For logs and the Activity screen. Provider and SDK text only, never prompt content. */
  technical: string;
}

const TAXONOMY: Readonly<Record<AIErrorCode, Pick<KalamAIError, 'category' | 'retryable' | 'recovery'>>> = {
  offline: { category: 'NETWORK_UNAVAILABLE', retryable: true, recovery: 'retry_when_online' },
  consent_denied: { category: 'PERMISSION_DENIED', retryable: false, recovery: 'turn_on_cloud' },
  model_unavailable: { category: 'MODEL_NOT_READY', retryable: true, recovery: 'prepare_on_device' },
  not_configured: { category: 'CAPABILITY_UNAVAILABLE', retryable: false, recovery: 'none' },
  timeout: { category: 'INFERENCE_TIMEOUT', retryable: true, recovery: 'retry' },
  invalid_output: { category: 'OUTPUT_INVALID', retryable: true, recovery: 'retry' },
  provider_error: { category: 'INFERENCE_FAILED', retryable: true, recovery: 'retry_later' },
  quota: { category: 'RATE_LIMITED', retryable: true, recovery: 'retry_later' },
  unsupported_modality: { category: 'INPUT_INVALID', retryable: false, recovery: 'change_input' },
  cancelled: { category: 'CANCELLED', retryable: true, recovery: 'retry' },
  app_check_failed: { category: 'SECURITY_REJECTED', retryable: true, recovery: 'retry_later' },
  bad_request: { category: 'INPUT_INVALID', retryable: false, recovery: 'change_input' },
};

const clip = (s: string) => (s.length > 400 ? `${s.slice(0, 400)}…` : s);

/**
 * `source` is where the failure happened (AIExecutionResult.source), when known: a cloud model that is
 * missing (HTTP 404) is not fixed by preparing the on-device model, and an image the device model
 * cannot read is not a bad photo.
 */
export function describeAIError(code: AIErrorCode, technical = '', source?: 'on_device' | 'cloud' | 'deterministic'): KalamAIError {
  const where = source === 'on_device' || source === 'cloud' ? source : undefined;
  const userMessage = (where && AI_ERROR_MESSAGES_BY_SOURCE[where][code]) || AI_ERROR_MESSAGES[code];
  const taxonomy = code === 'model_unavailable' && where === 'cloud'
    ? { ...TAXONOMY[code], recovery: 'retry_later' as const }
    : TAXONOMY[code];
  return { code, ...taxonomy, userMessage, technical: clip(technical || code) };
}

export function failureCategory(code: AIErrorCode | undefined): FailureCategory | undefined {
  return code ? TAXONOMY[code].category : undefined;
}
