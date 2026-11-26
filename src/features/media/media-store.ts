/**
 * The media session store (docs/06 §3-4): typed attachments with their own status, frames with
 * timestamps, transcripts, the video workflow, conflicts and the session state machine. It shares its
 * id with the creation draft (state/creation-store) and is saved into the same local row, so it
 * survives a reload and an app restart. Local only: nothing here is uploaded.
 */
import { create } from 'zustand';
import './words'; // the media copy speaks the interface language from here on
import type { SessionEvent } from '@/core/session/machine';
import {
  applyEvent, createSession, hasInputs, newMediaId, ownedAssetIds, type MediaSession,
} from '@/core/session/session';
import { getDatabase } from '@/infrastructure/storage/database';
import { assetId, discardMediaSession, loadMediaSession, removeAssets, saveMediaSession } from '@/infrastructure/storage/media-sessions';

interface MediaState {
  session?: MediaSession;
  hydrated: boolean;
  /** A stored session was brought back on start (for the "your session is back" note). */
  restored?: boolean;
}

export const useMediaStore = create<MediaState>()(() => ({ hydrated: false }));

const WRITE_DELAY_MS = 300;
let timer: ReturnType<typeof setTimeout> | undefined;
let chain: Promise<void> = Promise.resolve();
/** Id the creation draft uses, when it was created there first. */
let boundId: string | undefined;

function enqueue(task: () => Promise<void>): Promise<void> {
  chain = chain.then(task).catch((error: unknown) => console.warn('[kalam/media] session not saved', error instanceof Error ? error.name : 'error'));
  return chain;
}

/** Writes the current session now (also called by the debounce). */
export function flushMediaSession(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const s = useMediaStore.getState().session;
  // Skipped when the session was reset meanwhile, so a late write never brings a deleted draft back.
  return s ? enqueue(async () => {
    if (useMediaStore.getState().session?.id === s.id) await saveMediaSession(getDatabase(), useMediaStore.getState().session!);
  }) : chain;
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushMediaSession(), WRITE_DELAY_MS);
}

/** The shared session id. Creates the media session on first use. */
export function mediaSessionId(): string {
  return ensureSession().id;
}

export function ensureSession(): MediaSession {
  const current = useMediaStore.getState().session;
  if (current) return current;
  const s = createSession(boundId ?? newMediaId('s'), Date.now());
  useMediaStore.setState({ session: s });
  return s;
}

/** Applies a change and saves it shortly after. */
export function updateSession(fn: (s: MediaSession) => MediaSession): MediaSession {
  const before = ensureSession();
  const after = fn(before);
  if (after !== before) {
    useMediaStore.setState({ session: after });
    schedule();
  }
  return after;
}

/** A session event from outside the media inputs (build started, finished, cancelled, saved). */
export function mediaEvent(event: SessionEvent): void {
  if (!useMediaStore.getState().session && event !== 'compile_started') return;
  updateSession((s) => applyEvent(s, event, Date.now()));
}

export const mediaHasInputs = () => {
  const s = useMediaStore.getState().session;
  return !!s && hasInputs(s);
};

/**
 * Loads the media session stored with creation session `id` (the draft's row), or the latest one.
 * Called once on start and again when the creation draft restores its row.
 */
export async function hydrateMediaSession(id?: string): Promise<void> {
  if (id) boundId = id;
  try {
    const stored = await loadMediaSession(getDatabase(), id);
    const current = useMediaStore.getState().session;
    // Never replace a session the person is already working in.
    const idle = !current || !hasInputs(current);
    if (stored && idle) {
      useMediaStore.setState({ session: stored, hydrated: true, restored: stored.attachments.length > 0 });
      return;
    }
    // An empty in-memory session under another id would split the draft into two rows.
    if (id && current && current.id !== id && idle) useMediaStore.setState({ session: undefined });
  } catch (error) {
    console.warn('[kalam/media] session could not be restored', error instanceof Error ? error.name : 'error');
  }
  useMediaStore.setState({ hydrated: true });
}

// ─── Work on one attachment ──────────────────────────────────────────────────
const jobs = new Map<string, AbortController>();

/** A cancel signal for work on attachment `id` (also aborted by `parent`). Removing the attachment aborts it. */
export function startJob(id: string, parent?: AbortSignal): AbortSignal {
  const ac = new AbortController();
  if (parent?.aborted) ac.abort();
  else parent?.addEventListener('abort', () => ac.abort(), { once: true });
  jobs.set(id, ac);
  return ac.signal;
}
export const endJob = (id: string) => void jobs.delete(id);
export function abortJob(id: string): void {
  jobs.get(id)?.abort();
  jobs.delete(id);
}
/** The attachment is still in the session (it may have been removed while its work was running). */
export const isAttached = (id: string) => !!useMediaStore.getState().session?.attachments.some((a) => a.id === id);

const resetHooks = new Set<() => void>();
/** Runs before the session is cleared (releases temporary recordings and video copies). */
export function onMediaReset(fn: () => void): void {
  resetHooks.add(fn);
}

/**
 * Starts over: running work stops, temporary files are released, and the session's stored files and
 * row go too. The row is deleted here because a media-only session (an audio file, a failed file)
 * never writes the creation draft, so the draft's own reset would not find it.
 */
export function resetMediaSession(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = undefined;
  for (const id of [...jobs.keys()]) abortJob(id);
  resetHooks.forEach((fn) => fn());
  const s = useMediaStore.getState().session;
  boundId = undefined;
  useMediaStore.setState({ session: undefined, restored: false });
  if (!s) return chain;
  const owned = s.attachments.flatMap(ownedAssetIds);
  return enqueue(() => discardMediaSession(getDatabase(), s.id, owned));
}

/**
 * ADR-005 "keep the photos with the app": originals and thumbnails move to `appId` (still local only).
 * Call before the creation draft deletes the session.
 */
export function adoptMediaAssets(appId: string): Promise<void> {
  const s = useMediaStore.getState().session;
  if (!s) return chain;
  const ids = s.attachments.flatMap(ownedAssetIds);
  return enqueue(async () => {
    const db = getDatabase();
    for (const id of ids) {
      const blob = await db.blobs.get(id);
      if (blob) await db.blobs.put({ id: blob.id, kind: blob.kind, mimeType: blob.mimeType, base64: blob.base64, ownerId: appId });
    }
  });
}

/** Deletes stored files no longer referenced by the session. */
export function dropAssets(ids: readonly string[]): Promise<void> {
  if (!ids.length) return chain;
  return enqueue(() => removeAssets(getDatabase(), ids));
}

export { assetId };
