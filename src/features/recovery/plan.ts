/**
 * Intelligent error recovery (docs/14 §14): maps a stable error code to what failed, what was kept,
 * and the typed, safe actions that may help. Pure TypeScript, no model: the plan is a fixed table, so
 * "AI must not override security checks" holds (docs/14 §14.5). Every sentence is an i18n key; the
 * screens translate them.
 *
 * `kept` states the app's own guarantees, not a per-event check: a failed build leaves the typed input
 * and the last valid version in place (docs/05 §20, docs/09), a rejected import leaves the original file
 * untouched (docs/11 §14), and nothing here deletes data.
 */
import type { CreationResult } from '@/core/contracts';
import { toErrorCode, type ErrorCode, type KnownErrorCode, type RecoveryActionKind } from '@/core/observability';
import type { TranslationKey } from '@/i18n/keys';

/** docs/14 §14.2. */
export type RecoveryCategory =
  | 'input' | 'formula' | 'ai_output' | 'network' | 'storage' | 'import' | 'permission' | 'marketplace' | 'device';

/** Where the failure came from, when the code alone cannot say (a spec check fails for AI, import and Bazaar alike). */
export type RecoveryOrigin = 'ai' | 'import' | 'bazaar';

export interface RecoveryPlan {
  code: ErrorCode;
  category: RecoveryCategory;
  /** What failed, as a sentence. */
  what: TranslationKey;
  /** What was kept. */
  kept: TranslationKey;
  /** Safe actions in order; the first is the main one. Empty when only waiting or reading helps. */
  actions: readonly RecoveryActionKind[];
  /** Trying the same thing again can work, now or later. */
  retryable: boolean;
}

type Row = Omit<RecoveryPlan, 'code'>;
const row = (category: RecoveryCategory, what: string, kept: string, actions: readonly RecoveryActionKind[], retryable: boolean): Row => ({
  category, what: `recovery.what.${what}` as TranslationKey, kept: `recovery.kept.${kept}` as TranslationKey, actions, retryable,
});

const DESIGN = row('ai_output', 'badOutput', 'app', ['retry', 'change_input'], true);
const NEWER = (category: RecoveryCategory) => row(category, 'newer', 'file', [], false);
const FILE = row('import', 'file', 'file', ['choose_another_file'], false);

/** Spec check and edit patch codes (src/core/spec/validate.ts, src/core/edit/apply.ts) share one plan. */
const DESIGN_CODES = [
  'RESOURCE_LIMIT', 'DUPLICATE_ID', 'RESERVED_ID', 'UNKNOWN_SCREEN', 'UNKNOWN_COLLECTION', 'UNKNOWN_TARGET', 'UNKNOWN_AI_BLOCK',
  'UNKNOWN_ACTION', 'UNKNOWN_FIELD', 'FIELD_TYPE_MISMATCH', 'INVALID_OPTIONS', 'MISSING_OPTIONS', 'INCOMPATIBLE_AI_BLOCK',
  'SPEC_TOO_LARGE', 'SPEC_TOO_DEEP', 'INVALID_JSON', 'SCHEMA_INVALID', 'SECURITY_CONTENT', 'UNSUPPORTED_SCHEMA_VERSION', 'INVALID_ID',
  'UNKNOWN_PROPERTY', 'UNKNOWN_COMPONENT_TYPE', 'UNKNOWN_ACTION_TYPE', 'UNKNOWN_AI_BLOCK_KIND', 'UNKNOWN_FIELD_TYPE',
  'PATCH_FAILED', 'PATCH_INVALID', 'PATCH_TOO_LARGE', 'invalid_output', 'invalid_spec',
] as const satisfies readonly KnownErrorCode[];

