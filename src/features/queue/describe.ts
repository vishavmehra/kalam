/**
 * What to say about each queued operation: pure functions from a row to translation keys and flags, so
 * the words stay in the catalogue and the rules can be tested without React.
 */
import { isActive, type OpError, type OpKind, type OpStatus, type PendingOperation, type SendKind } from '@/core/queue';
import type { TranslationKey } from '@/i18n/keys';
import { readTranslateResult } from './snapshot';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export interface Message { key: TranslationKey; params?: Record<string, string | number> }

export interface OperationView {
  title: TranslationKey;
  status: TranslationKey;
  tone: Tone;
  /** One sentence on where it stands. */
  detail: Message;
  /** Why it stopped, for a failed row. */
  problem?: TranslationKey;
  /** What it will send when it runs (only while it can still run). */
  sends: TranslationKey[];
  canCancel: boolean;
  canRetry: boolean;
  canRemove: boolean;
  /** What opening the result does, when there is one. */
  open?: 'review' | 'app';
}

const TONE: Record<OpStatus, Tone> = {
  waiting_for_network: 'neutral', ready: 'info', processing: 'info', completed: 'success', failed: 'danger', cancelled: 'neutral',
};

const TITLE: Record<OpKind, TranslationKey> = {
  compile: 'queue.kind.compile', translate: 'queue.kind.translate', ai_step: 'queue.kind.ai_step',
};

const PROBLEM: Record<OpError, TranslationKey> = {
  offline: 'queue.error.offline', cloud_off: 'queue.error.cloud_off', not_configured: 'queue.error.not_configured',
  source_missing: 'queue.error.source_missing', invalid_result: 'queue.error.invalid_result', failed: 'queue.error.failed',
};

const SEND: Record<SendKind, TranslationKey> = {
  text: 'queue.sends.text', photos: 'queue.sends.photos', voice_text: 'queue.sends.voice_text', video_frames: 'queue.sends.video_frames',
  drawing: 'queue.sends.drawing', labels: 'queue.sends.labels', ai_input: 'queue.sends.ai_input', ai_photo: 'queue.sends.ai_photo',
};

export const titleKey = (kind: OpKind): TranslationKey => TITLE[kind];
export const describeSendKeys = (sends: readonly SendKind[]): TranslationKey[] => sends.map((s) => SEND[s]);

function detailFor(op: PendingOperation, online: boolean): Message {
  switch (op.status) {
    case 'waiting_for_network':
      // Online and still waiting means an attempt did not go through and the next one is paused.
      return online && op.retryCount > 0
        ? { key: 'queue.detail.retrySoon', params: { count: op.retryCount } }
        : { key: 'queue.detail.waitingOffline' };
    case 'ready':
      return { key: 'queue.detail.ready' };
    case 'processing':
      return { key: 'queue.detail.processing' };
    case 'cancelled':
      return { key: 'queue.detail.cancelled' };
    case 'failed':
      return { key: 'queue.detail.stopped', params: { count: op.retryCount } };
    case 'completed': {
      if (op.kind === 'compile') return { key: 'queue.detail.compileDone' };
      if (op.kind === 'ai_step') return { key: 'queue.detail.aiDone' };
      const missing = readTranslateResult(op)?.missing ?? 0;
      return missing > 0 ? { key: 'queue.detail.translateMissing', params: { count: missing } } : { key: 'queue.detail.translateDone' };
    }
  }
}

export function describeOperation(op: PendingOperation, online: boolean): OperationView {
  const active = isActive(op.status);
  return {
    title: TITLE[op.kind],
    status: `queue.status.${op.status}`,
    tone: TONE[op.status],
    detail: detailFor(op, online),
    ...(op.status === 'failed' && op.lastError ? { problem: PROBLEM[op.lastError] } : {}),
    sends: active ? describeSendKeys(op.sends) : [],
    canCancel: active,
    canRetry: op.status === 'failed',
    canRemove: !active,
    ...(op.status === 'completed' ? { open: op.kind === 'compile' ? ('review' as const) : ('app' as const) } : {}),
  };
}

export interface QueueSummary {
  active: number;
  failed: number;
  done: number;
}

export function summarize(ops: readonly PendingOperation[]): QueueSummary {
  return {
    active: ops.filter((o) => isActive(o.status)).length,
    failed: ops.filter((o) => o.status === 'failed').length,
    done: ops.filter((o) => o.status === 'completed').length,
  };
}

/** The one pill message for a summary, or undefined when there is nothing to show. */
export function pillMessage(s: QueueSummary): { key: TranslationKey; count: number; tone: Tone } | undefined {
  if (s.active > 0) return { key: 'queue.pill.active', count: s.active, tone: 'info' };
  if (s.failed > 0) return { key: 'queue.pill.failed', count: s.failed, tone: 'warning' };
  if (s.done > 0) return { key: 'queue.pill.done', count: s.done, tone: 'success' };
  return undefined;
}
