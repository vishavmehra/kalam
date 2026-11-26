/**
 * Queued-until-online operations (docs/09 §18, docs/00 §13.2, §19, docs/01 §7.3, docs/03 §21.4).
 *
 * Only work the person started and that is allowed to wait: building an app from a saved draft,
 * translating an app, running an AI step. Structural edits are NOT queued (ADR-025: offline they are
 * refused and the instruction stays in the edit box).
 *
 * A row holds references and small settings, never record values, never prompts. A build keeps a frozen
 * copy of the draft (`snapshot`) with its pictures in the local file store, owned by the operation id.
 * Nothing leaves the device unless the person queued it, and `sends` says in plain categories what it
 * will send, so the UI can show that before and after. Pure TypeScript.
 */
import { z } from 'zod';

export const OP_KINDS = ['compile', 'translate', 'ai_step'] as const;
export type OpKind = (typeof OP_KINDS)[number];

/** docs/09 §18.2 statuses, plus `cancelled` so a cancelled row can be shown and then dismissed. */
export const OP_STATUSES = ['waiting_for_network', 'ready', 'processing', 'failed', 'completed', 'cancelled'] as const;
export type OpStatus = (typeof OP_STATUSES)[number];

const ACTIVE: readonly OpStatus[] = ['waiting_for_network', 'ready', 'processing'];
export const isActive = (status: OpStatus): boolean => ACTIVE.includes(status);

/** Why an operation stopped. Codes only: the words come from the i18n catalogue (`queue.error.*`). */
export const OP_ERRORS = ['offline', 'cloud_off', 'not_configured', 'source_missing', 'invalid_result', 'failed'] as const;
export type OpError = (typeof OP_ERRORS)[number];

/** What an operation sends off the device, by category (never the content itself). */
export const SEND_KINDS = ['text', 'photos', 'voice_text', 'video_frames', 'drawing', 'labels', 'ai_input', 'ai_photo'] as const;
export type SendKind = (typeof SEND_KINDS)[number];

/** Largest snapshot or result kept in one row, in characters. */
export const MAX_PAYLOAD_CHARS = 400_000;
/** Operations waiting or running at once. Past this, the person is asked to cancel one first. */
export const MAX_ACTIVE_OPS = 20;
/** Failed attempts, after which the operation stops retrying by itself and asks the person. */
export const MAX_ATTEMPTS = 4;
/** Finished rows (and their files) are removed after this long. */
export const ENDED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const pendingOpSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  kind: z.enum(OP_KINDS),
  status: z.enum(OP_STATUSES),
  /** What it works on: its own id (build), an app id (translate, AI step). */
  payloadRef: z.string().min(1).max(256),
  /** Owning app, so deleting the app removes its queued work. */
  appId: z.string().min(1).max(200).optional(),
  /** Same key while one is active means the same operation: a second tap does not queue it twice. */
  dedupeKey: z.string().min(1).max(80),
  sends: z.array(z.enum(SEND_KINDS)).max(SEND_KINDS.length),
  /** Small settings only (language code, block id). No record values, no prompts. */
  params: z.record(z.string().min(1).max(40), z.union([z.string().max(100), z.number(), z.boolean()]))
    .refine((o) => Object.keys(o).length <= 8),
  /** Kind-specific input, as JSON text. Removed once the operation no longer needs it. */
  snapshot: z.string().max(MAX_PAYLOAD_CHARS).optional(),
  /** Kind-specific output, as JSON text. */
  result: z.string().max(MAX_PAYLOAD_CHARS).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** Failed attempts so far. */
  retryCount: z.number().int().min(0).max(1000),
  /** Earliest time of the next automatic attempt; a return to online skips the wait. */
  nextAttemptAt: z.number().int().nonnegative().optional(),
  lastError: z.enum(OP_ERRORS).optional(),
});
export type PendingOperation = z.infer<typeof pendingOpSchema>;

export interface NewOperation {
  /** Given when files were already stored under this id (a build's pictures). */
  id?: string;
  kind: OpKind;
  payloadRef: string;
  appId?: string;
  dedupeKey: string;
  sends: SendKind[];
  params?: PendingOperation['params'];
  snapshot?: string;
}

/** One row if it passes validation, otherwise undefined. A row from a bug or a newer build is never trusted. */
export function parsePendingOp(row: unknown): PendingOperation | undefined {
  const parsed = pendingOpSchema.safeParse(row);
  return parsed.success ? parsed.data : undefined;
}

export class QueueError extends Error {
  constructor(readonly code: 'queue_full' | 'invalid_operation' | 'not_found' | 'wrong_state') {
    super(code);
    this.name = 'QueueError';
  }
}
