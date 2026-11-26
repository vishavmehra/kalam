/**
 * Attached recordings (docs/06 §2.3, §8): signature, size and duration checks, sample rate and
 * channels, text on this device where the platform can read a file (Android 13+, iOS), the spoken
 * language, and an editable transcript that keeps the first version. The platform's online speech
 * service is used only with the same rules as dictation (speech-policy.ts, docs/10 §16.4): hybrid
 * mode, cloud allowed, and the person's OK for this session, asked in the file's card. Lead decision 3:
 * the raw recording is stored only when "Keep recordings" is on; otherwise its temporary copy is
 * playable until the person removes it or leaves the session. Kalam uploads nothing itself.
 */
import { useCallback, useRef, useState } from 'react';
import { attachmentCopy, audioCopy } from '@/core/media/copy';
import { isMediaError, toMediaError } from '@/core/media/errors';
import { FINGERPRINT_BYTES, findDuplicate } from '@/core/media/hash';
import { identifyLanguage } from '@/core/media/language';
import { checkLimits } from '@/core/media/limits';
import { audioFormatInfo } from '@/core/media/sniff';
import { createTranscript, editTranscript, typedTranscript } from '@/core/media/transcript';
import type { MediaAttachment } from '@/core/media/types';
import { timings } from '@/core/observability';
import { attachmentName } from '@/core/session/handoff';
import { addAttachment, newMediaId, removeAttachment, setTranscript, transcriptOf, updateAttachment } from '@/core/session/session';
import { probeAudioDuration } from '@/infrastructure/media/audio-probe';
import { fileExists, isDurableUri, readBase64, readHead } from '@/infrastructure/media/file-bytes';
import { inspectMedia } from '@/infrastructure/media/inspect';
import { pickAudioFile } from '@/infrastructure/media/pick';
import type { MediaSource } from '@/infrastructure/media/source';
import { transcribeFile } from '@/infrastructure/media/transcribe-file';
import { discardRecording } from '@/infrastructure/platform/media-audio';
import type { SpeechPolicyInput } from '@/infrastructure/platform/speech-policy';
import { getDatabase } from '@/infrastructure/storage/database';
import { keepRecording } from '@/infrastructure/storage/media-sessions';
import { useCreationStore } from '@/state/creation-store';
import { useSettingsStore } from '@/state/settings-store';
import { abortJob, dropAssets, endJob, ensureSession, isAttached, onMediaReset, startJob, updateSession, useMediaStore } from './media-store';

const now = () => Date.now();
const find = (id: string) => useMediaStore.getState().session?.attachments.find((a) => a.id === id);
const abortError = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' });
const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

/** Playable uris for this session only (never stored unless the recording is kept). */
const liveUris = new Map<string, string>();
export const playableAudioUri = (a: MediaAttachment) =>
  liveUris.get(a.id) ?? (a.localUri && fileExists(a.localUri) ? a.localUri : undefined);

/** The person said yes to the online speech service in this session (reset with the session). */
let speechConsent = false;

/** Speech rules for this session, the same ones dictation uses. */
export function speechPolicy(): SpeechPolicyInput {
  const s = useSettingsStore.getState().settings;
  return { aiMode: s.aiMode, allowCloud: s.allowCloud, consent: speechConsent };
}

/** Releases a recording that is not kept (temporary file or object URL). */
export function releaseRecording(attachmentId: string): void {
  const uri = liveUris.get(attachmentId);
  liveUris.delete(attachmentId);
  const kept = find(attachmentId)?.originalAssetId;
  if (uri && !kept) void discardRecording(uri);
}

onMediaReset(() => {
  for (const id of [...liveUris.keys()]) releaseRecording(id);
  speechConsent = false;
});

/** Removes a recording row with its temporary copy and stored files. */
function dropAudio(attachmentId: string): void {
  abortJob(attachmentId);
  releaseRecording(attachmentId);
  let removed: string[] = [];
  updateSession((s) => {
    const r = removeAttachment(s, attachmentId, now());
    removed = r.removedAssetIds;
    return r.session;
  });
  void dropAssets(removed);
}

