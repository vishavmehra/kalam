/**
 * Stable error codes and a small in-memory log of recent ones (docs/11 §17.3: "stable error codes,
 * sanitized messages, minimal technical context"). Only a code from the closed list below is ever
 * kept. Anything else, such as a message that might hold a name or a prompt, becomes `other`.
 * Nothing here is written to disk or sent anywhere.
 */
import { notifyAll } from './notify';

/**
 * Codes Kalam raises today: AI (contracts AIErrorCode), spec validation and edit patches, storage,
 * backup, sharing and device media. `observability.test.ts` checks this list against the contract and
 * against the source files that raise the codes, so a new code cannot be forgotten.
 */
export const KNOWN_ERROR_CODES = [
  // AI
  'offline', 'consent_denied', 'model_unavailable', 'not_configured', 'timeout', 'invalid_output', 'provider_error',
  'quota', 'unsupported_modality', 'cancelled', 'app_check_failed', 'bad_request',
  // Spec validation (src/core/spec/validate.ts)
  'RESOURCE_LIMIT', 'DUPLICATE_ID', 'RESERVED_ID', 'UNKNOWN_SCREEN', 'UNKNOWN_COLLECTION', 'UNKNOWN_TARGET',
  'UNKNOWN_AI_BLOCK', 'UNKNOWN_ACTION', 'UNKNOWN_FIELD', 'FIELD_TYPE_MISMATCH', 'INVALID_OPTIONS', 'MISSING_OPTIONS',
  'INVALID_FORMULA', 'INCOMPATIBLE_AI_BLOCK', 'SPEC_TOO_LARGE', 'SPEC_TOO_DEEP', 'INVALID_JSON', 'SCHEMA_INVALID',
  'SECURITY_CONTENT', 'UNSUPPORTED_SCHEMA_VERSION', 'INVALID_ID', 'UNKNOWN_PROPERTY', 'UNKNOWN_COMPONENT_TYPE',
  'UNKNOWN_ACTION_TYPE', 'UNKNOWN_AI_BLOCK_KIND', 'UNKNOWN_FIELD_TYPE',
  // Edit patches (src/core/edit/apply.ts)
  'PATCH_FAILED', 'PATCH_INVALID', 'PATCH_TOO_LARGE',
  // Storage and backup
  'record_limit', 'blob_too_large', 'database_too_new', 'not_a_backup', 'unsupported_version',
  'wrong_passphrase_or_damaged', 'damaged', 'too_large', 'weak_passphrase', 'conflict', 'random_unavailable',
  // Typed errors that carry no code of their own: `toErrorCode` reads them by class name (NAME_CODES),
  // or by a `.code` once the class declares one.
  'invalid_spec', 'record_invalid', 'share_store', 'shared_record_read_only', 'media_permission', 'video_too_long',
] as const;

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];
export type ErrorCode = KnownErrorCode | 'other';

const KNOWN: ReadonlySet<string> = new Set(KNOWN_ERROR_CODES);

/** Error classes that set `name` but not `code`. A fixed lookup, so no message text is ever read. */
const NAME_CODES: Readonly<Record<string, KnownErrorCode>> = {
  InvalidSpecError: 'invalid_spec',
  RecordValidationError: 'record_invalid',
  ShareStoreError: 'share_store',
};

/**
 * Outcomes that are the person's own choice, not a failure: they are neither listed as recent errors
 * nor counted as errors (`reportError`).
 */
export const NOT_FAILURES: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['cancelled', 'consent_denied']);

/** A known code stays as it is. An error object with a known `.code` (or a known class name) counts too. Everything else is `other`. */
export function toErrorCode(raw: unknown): ErrorCode {
  if (typeof raw === 'string') return KNOWN.has(raw) ? (raw as KnownErrorCode) : 'other';
  const { code, name } = (raw ?? {}) as { code?: unknown; name?: unknown };
  if (typeof code === 'string' && KNOWN.has(code)) return code as KnownErrorCode;
  return typeof name === 'string' && Object.hasOwn(NAME_CODES, name) ? NAME_CODES[name] : 'other';
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
    notifyAll(listeners);
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
