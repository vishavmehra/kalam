/**
 * What the create screen needs from the media session (mount lines in the P1-1 report):
 *  - an attached recording's text, or a described file, is enough to build (docs/01 scenario C),
 *  - the build input carries the session's notes, answers, video steps and recordings,
 *  - anything that does not fit (pictures over the budget, notes over the text limit) is named
 *    before building, never dropped silently (docs/06 §12.5, §13.3).
 */
import type { NormalizedInput } from '@/core/contracts';
import { timings } from '@/core/observability';
import { imageBudget, prepareHandoff, sessionAddsInput, type SessionHandoff } from '@/core/session/handoff';
import type { MediaSession } from '@/core/session/session';
import { buildNormalizedInput, draftBlocker, draftBlockerKey, draftModalities, type CreationDraft } from '@/features/input/normalize';
import { selectDraft, useCreationStore } from '@/state/creation-store';
import { useMediaStore } from './media-store';

/** Like `draftBlocker`, but the media session's own inputs count too. */
export function createBlocker(draft: CreationDraft, session: MediaSession | undefined = useMediaStore.getState().session): string | undefined {
  const blocker = draftBlocker(draft);
  if (!blocker || draftModalities(draft).length) return blocker;
  return session && sessionAddsInput(session) ? undefined : blocker;
}

/** Like `draftBlockerKey` (translated by the screen), with the media session's own inputs counted too. */
export function createBlockerKey(draft: CreationDraft, session: MediaSession | undefined = useMediaStore.getState().session): ReturnType<typeof draftBlockerKey> {
  const key = draftBlockerKey(draft);
  return key === 'create.ws.blockEmpty' && session && sessionAddsInput(session) ? undefined : key;
}

function assemble(draft: CreationDraft, session: MediaSession | undefined): SessionHandoff {
  const input: NormalizedInput = buildNormalizedInput(draft);
  if (session) return prepareHandoff(input, session);
  const notice = imageBudget(input).notice;
  return { input, notices: notice ? [notice] : [] };
}

/**
 * The NormalizedInput for one build, with the session applied, and the notices to show. Timed as
 * `context_assemble` (docs/06 §17.3). The notice selector below calls `assemble` directly: a selector
 * runs on every keystroke and must not write to the timing log while React renders.
 */
export function prepareCreation(draft: CreationDraft, session: MediaSession | undefined = useMediaStore.getState().session): SessionHandoff {
  return timings.time('context_assemble', () => assemble(draft, session));
}

/**
 * The draft with the media session folded in (notes, answers to Kalam's questions, spoken text of attached
 * recordings, labelled video frames and the video steps). A build queued while offline keeps a draft, not a
 * session, so this is what it must freeze to build the same app later as "Create app" would now.
 */
export function draftWithSession(draft: CreationDraft, session: MediaSession | undefined = useMediaStore.getState().session): CreationDraft {
  if (!session) return draft;
  const { input } = prepareHandoff(buildNormalizedInput(draft), session);
  const spoken = input.audioTranscript?.trim();
  const voice: CreationDraft['voice'] = spoken
    ? { transcript: spoken, recognizedBy: draft.voice?.recognizedBy ?? 'typed', ...(draft.voice?.durationSec !== undefined ? { durationSec: draft.voice.durationSec } : {}) }
    : draft.voice;
  const video: CreationDraft['video'] = draft.video && input.video
    ? { ...draft.video, frames: input.video.frames, ...(input.video.summary ? { summary: input.video.summary } : {}) }
    : draft.video;
  return { ...draft, text: input.text, ...(voice ? { voice } : {}), ...(video ? { video } : {}) };
}

/** Create button blocker for the screen; re-renders when either store changes. */
export function useCreateBlocker(): string | undefined {
  const session = useMediaStore((m) => m.session);
  return useCreationStore((s) => createBlocker(selectDraft(s), session));
}

/** Same as `useCreateBlocker`, as a translation key. */
export function useCreateBlockerKey(): ReturnType<typeof draftBlockerKey> {
  const session = useMediaStore((m) => m.session);
  return useCreationStore((s) => createBlockerKey(selectDraft(s), session));
}

/** What would be left out if the person built now, as one sentence block, or undefined. */
export function useHandoffNotice(): string | undefined {
  const session = useMediaStore((m) => m.session);
  return useCreationStore((s) => assemble(selectDraft(s), session).notices.join(' ') || undefined);
}
