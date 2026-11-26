/**
 * Creation session state machine (docs/06 §3.2-3.3). A failed attachment or build never ends the
 * session: every failure state can collect more input or try again. Pure TypeScript.
 */
import type { CreationSession } from '@/core/contracts';

export const SESSION_STATUSES = [
  'draft', 'collecting', 'preprocessing', 'ready_for_review', 'compiling', 'understanding_review', 'completed',
  'attachment_failed', 'preprocessing_failed', 'compilation_failed', 'interrupted', 'cancelled',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type SessionEvent =
  | 'input_added' | 'input_removed' | 'all_removed'
  | 'processing_started' | 'processing_finished' | 'processing_failed' | 'attachment_failed'
  | 'review_requested' | 'compile_started' | 'compile_succeeded' | 'compile_failed'
  | 'accepted' | 'cancelled' | 'interrupted';

const RECOVERABLE: readonly SessionStatus[] = ['attachment_failed', 'preprocessing_failed', 'compilation_failed', 'interrupted', 'cancelled'];
const EDITABLE: readonly SessionStatus[] = ['draft', 'collecting', 'ready_for_review', 'understanding_review', ...RECOVERABLE];

const TABLE: Record<SessionEvent, { from: readonly SessionStatus[]; to: SessionStatus }> = {
  input_added: { from: [...EDITABLE, 'preprocessing'], to: 'collecting' },
  input_removed: { from: [...EDITABLE, 'preprocessing'], to: 'collecting' },
  all_removed: { from: [...EDITABLE, 'preprocessing'], to: 'draft' },
  processing_started: { from: [...EDITABLE, 'preprocessing'], to: 'preprocessing' },
  processing_finished: { from: ['preprocessing', 'collecting', 'attachment_failed'], to: 'collecting' },
  processing_failed: { from: ['preprocessing'], to: 'preprocessing_failed' },
  attachment_failed: { from: ['preprocessing', 'collecting', 'draft', 'attachment_failed'], to: 'attachment_failed' },
  review_requested: { from: ['collecting', 'ready_for_review', 'understanding_review', ...RECOVERABLE], to: 'ready_for_review' },
  compile_started: { from: ['collecting', 'ready_for_review', 'understanding_review', ...RECOVERABLE], to: 'compiling' },
  compile_succeeded: { from: ['compiling'], to: 'understanding_review' },
  compile_failed: { from: ['compiling'], to: 'compilation_failed' },
  accepted: { from: ['understanding_review'], to: 'completed' },
  cancelled: { from: ['preprocessing', 'compiling'], to: 'cancelled' },
  interrupted: { from: ['preprocessing', 'compiling'], to: 'interrupted' },
};

/** Next status, or undefined when `event` is not allowed from `status`. */
export function nextStatus(status: SessionStatus, event: SessionEvent): SessionStatus | undefined {
  const rule = TABLE[event];
  return rule.from.includes(status) ? rule.to : undefined;
}

export const canApply = (status: SessionStatus, event: SessionEvent) => nextStatus(status, event) !== undefined;

/** After a reload or app restart, work that was running did not finish. */
export function recoverStatus(status: SessionStatus): SessionStatus {
  return nextStatus(status, 'interrupted') ?? status;
}

export const isRecoverable = (s: SessionStatus) => RECOVERABLE.includes(s);
export const isBusy = (s: SessionStatus) => s === 'preprocessing' || s === 'compiling';

/** The stored row's coarse state (core/contracts CreationSession.state). */
export function storedState(s: SessionStatus): CreationSession['state'] {
  switch (s) {
    case 'compiling':
      return 'compiling';
    case 'understanding_review':
      return 'review';
    case 'completed':
      return 'saved';
    case 'compilation_failed':
      return 'failed';
    default:
      return 'draft';
  }
}
