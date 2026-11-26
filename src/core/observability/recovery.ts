/**
 * Recovery events (docs/14 §14.3 step 8: "Record the recovery event"). One event says that a failure
 * was shown to the person, with a recovery action offered or taken and how it ended. Like the error
 * log, an entry holds only values from closed lists plus a clock time: a stable error code, an action
 * kind and an outcome. There is no field for a message, a prompt, an app name, an id or a record value,
 * and `note` copies only those three fields from what it is given. The log lives in memory, is never
 * written to disk and is never sent anywhere.
 */
import { toErrorCode, type ErrorCode } from './errors';
import { notifyAll } from './notify';

/** The typed recovery actions. `core/ai/errors.ts` RecoveryAction is a subset of these. */
export const RECOVERY_ACTIONS = [
  'retry', 'retry_when_online', 'retry_later', 'turn_on_cloud', 'prepare_on_device', 'change_input',
  'fix_formula', 'review_storage', 'export_backup', 'choose_another_file', 'allow_access',
] as const;
export type RecoveryActionKind = (typeof RECOVERY_ACTIONS)[number];

/** `shown`: offered. `applied`: the person took the action. `dismissed`: closed without acting. `failed`: the action did not work. */
export const RECOVERY_OUTCOMES = ['shown', 'applied', 'dismissed', 'failed'] as const;
export type RecoveryOutcome = (typeof RECOVERY_OUTCOMES)[number];

export interface RecoveryEntry {
  readonly code: ErrorCode;
  readonly outcome: RecoveryOutcome;
  /** The action offered or taken. Absent when the failure has no safe action. */
  readonly action?: RecoveryActionKind;
  /** Epoch milliseconds. */
  readonly at: number;
}

export interface RecoveryNote {
  code: unknown;
  outcome: unknown;
  action?: unknown;
}

export interface RecoveryLog {
  /** Records one event and returns what was kept, or undefined when the outcome is not on the list. Never throws. */
  note(raw: RecoveryNote): RecoveryEntry | undefined;
  /** Newest first. */
  recent(): readonly RecoveryEntry[];
  clear(): void;
  subscribe(listener: () => void): () => void;
  /** Changes whenever the log changes (for `useSyncExternalStore`). */
  version(): number;
}

const ACTIONS: ReadonlySet<unknown> = new Set(RECOVERY_ACTIONS);
const OUTCOMES: ReadonlySet<unknown> = new Set(RECOVERY_OUTCOMES);

export function createRecoveryLog(capacity = 50, wall: () => number = Date.now): RecoveryLog {
  let entries: RecoveryEntry[] = [];
  let version = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    version += 1;
    notifyAll(listeners);
  };
  return {
    note(raw) {
      const outcome = (raw as RecoveryNote | undefined)?.outcome;
      if (!OUTCOMES.has(outcome)) return undefined;
      const action = (raw as RecoveryNote).action;
      const entry: RecoveryEntry = {
        code: toErrorCode((raw as RecoveryNote).code),
        outcome: outcome as RecoveryOutcome,
        ...(ACTIONS.has(action) ? { action: action as RecoveryActionKind } : {}),
        at: wall(),
      };
      entries = [entry, ...entries].slice(0, Math.max(1, capacity));
      changed();
      return entry;
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
export const recoveryLog = createRecoveryLog();
