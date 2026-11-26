/**
 * Web: browsers' speech recognition only listens to a microphone; it cannot read a file. So an attached
 * audio file goes to Firebase cloud AI as an audio part and comes back as text (createTranscribeService).
 * The orchestrator asks the one-time cloud notice first, and this file refuses when Offline only is on or
 * Online AI is off. The text is shown for the person to correct. Video files are not read on the web.
 */
import { audioCopy, mediaErrorMessage } from '@/core/media/copy';
import { sniffMedia } from '@/core/media/sniff';
import type { AIAudio, TranscribeService } from '@/core/contracts';
import { readBase64 } from './file-bytes.web';
import type { TranscribeFileOptions, TranscribeOutcome } from './transcribe-file.shared';

export * from './transcribe-file.shared';

export const canTranscribeFiles = (isVideo = false) => !isVideo;

/** A recording larger than this is not sent inline to the model. */
export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const SENDABLE = new Set<AIAudio['mimeType']>(['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/webm']);

const fail = (reason: Extract<TranscribeOutcome, { ok: false }>['reason'], message: string): TranscribeOutcome => ({ ok: false, reason, message });

async function realService(): Promise<TranscribeService | undefined> {
  return (await import('@/services')).getServices().transcribe;
}

export async function transcribeFile(opts: TranscribeFileOptions, service?: TranscribeService): Promise<TranscribeOutcome> {
  if (opts.isVideo) return fail('unsupported', audioCopy.webUnsupported);
  if (opts.policy.aiMode === 'offline_only') return fail('blocked', mediaErrorMessage('SPEECH_BLOCKED', { blockedBy: 'offline_only' }));
  if (!opts.policy.allowCloud) return fail('blocked', mediaErrorMessage('SPEECH_BLOCKED', { blockedBy: 'cloud_off' }));
  const mime = sniffMedia(opts.head)?.mime as AIAudio['mimeType'] | undefined;
  if (!mime || !SENDABLE.has(mime)) return fail('format', audioCopy.formatUnreadable);
  if (opts.signal?.aborted) return fail('cancelled', '');
  try {
    const svc = service ?? (await realService());
    if (!svc) return fail('unsupported', audioCopy.webUnsupported);
    const src = { uri: opts.uri };
    const base64 = await readBase64(src);
    if (base64.length > (MAX_AUDIO_BYTES * 4) / 3) return fail('format', audioCopy.formatUnreadable);
    const res = await svc.transcribe({ mimeType: mime, base64 }, { language: opts.lang, ...(opts.signal ? { signal: opts.signal } : {}) });
    if (opts.signal?.aborted) return fail('cancelled', '');
    if (!res.ok) return fail('failed', res.message);
    return { ok: true, text: res.text, segments: res.text ? [{ text: res.text }] : [], location: 'cloud_service', partial: false };
  } catch {
    return fail('failed', mediaErrorMessage('AUDIO_TRANSCRIPTION_FAILED'));
  }
}