/**
 * Turns the recording into text where the platform can. Without machine text the person types it;
 * when only the online speech service could do it, the card asks first (SPEECH_CONSENT_REQUIRED).
 */
async function transcribeInto(id: string, uri: string, head: Uint8Array, signal: AbortSignal): Promise<string | undefined> {
  const settings = useSettingsStore.getState().settings;
  const lang = settings.speech?.sttLanguage ?? useCreationStore.getState().preferences.language;
  const heard = await timings.time('audio_transcribe', () => transcribeFile({ uri, lang, head, policy: speechPolicy(), signal }), (h) => h.ok);
  if (heard.ok) {
    const language = identifyLanguage(heard.text, { preferred: lang, ...(heard.language ? { service: heard.language } : {}) });
    updateSession((s) => {
      // The person typed the text while this ran: their words win.
      if (transcriptOf(s, id)?.text.trim()) return updateAttachment(s, id, { status: 'ready' }, now());
      return setTranscript(updateAttachment(s, id, { status: heard.partial ? 'partial' : 'ready' }, now()), createTranscript(id, heard.text, {
        source: heard.location === 'on_device' ? 'device' : 'cloud', segments: heard.segments, partial: heard.partial, ...(language ? { language } : {}),
      }), now());
    });
    return undefined;
  }
  if (heard.reason === 'cancelled') throw abortError();
  const ask = heard.reason === 'needs_consent';
  updateSession((s) => {
    const t = transcriptOf(s, id);
    const next = updateAttachment(s, id, {
      status: t?.text.trim() ? 'ready' : 'partial',
      ...(ask ? { error: { code: 'SPEECH_CONSENT_REQUIRED' as const, message: heard.message.slice(0, 400) } } : {}),
    }, now());
    return t ? next : setTranscript(next, typedTranscript(id, ''), now());
  });
  // The question is shown in the card itself.
  return ask ? undefined : heard.message;
}

async function ingest(src: MediaSource, batch: AbortSignal, replaceId?: string): Promise<{ id: string; message?: string }> {
  const keep = !!useSettingsStore.getState().settings.speech?.keepRecordings;
  const session = ensureSession();
  const id = newMediaId('att');
  const signal = startJob(id, batch);
  const row: MediaAttachment = {
    id, type: 'audio', mimeType: 'application/octet-stream', sizeBytes: src.sizeBytes ?? 0, status: 'validating', createdAt: now(), updatedAt: now(),
  };
  updateSession((s) => addAttachment(s, row, now()).session);
  const stored: string[] = [];
  const alive = () => {
    if (signal.aborted || !isAttached(id)) throw abortError();
  };
  try {
    const n = useMediaStore.getState().session!.attachments.filter((a) => a.type === 'audio').length;
    const info = await inspectMedia(src, 'audio', attachmentCopy.audioName(n));
    alive();
    // Replacing a recording with the same file is allowed.
    const dup = findDuplicate(info.contentHash, useMediaStore.getState().session!.attachments.filter((a) => a.id !== replaceId), id);
    if (dup) {
      updateSession((s) => removeAttachment(s, id, now()).session);
      return { id, message: attachmentCopy.duplicate(attachmentName(useMediaStore.getState().session!, dup)) };
    }
    const durationSec = await probeAudioDuration(src.uri);
    alive();
    const tooLong = durationSec !== undefined ? checkLimits('audio', { durationSec }) : undefined;
    if (tooLong) throw tooLong;
    const fmt = audioFormatInfo(info.head);
    liveUris.set(id, src.uri);
    updateSession((s) => updateAttachment(s, id, {
      mimeType: info.mimeType, sizeBytes: info.sizeBytes, contentHash: info.contentHash, status: 'processing_local',
      ...(info.name ? { name: info.name } : {}),
      ...(durationSec !== undefined ? { durationMs: Math.round(durationSec * 1000) } : {}),
      ...(fmt ? { sampleRate: fmt.sampleRate, channels: fmt.channels } : {}),
    }, now()));

    const kept = keep
      ? await readBase64(src).then((b64) => keepRecording(getDatabase(), { sessionId: session.id, attachmentId: id, base64: b64, mimeType: info.mimeType }, true)).catch(() => undefined)
      : undefined;
    if (kept) stored.push(kept);
    alive();
    if (kept) updateSession((s) => updateAttachment(s, id, { originalAssetId: kept, ...(isDurableUri(src.uri) ? { localUri: src.uri } : {}) }, now()));
    stored.length = 0;
    return { id, message: await transcribeInto(id, src.uri, info.head, signal) };
  } catch (e) {
    void dropAssets(stored);
    if (signal.aborted || isAbort(e)) {
      let removed: string[] = [];
      updateSession((s) => {
        const r = removeAttachment(s, id, now());
        removed = r.removedAssetIds;
        return r.session;
      });
      releaseRecording(id);
      void dropAssets(removed);
      return { id };
    }
    const err = isMediaError(e) ? e : toMediaError(e, 'AUDIO_TRANSCRIPTION_FAILED');
    updateSession((s) => updateAttachment(s, id, { status: 'failed', error: err.toJSON() }, now()));
    return { id, message: err.message };
  } finally {
    endJob(id);
  }
}

