/**
 * Video into the session (docs/06 §9, docs/14 §5): signature, size and duration checks, keyframes
 * with their real timestamps, the sound turned into text where the platform can (iOS, with the same
 * speech rules as dictation), and a deterministic workflow draft the person reviews before building.
 * Describing the steps with Firebase cloud AI is a separate, explicit action through the central
 * orchestrator, and never replaces steps the person edited or checked.
 */
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { attachmentCopy, workflowCopy } from '@/core/media/copy';
import { isMediaError, MediaError, toMediaError } from '@/core/media/errors';
import { candidateTimesSec, frameArtifacts, resolveFrameTimes } from '@/core/media/frames';
import { identifyLanguage } from '@/core/media/language';
import { DEFAULT_MEDIA_LIMITS } from '@/core/media/limits';
import { createTranscript } from '@/core/media/transcript';
import type { MediaAttachment, WorkflowSummary } from '@/core/media/types';
import { describeWorkflow, draftWorkflow } from '@/core/media/workflow';
import { timings } from '@/core/observability';
import {
  addAttachment, framesOf, newMediaId, removeAttachment, setFrames, setTranscript, setWorkflow, transcriptOf, updateAttachment, workflowOf,
} from '@/core/session/session';
import { fileExists, isDurableUri } from '@/infrastructure/media/file-bytes';
import { inspectMedia } from '@/infrastructure/media/inspect';
import { pickVideo } from '@/infrastructure/media/pick';
import type { MediaSource } from '@/infrastructure/media/source';
import { canTranscribeFiles, transcribeFile } from '@/infrastructure/media/transcribe-file';
import { extractKeyframes } from '@/infrastructure/platform/media';
import { discardRecording } from '@/infrastructure/platform/media-audio';
import { getServices } from '@/services';
import { useCreationStore } from '@/state/creation-store';
import { useSettingsStore } from '@/state/settings-store';
import { speechPolicy } from './audio-intake';
import { abortJob, dropAssets, endJob, ensureSession, isAttached, onMediaReset, startJob, updateSession, useMediaStore } from './media-store';

const now = () => Date.now();
const LIMITS = DEFAULT_MEDIA_LIMITS.video;

/** Playable uris for this app run (web object URLs die on reload; Android and iOS keep `localUri`). */
const liveUris = new Map<string, string>();
export function playableVideoUri(a: MediaAttachment): string | undefined {
  return liveUris.get(a.id) ?? (a.localUri && fileExists(a.localUri) ? a.localUri : undefined);
}

/** Frees the picker's temporary copy (Android, iOS) or object URL (web). The person's own file stays. */
export function releaseVideo(a: MediaAttachment): void {
  const uri = liveUris.get(a.id) ?? a.localUri;
  liveUris.delete(a.id);
  if (uri) void discardRecording(uri);
}

onMediaReset(() => {
  for (const a of useMediaStore.getState().session?.attachments.filter((x) => x.type === 'video') ?? []) releaseVideo(a);
  liveUris.clear();
});

function dropVideo(a: MediaAttachment): void {
  abortJob(a.id);
  releaseVideo(a);
  let removed: string[] = [];
  updateSession((x) => {
    const r = removeAttachment(x, a.id, now());
    removed = r.removedAssetIds;
    return r.session;
  });
  void dropAssets(removed);
}

/** The person edited or checked the steps: AI must not replace them. */
export const workflowLocked = (w?: WorkflowSummary) => !!w && (w.reviewed || w.source === 'person');

/**
 * One video per session (the creation draft holds one). A new video is read next to the old one and
 * replaces it only once its frames are in, so a bad or cancelled file never costs the old video, its
 * note or its reviewed steps (docs/06 §3.5, §14.1).
 */
