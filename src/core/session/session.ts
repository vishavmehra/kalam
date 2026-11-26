/**
 * The recoverable creation session (docs/06 §3-4, §12): stable ids, typed attachments with their own
 * status, derived artifacts with provenance, text items with roles, video workflows and conflicts.
 * Immutable updates only. Stored inside the session row (`draft.media`) by infrastructure/storage.
 */
import { z } from 'zod';
import { mediaErrorMessage } from '@/core/media/copy';
import { findDuplicate } from '@/core/media/hash';
import { isTypedItem, roleOf, splitInstructions } from '@/core/media/text';
import {
  audioTranscriptSchema, contextConflictSchema, derivedArtifactSchema, mediaAttachmentSchema, textInputSchema,
  videoFrameSchema, workflowSchema, type AudioTranscript, type ContextConflict, type DerivedArtifact, type MediaAttachment,
  type TextInputItem, type VideoFrameArtifact, type WorkflowSummary,
} from '@/core/media/types';
import { isBusy, nextStatus, recoverStatus, SESSION_STATUSES, type SessionEvent } from './machine';

export const MEDIA_SESSION_VERSION = 1;
export const MAX_ATTACHMENTS = 16;
export const PROCESSOR_VERSION = 'media-v1';

export const mediaSessionSchema = z.object({
  v: z.literal(MEDIA_SESSION_VERSION),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  status: z.enum(SESSION_STATUSES),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  textInputs: z.array(textInputSchema).max(64),
  attachments: z.array(mediaAttachmentSchema).max(MAX_ATTACHMENTS),
  frames: z.array(videoFrameSchema).max(64),
  transcripts: z.array(audioTranscriptSchema).max(MAX_ATTACHMENTS),
  workflows: z.array(workflowSchema).max(MAX_ATTACHMENTS),
  derived: z.array(derivedArtifactSchema).max(128),
  conflicts: z.array(contextConflictSchema).max(8),
});
export type MediaSession = z.infer<typeof mediaSessionSchema>;

