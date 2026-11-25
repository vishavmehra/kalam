/**
 * Stable error codes and a small in-memory log of recent ones (docs/11 §17.3: "stable error codes,
 * sanitized messages, minimal technical context"). Only a code from the closed list below is ever
 * kept. Anything else, such as a message that might hold a name or a prompt, becomes `other`.
 * Nothing here is written to disk or sent anywhere.
 */

/** Codes Kalam raises today: AI (contracts AIErrorCode), spec validation, storage and backup. */
export const KNOWN_ERROR_CODES = [
  // AI
  'offline', 'consent_denied', 'model_unavailable', 'not_configured', 'timeout', 'invalid_output', 'provider_error',
  'quota', 'unsupported_modality', 'cancelled', 'app_check_failed', 'bad_request',
  // Spec validation (src/core/spec/validate.ts)
  'RESOURCE_LIMIT', 'DUPLICATE_ID', 'RESERVED_ID', 'UNKNOWN_SCREEN', 'UNKNOWN_COLLECTION', 'UNKNOWN_TARGET',
  'UNKNOWN_AI_BLOCK', 'UNKNOWN_ACTION', 'UNKNOWN_FIELD', 'FIELD_TYPE_MISMATCH', 'INVALID_OPTIONS', 'MISSING_OPTIONS',
  'INVALID_FORMULA', 'INCOMPATIBLE_AI_BLOCK', 'SPEC_TOO_LARGE', 'SPEC_TOO_DEEP', 'INVALID_JSON', 'SCHEMA_INVALID',
  'SECURITY_CONTENT', 'UNSUPPORTED_SCHEMA_VERSION', 'PATCH_FAILED',
  // Storage and backup
  'record_limit', 'blob_too_large', 'database_too_new', 'not_a_backup', 'unsupported_version',
  'wrong_passphrase_or_damaged', 'damaged', 'too_large', 'weak_passphrase', 'conflict', 'random_unavailable',
] as const;

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];
export type ErrorCode = KnownErrorCode | 'other';

const KNOWN: ReadonlySet<string> = new Set(KNOWN_ERROR_CODES);

/** A known code stays as it is. An error object with a known `.code` counts too. Everything else is `other`. */
export function toErrorCode(raw: unknown): ErrorCode {
  const value = typeof raw === 'string' ? raw : (raw as { code?: unknown } | null | undefined)?.code;
  return typeof value === 'string' && KNOWN.has(value) ? (value as KnownErrorCode) : 'other';
}

export interface ErrorEntry {
  readonly code: ErrorCode;
  /** Epoch milliseconds. */
  readonly at: number;
}

export interface ErrorLog {
  /** Records one failure and returns the code that was kept. Never throws. */
  note(raw: unknown): ErrorCode;
  /** Newest first. */
  recent(): readonly ErrorEntry[];
  clear(): void;
  subscribe(listener: () => void): () => void;
  /** Changes whenever the log changes (for `useSyncExternalStore`). */
  version(): number;
}

export function createErrorLog(capacity = 50, wall: () => number = Date.now): ErrorLog {
  let entries: ErrorEntry[] = [];
  let version = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    version += 1;
    for (const l of [...listeners]) l();
  };
  return {
    note(raw) {
      const code = toErrorCode(raw);
      entries = [{ code, at: wall() }, ...entries].slice(0, capacity);
      changed();
      return code;
    },
    recent: () => entries,
    clear() {
      entries = [];
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
  };
}

/** The one log the app uses. */
export const errorLog = createErrorLog();