async function ingest(src: MediaSource, batch: AbortSignal): Promise<string | undefined> {
  ensureSession();
  const previous = useMediaStore.getState().session?.attachments.filter((x) => x.type === 'video') ?? [];
  const id = newMediaId('att');
  const signal = startJob(id, batch);
  const row: MediaAttachment = {
    id, type: 'video', mimeType: 'application/octet-stream', sizeBytes: src.sizeBytes ?? 0, status: 'validating', createdAt: now(), updatedAt: now(),
  };
  updateSession((s) => addAttachment(s, row, now()).session);
  let committed = false;
  const alive = () => {
    if (signal.aborted || !isAttached(id)) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
  };
  try {
    const info = await inspectMedia(src, 'video', attachmentCopy.videoName(1));
    alive();
    liveUris.set(id, src.uri);
    updateSession((s) => updateAttachment(s, id, {
      mimeType: info.mimeType, sizeBytes: info.sizeBytes, contentHash: info.contentHash, status: 'processing_local',
      ...(info.name ? { name: info.name } : {}),
      ...(src.width && src.height ? { width: Math.round(src.width), height: Math.round(src.height) } : {}),
      ...(src.durationSec ? { durationMs: Math.round(src.durationSec * 1000) } : {}),
      ...(isDurableUri(src.uri) ? { localUri: src.uri } : {}),
    }, now()));

    let res: Awaited<ReturnType<typeof extractKeyframes>>;
    try {
      res = await timings.time('video_frames', () => extractKeyframes(src.uri, { ...(src.durationSec ? { durationSec: src.durationSec } : {}), signal }));
    } catch (e) {
      if (signal.aborted) throw e;
      const long = e instanceof Error && typeof (e as { durationSec?: unknown }).durationSec === 'number' ? (e as unknown as { durationSec: number }).durationSec : undefined;
      throw long !== undefined
        ? new MediaError('FILE_TOO_LARGE', { type: 'video', durationSec: long, limitSec: LIMITS.maxDurationSec })
        : new MediaError('VIDEO_EXTRACTION_FAILED');
    }
    alive();
    if (!res.frames.length) throw new MediaError('VIDEO_EXTRACTION_FAILED');
    const durationSec = res.durationSec || src.durationSec || 0;
    const times = resolveFrameTimes(res.frames.map((f) => f.label), candidateTimesSec(Platform.OS === 'web' ? res.durationSec : src.durationSec ?? 0, LIMITS.maxFrames));
    const artifacts = frameArtifacts(id, res.frames, times);

    // Commit: the new frames take the draft's place and the old video goes, with no await in between.
    useCreationStore.getState().setVideo({
      ...(info.name ? { name: info.name } : {}), durationSec, frames: res.frames, droppedFrames: res.dropped,
    });
    updateSession((s) => setFrames(updateAttachment(s, id, { durationMs: Math.round(durationSec * 1000) }, now()), id, artifacts, now()));
    previous.forEach(dropVideo);
    committed = true;

    // The sound track: read on iOS only; elsewhere the pictures carry the video (docs/06 §9.6).
    let note: string | undefined;
    let segments: NonNullable<ReturnType<typeof createTranscript>['segments']> = [];
    if (canTranscribeFiles(true)) {
      const settings = useSettingsStore.getState().settings;
      const lang = settings.speech?.sttLanguage ?? useCreationStore.getState().preferences.language;
      const heard = await timings.time('audio_transcribe', () => transcribeFile({ uri: src.uri, lang, head: info.head, policy: speechPolicy(), isVideo: true, signal }), (h) => h.ok);
      if (heard.ok) {
        segments = heard.segments;
        const language = identifyLanguage(heard.text, { preferred: lang, ...(heard.language ? { service: heard.language } : {}) });
        updateSession((s) => setTranscript(updateAttachment(s, id, { hasAudio: true }, now()), createTranscript(id, heard.text, {
          source: heard.location === 'on_device' ? 'device' : 'cloud', segments: heard.segments, partial: heard.partial, ...(language ? { language } : {}),
        }), now()));
      } else if (heard.reason !== 'cancelled') {
        note = heard.reason === 'needs_consent' || heard.reason === 'blocked' ? workflowCopy.noSpeech : heard.message;
      }
    }
    alive();
    updateSession((s) => setWorkflow(updateAttachment(s, id, { status: 'ready' }, now()), draftWorkflow(id, artifacts, now(), segments), now()));
    return note;
  } catch (e) {
    if (signal.aborted || (e instanceof Error && e.name === 'AbortError')) {
      const a = useMediaStore.getState().session?.attachments.find((x) => x.id === id);
      if (a) dropVideo(a);
      else releaseVideo(row);
      if (committed) useCreationStore.getState().setVideo(undefined);
      return undefined;
    }
    const err = isMediaError(e) ? e : toMediaError(e, 'VIDEO_DECODE_FAILED');
    // Replacing: the old video stays as it was; the message says why the new one was not used.
    if (previous.length && !committed) {
      dropVideo(row);
      return err.message;
    }
    updateSession((s) => updateAttachment(s, id, { status: 'failed', error: err.toJSON() }, now()));
    return err.message;
  } finally {
    endJob(id);
  }
}