/**
 * The person said yes in the file's card: use the online speech service for this session and try the
 * recording again. Returns a message for the person, if any.
 */
export async function allowOnlineSpeech(attachmentId: string): Promise<string | undefined> {
  speechConsent = true;
  const a = find(attachmentId);
  if (!a) return undefined;
  const uri = playableAudioUri(a);
  if (!uri) {
    updateSession((s) => updateAttachment(s, attachmentId, { status: 'partial' }, now()));
    return audioCopy.gone;
  }
  const signal = startJob(attachmentId);
  updateSession((s) => updateAttachment(s, attachmentId, { status: 'preparing_cloud' }, now()));
  try {
    const head = await readHead({ uri }, FINGERPRINT_BYTES);
    if (signal.aborted || !isAttached(attachmentId)) return undefined;
    return await transcribeInto(attachmentId, uri, head, signal);
  } catch (e) {
    updateSession((s) => updateAttachment(s, attachmentId, { status: 'partial' }, now()));
    return signal.aborted || isAbort(e) ? undefined : toMediaError(e, 'AUDIO_TRANSCRIPTION_FAILED').message;
  } finally {
    endJob(attachmentId);
  }
}

/** The person's transcript edit; the first version stays in `original`. */
export function editAudioTranscript(attachmentId: string, text: string): void {
  updateSession((s) => {
    const t = transcriptOf(s, attachmentId);
    const next = t ? editTranscript(t, text) : typedTranscript(attachmentId, text);
    const lang = identifyLanguage(next.text, { preferred: useCreationStore.getState().preferences.language });
    const withLang = t?.languageSource === 'speech_service' || !lang ? next : { ...next, language: lang.code, languageSource: 'script' as const };
    return setTranscript(updateAttachment(s, attachmentId, { status: next.text.trim() ? 'ready' : 'partial' }, now()), withLang, now());
  });
}

export function useAudioFile() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const abort = useRef<AbortController | undefined>(undefined);

  const add = useCallback(async (replaceId?: string) => {
    setMessage(undefined);
    let src: MediaSource | undefined;
    try {
      src = await pickAudioFile();
    } catch (e) {
      return setMessage(toMediaError(e, 'FILE_UNSUPPORTED').message);
    }
    if (!src) return;
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    try {
      const r = await timings.time('attachment_intake', () => ingest(src, ac.signal, replaceId));
      // Replace: the old recording and its edited text go only once the new one is in (docs/06 §3.5).
      if (replaceId) {
        const fresh = find(r.id);
        if (fresh && fresh.status !== 'failed') dropAudio(replaceId);
        else if (fresh) dropAudio(fresh.id);
      }
      setMessage(r.message);
    } finally {
      setBusy(false);
      if (abort.current === ac) abort.current = undefined;
    }
  }, []);

  const cancel = useCallback(() => abort.current?.abort(), []);
  return { add, cancel, busy, message, clearMessage: () => setMessage(undefined) };
}