const TABLE: Readonly<Partial<Record<KnownErrorCode, Row>>> = {
  // AI (contracts AIErrorCode; the actions match core/ai/errors.ts TAXONOMY)
  offline: row('network', 'offline', 'input', ['retry_when_online'], true),
  consent_denied: row('permission', 'consent', 'input', ['turn_on_cloud', 'change_input'], false),
  model_unavailable: row('device', 'model', 'input', ['prepare_on_device', 'retry_later'], true),
  not_configured: row('device', 'notSetUp', 'input', [], false),
  timeout: row('network', 'timeout', 'input', ['retry'], true),
  provider_error: row('network', 'service', 'input', ['retry_later'], true),
  quota: row('network', 'service', 'input', ['retry_later'], true),
  app_check_failed: row('network', 'service', 'input', ['retry_later'], true),
  unsupported_modality: row('input', 'input', 'input', ['change_input'], false),
  bad_request: row('input', 'input', 'input', ['change_input'], false),
  cancelled: row('input', 'cancelled', 'input', ['retry'], true),
  // Formulas
  INVALID_FORMULA: row('formula', 'formula', 'app', ['fix_formula'], false),
  // Storage, backup and import
  record_limit: row('storage', 'storageFull', 'entries', ['review_storage', 'export_backup'], false),
  blob_too_large: row('storage', 'storageFull', 'entries', ['review_storage', 'export_backup'], false),
  database_too_new: NEWER('storage'),
  unsupported_version: NEWER('import'),
  not_a_backup: FILE,
  wrong_passphrase_or_damaged: FILE,
  damaged: FILE,
  too_large: FILE,
  weak_passphrase: row('input', 'passphrase', 'input', ['change_input'], false),
  conflict: row('import', 'conflict', 'file', ['change_input'], false),
  random_unavailable: row('device', 'device', 'none', [], false),
  // Entries, sharing and device media
  record_invalid: row('input', 'entry', 'input', ['change_input'], false),
  shared_record_read_only: row('input', 'entry', 'entries', [], false),
  share_store: row('storage', 'share', 'entries', ['retry'], true),
  media_permission: row('permission', 'permission', 'input', ['allow_access'], false),
  video_too_long: row('device', 'device', 'input', ['change_input'], false),
};
for (const code of DESIGN_CODES) (TABLE as Record<string, Row>)[code] = DESIGN;

const OTHER: Row = row('input', 'generic', 'none', ['retry'], true);

/** The plan for a code. Anything not on the closed list of codes gets the plain fallback. */
export function planRecovery(raw: unknown, origin?: RecoveryOrigin): RecoveryPlan {
  const code = toErrorCode(raw);
  const found = code === 'other' ? OTHER : TABLE[code] ?? OTHER;
  // A design check that failed on a file or a download is an import or Bazaar problem, not an AI one.
  const category = found === DESIGN && origin === 'import' ? 'import' : found === DESIGN && origin === 'bazaar' ? 'marketplace' : found.category;
  return { code, ...found, category };
}

/**
 * The stable code for a failed build (a CreationResult has no single code): the last cloud compile pass that
 * named one, else the first spec problem, else 'other'. Only the code is read, never the message.
 */
export function creationErrorCode(result: Pick<CreationResult, 'errors' | 'compileAttempts'>): ErrorCode {
  const named = result.compileAttempts?.map((a) => a.errorCode).filter(Boolean).at(-1);
  return toErrorCode(named ?? result.errors[0]?.code);
}

const ACTION_KEYS: Readonly<Record<RecoveryActionKind, TranslationKey>> = {
  retry: 'recovery.action.retry',
  retry_when_online: 'recovery.action.retryWhenOnline',
  retry_later: 'recovery.action.retryLater',
  turn_on_cloud: 'recovery.action.turnOnCloud',
  prepare_on_device: 'recovery.action.prepareOnDevice',
  change_input: 'recovery.action.changeInput',
  fix_formula: 'recovery.action.fixFormula',
  review_storage: 'recovery.action.reviewStorage',
  export_backup: 'recovery.action.exportBackup',
  choose_another_file: 'recovery.action.chooseAnotherFile',
  allow_access: 'recovery.action.allowAccess',
};

export const actionKey = (action: RecoveryActionKind): TranslationKey => ACTION_KEYS[action];