/** Random id with a prefix, e.g. `att_m1x2_9f3a…`. */
export function newMediaId(prefix: string): string {
  const bytes = new Uint8Array(6);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `${prefix}_${Date.now().toString(36)}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function createSession(id: string, now: number): MediaSession {
  return {
    v: MEDIA_SESSION_VERSION, id, status: 'draft', createdAt: now, updatedAt: now,
    textInputs: [], attachments: [], frames: [], transcripts: [], workflows: [], derived: [], conflicts: [],
  };
}

/** Applies an event; an event that is not allowed leaves the status as it is. */
export function applyEvent(s: MediaSession, event: SessionEvent, now: number): MediaSession {
  const status = nextStatus(s.status, event);
  return status && status !== s.status ? { ...s, status, updatedAt: now } : s;
}

/** Files, answers and notes. Typed instructions are not counted: that text already lives in the creation draft. */
export const hasInputs = (s: MediaSession) => s.attachments.length > 0 || s.textInputs.some((t) => t.text.trim() && !isTypedItem(t));

/** After attachment changes: busy while any file is being worked on, failed when one failed. */
function settle(s: MediaSession, now: number): MediaSession {
  const working = s.attachments.some((a) => a.status === 'validating' || a.status === 'processing_local' || a.status === 'preparing_cloud');
  if (working) return applyEvent(s, 'processing_started', now);
  if (s.attachments.some((a) => a.status === 'failed')) return applyEvent(applyEvent(s, 'processing_finished', now), 'attachment_failed', now);
  if (s.status === 'preprocessing' || s.status === 'attachment_failed') return applyEvent(s, 'processing_finished', now);
  return s;
}

export type AddResult = { session: MediaSession; added: true } | { session: MediaSession; added: false; duplicateOf?: MediaAttachment; full?: true };

/** Adds an attachment unless its content is already in the session (docs/06 §18.7). */
export function addAttachment(s: MediaSession, att: MediaAttachment, now: number): AddResult {
  const dup = att.contentHash ? findDuplicate(att.contentHash, s.attachments) : undefined;
  if (dup) return { session: s, added: false, duplicateOf: dup };
  if (s.attachments.length >= MAX_ATTACHMENTS) return { session: s, added: false, full: true };
  const next = applyEvent({ ...s, attachments: [...s.attachments, att], updatedAt: now }, 'input_added', now);
  return { session: settle(next, now), added: true };
}

export function updateAttachment(s: MediaSession, id: string, patch: Partial<Omit<MediaAttachment, 'id' | 'createdAt'>>, now: number): MediaSession {
  if (!s.attachments.some((a) => a.id === id)) return s;
  const attachments = s.attachments.map((a) => {
    if (a.id !== id) return a;
    const next = { ...a, ...patch, updatedAt: now };
    if (patch.status && patch.status !== 'failed' && !('error' in patch)) delete next.error;
    return next;
  });
  return settle({ ...s, attachments, updatedAt: now }, now);
}

/** Blob ids an attachment owns (original, preview). Frames and the prepared copy belong to the draft. */
export const ownedAssetIds = (a: MediaAttachment) => [a.originalAssetId, a.previewAssetId].filter((x): x is string => !!x);

function dropDerived(s: MediaSession, attachmentId: string): MediaSession {
  return {
    ...s,
    frames: s.frames.filter((f) => f.attachmentId !== attachmentId),
    transcripts: s.transcripts.filter((t) => t.attachmentId !== attachmentId),
    workflows: s.workflows.filter((w) => w.attachmentId !== attachmentId),
    derived: s.derived.filter((d) => !d.sourceAttachmentIds.includes(attachmentId)),
    textInputs: s.textInputs.filter((t) => t.sourceAttachmentId !== attachmentId),
  };
}

export interface RemoveResult { session: MediaSession; removedAssetIds: string[]; removed?: MediaAttachment }

/** Removes one attachment and everything derived from it. Other inputs are untouched. */
export function removeAttachment(s: MediaSession, id: string, now: number): RemoveResult {
  const removed = s.attachments.find((a) => a.id === id);
  if (!removed) return { session: s, removedAssetIds: [] };
  const next = dropDerived({ ...s, attachments: s.attachments.filter((a) => a.id !== id), updatedAt: now }, id);
  const settled = settle(applyEvent(next, hasInputs(next) ? 'input_removed' : 'all_removed', now), now);
  return { session: settled, removedAssetIds: ownedAssetIds(removed), removed };
}

/** Replaces an attachment in place (same list position); the old one's derived data goes with it. */
export function replaceAttachment(s: MediaSession, oldId: string, next: MediaAttachment, now: number): RemoveResult & { duplicateOf?: MediaAttachment } {
  const index = s.attachments.findIndex((a) => a.id === oldId);
  if (index < 0) return { session: s, removedAssetIds: [] };
  const dup = next.contentHash ? findDuplicate(next.contentHash, s.attachments, oldId) : undefined;
  if (dup) return { session: s, removedAssetIds: [], duplicateOf: dup };
  const removed = s.attachments[index]!;
  const attachments = [...s.attachments];
  attachments[index] = next;
  const replaced = dropDerived({ ...s, attachments, updatedAt: now }, oldId);
  return { session: settle(applyEvent(replaced, 'input_added', now), now), removedAssetIds: ownedAssetIds(removed), removed };
}

export function setNote(s: MediaSession, id: string, note: string, now: number): MediaSession {
  const clean = note.slice(0, 1000);
  return updateAttachment(s, id, clean.trim() ? { note: clean } : { note: undefined }, now);
}

function derive(s: MediaSession, type: DerivedArtifact['artifactType'], attachmentId: string, now: number): DerivedArtifact[] {
  const id = `${attachmentId}.${type}`;
  return [...s.derived.filter((d) => d.id !== id), { id, sourceAttachmentIds: [attachmentId], artifactType: type, createdAt: now, processorVersion: PROCESSOR_VERSION }];
}

/** Derived data only joins an attachment that is still in the session (a removed one may still be finishing). */
const has = (s: MediaSession, attachmentId: string) => s.attachments.some((a) => a.id === attachmentId);

export function setFrames(s: MediaSession, attachmentId: string, frames: VideoFrameArtifact[], now: number): MediaSession {
  if (!has(s, attachmentId)) return s;
  return {
    ...s,
    frames: [...s.frames.filter((f) => f.attachmentId !== attachmentId), ...frames.filter((f) => f.attachmentId === attachmentId)].slice(0, 64),
    derived: frames.length ? derive(s, 'frame', attachmentId, now) : s.derived,
    updatedAt: now,
  };
}

export const framesOf = (s: MediaSession, attachmentId: string) =>
  s.frames.filter((f) => f.attachmentId === attachmentId).sort((a, b) => a.timestampMs - b.timestampMs);

export function setTranscript(s: MediaSession, t: AudioTranscript, now: number): MediaSession {
  if (!has(s, t.attachmentId)) return s;
  return {
    ...s,
    transcripts: [...s.transcripts.filter((x) => x.attachmentId !== t.attachmentId), t],
    derived: derive(s, 'transcript', t.attachmentId, now),
    updatedAt: now,
  };
}

export const transcriptOf = (s: MediaSession, attachmentId: string) => s.transcripts.find((t) => t.attachmentId === attachmentId);

export function setWorkflow(s: MediaSession, w: WorkflowSummary, now: number): MediaSession {
  if (!has(s, w.attachmentId)) return s;
  return {
    ...s,
    workflows: [...s.workflows.filter((x) => x.attachmentId !== w.attachmentId), w],
    derived: derive(s, 'summary', w.attachmentId, now),
    updatedAt: now,
  };
}

export const workflowOf = (s: MediaSession, attachmentId: string) => s.workflows.find((w) => w.attachmentId === attachmentId);

export function setThumbnail(s: MediaSession, attachmentId: string, previewAssetId: string, now: number): MediaSession {
  const next = updateAttachment(s, attachmentId, { previewAssetId }, now);
  return next === s ? s : { ...next, derived: derive(next, 'thumbnail', attachmentId, now) };
}

/** A new text item; earlier items are never changed (docs/06 §6.4). */
export function addTextInput(
  s: MediaSession, text: string, role: TextInputItem['role'], now: number,
  link: { sourceAttachmentId?: string; conflictId?: string } = {},
): MediaSession {
  const clean = text.trim().slice(0, 8000);
  if (!clean) return s;
  // An answer to a conflict replaces the earlier answer to the same conflict.
  const kept = link.conflictId ? s.textInputs.filter((t) => t.conflictId !== link.conflictId) : s.textInputs;
  const item: TextInputItem = { id: newMediaId('txt'), text: clean, role, createdAt: now, ...link };
  return applyEvent({ ...s, textInputs: [...kept, item].slice(-64), updatedAt: now }, 'input_added', now);
}

/**
 * Keeps the typed description as separate instructions with roles and times (docs/06 §6.3). Never changes
 * the text, only reads it. An instruction with the same words keeps its item and its time; one edited in
 * place keeps its item and gets an `updatedAt`; new ones get `now`; deleted ones go. Answers and notes are
 * left as they are. Returns the same session when nothing changed, so typing does not rewrite it.
 */
export function syncTypedText(s: MediaSession, text: string, now: number): MediaSession {
  const next = splitInstructions(text);
  const old = s.textInputs.filter(isTypedItem);
  const free = new Set(old);
  const same = next.map((p) => {
    const hit = old.find((o) => free.has(o) && o.text === p);
    if (hit) free.delete(hit);
    return hit;
  });
  const items = next.map((p, i): TextInputItem => {
    const role = roleOf(p, i);
    const kept = same[i];
    if (kept) return kept.role === role ? kept : { ...kept, role };
    const edited = old[i];
    if (edited && free.has(edited)) {
      free.delete(edited);
      return { ...edited, text: p, role, updatedAt: now };
    }
    return { id: newMediaId('txt'), text: p, role, createdAt: now };
  });
  if (items.length === old.length && items.every((x, i) => x === old[i])) return s;
  const others = s.textInputs.filter((t) => !isTypedItem(t));
  return { ...s, textInputs: [...items, ...others].slice(0, 64), updatedAt: now };
}

/**
 * Replaces the conflict list. An answer lives only as long as its conflict stays resolved with the
 * same observations: when the conflict goes away or comes back with new inputs, its answer goes too,
 * so the compiler never gets an answer to a question that no longer stands.
 */
export function setConflicts(s: MediaSession, conflicts: ContextConflict[], now: number): MediaSession {
  const kept = conflicts.slice(0, 8);
  const answered = new Set(kept.filter((c) => c.resolution === 'resolved').map((c) => c.id));
  const textInputs = s.textInputs.filter((t) => !t.conflictId || answered.has(t.conflictId));
  return { ...s, conflicts: kept, textInputs, updatedAt: now };
}

const failedWith = (a: MediaAttachment, code: 'PROCESSING_INTERRUPTED' | 'ATTACHMENT_MISSING', now: number): MediaAttachment => ({
  ...a, status: 'failed', error: { code, message: mediaErrorMessage(code, { type: a.type }) }, updatedAt: now,
});

/**
 * Validated session from storage. Files that were being worked on when Kalam closed are marked as
 * failed with a "replace or remove" message (docs/06 §3.3), so nothing waits forever.
 */
export function parseSession(raw: unknown, now = Date.now()): MediaSession | undefined {
  const r = mediaSessionSchema.safeParse(raw);
  if (!r.success) return undefined;
  const s = r.data;
  const attachments = s.attachments.map((a) => (isBusyAttachment(a) || a.status === 'pending' ? failedWith(a, 'PROCESSING_INTERRUPTED', now) : a));
  return settle({ ...s, attachments, status: recoverStatus(s.status) }, now);
}

/**
 * After a restart: pictures and video frames the creation draft could not bring back are marked
 * missing, so the person sees which files to replace. Returns how many were missing.
 */
export function reconcileWithDraft(
  s: MediaSession, draft: { photoIds: ReadonlySet<string>; frameIds: ReadonlySet<string> }, now: number,
): { session: MediaSession; missing: number } {
  let missing = 0;
  const attachments = s.attachments.map((a) => {
    if (a.status === 'failed') return a;
    const lost = a.type === 'image'
      ? !!a.preparedImageId && !draft.photoIds.has(a.preparedImageId)
      : a.type === 'video' && s.frames.some((f) => f.attachmentId === a.id) && !s.frames.some((f) => f.attachmentId === a.id && draft.frameIds.has(f.assetId));
    if (!lost) return a;
    missing++;
    return failedWith(a, 'ATTACHMENT_MISSING', now);
  });
  return missing ? { session: settle({ ...s, attachments, updatedAt: now }, now), missing } : { session: s, missing };
}

const isBusyAttachment = (a: MediaAttachment) => a.status === 'validating' || a.status === 'processing_local' || a.status === 'preparing_cloud';

export { isBusy };