export function useVideoIntake() {
  const [busy, setBusy] = useState<'reading' | 'describing' | undefined>();
  const [message, setMessage] = useState<string>();
  const abort = useRef<AbortController | undefined>(undefined);

  const add = useCallback(async (from: 'camera' | 'library') => {
    setMessage(undefined);
    let src: MediaSource | undefined;
    try {
      src = await pickVideo(from, LIMITS.maxDurationSec);
    } catch (e) {
      return setMessage(toMediaError(e, 'VIDEO_DECODE_FAILED').message);
    }
    if (!src) return;
    const ac = new AbortController();
    abort.current = ac;
    setBusy('reading');
    try {
      setMessage(await timings.time('attachment_intake', () => ingest(src, ac.signal)));
    } finally {
      setBusy(undefined);
      if (abort.current === ac) abort.current = undefined;
    }
  }, []);

  /** Explicit action: up to six frames go to Firebase cloud AI through the orchestrator. */
  const describeWithAI = useCallback(async (attachmentId: string) => {
    const s = useMediaStore.getState().session;
    const att = s?.attachments.find((a) => a.id === attachmentId);
    const draftFrames = useCreationStore.getState().video?.frames ?? [];
    if (!s || !att) return;
    if (workflowLocked(workflowOf(s, attachmentId))) return setMessage(workflowCopy.locked);
    const artifacts = framesOf(s, attachmentId);
    const frames = artifacts.flatMap((f) => {
      const img = draftFrames.find((d) => d.id === f.assetId);
      return img ? [{ image: { mimeType: img.mimeType, base64: img.base64 }, timestampMs: f.timestampMs, frameId: f.id }] : [];
    });
    setBusy('describing');
    setMessage(undefined);
    updateSession((x) => updateAttachment(x, attachmentId, { status: 'preparing_cloud' }, now()));
    try {
      const transcript = transcriptOf(s, attachmentId)?.text;
      const res = await describeWorkflow(getServices().ai, {
        attachmentId, frames, artifacts, durationMs: att.durationMs ?? 0, now,
        ...(transcript ? { transcript } : {}), ...(att.note ? { note: att.note } : {}),
        language: useCreationStore.getState().preferences.language,
      });
      if (!res.ok) setMessage(res.message);
      else if (workflowLocked(workflowOf(useMediaStore.getState().session!, attachmentId))) setMessage(workflowCopy.keptYours);
      else updateSession((x) => setWorkflow(x, res.workflow, now()));
    } finally {
      updateSession((x) => updateAttachment(x, attachmentId, { status: 'ready' }, now()));
      setBusy(undefined);
    }
  }, []);

  const cancel = useCallback(() => abort.current?.abort(), []);
  return { add, describeWithAI, cancel, busy, message, clearMessage: () => setMessage(undefined) };
}
