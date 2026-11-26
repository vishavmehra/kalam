/**
 * Android 13+ and iOS: turn an attached recording into text with expo-speech-recognition's file
 * input (docs/06 §8.3). On-device recognition is used when its model is installed; otherwise the
 * platform's online speech service (Google or Apple) hears the file, and only after the person said
 * yes for this session (chooseSpeechPath, docs/10 §16.4). Android 14+ also reports the spoken
 * language (docs/06 §8.6). Android reads the first track only, so the sound of a video file can be
 * read on iOS alone.
 */
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Platform } from 'react-native';
import { audioCopy, mediaErrorMessage, workflowCopy } from '@/core/media/copy';
import { serviceLanguage, SPEECH_LANGUAGES, type DetectedLanguage } from '@/core/media/language';
import { audioFormatInfo } from '@/core/media/sniff';
import { segmentsText } from '@/core/media/transcript';
import type { TranscriptSegment } from '@/core/media/types';
import { getSpeechCapability, speechLocale } from '@/infrastructure/platform/speech';
import { speechServiceName } from '@/infrastructure/platform/speech.shared';
import { chooseSpeechPath } from '@/infrastructure/platform/speech-policy';
import type { TranscribeFileOptions, TranscribeOutcome } from './transcribe-file.shared';

export * from './transcribe-file.shared';

const ANDROID_13 = 33;
const isAndroid = () => Platform.OS === 'android';

export const canTranscribeFiles = (isVideo = false) =>
  Platform.OS === 'ios' || (isAndroid() && Number(Platform.Version) >= ANDROID_13 && !isVideo);

const fail = (reason: Extract<TranscribeOutcome, { ok: false }>['reason'], message: string): TranscribeOutcome => ({ ok: false, reason, message });

export async function transcribeFile(opts: TranscribeFileOptions): Promise<TranscribeOutcome> {
  if (isAndroid() && Number(Platform.Version) < ANDROID_13) return fail('android_too_old', audioCopy.androidTooOld);
  if (opts.isVideo && isAndroid()) return fail('unsupported', workflowCopy.noSpeech);
  const fmt = audioFormatInfo(opts.head);
  // Android streams decoded sound with the rate and channels we pass; a wrong guess gives nonsense text.
  if (isAndroid() && !fmt) return fail('format', audioCopy.formatUnreadable);

  const path = chooseSpeechPath(await getSpeechCapability(opts.lang).catch(() => undefined), opts.policy);
  if (path.kind === 'unsupported') return fail('unsupported', mediaErrorMessage('AUDIO_TRANSCRIPTION_FAILED'));
  if (path.kind === 'blocked') return fail('blocked', mediaErrorMessage('SPEECH_BLOCKED', { blockedBy: path.reason }));
  if (path.kind === 'needs_consent') return fail('needs_consent', mediaErrorMessage('SPEECH_CONSENT_REQUIRED', { service: speechServiceName(Platform.OS) }));
  const onDevice = path.kind === 'on_device';
  const perm = await ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync();
  if (!perm.granted) return fail('failed', mediaErrorMessage('PERMISSION_DENIED'));
  if (opts.signal?.aborted) return fail('cancelled', '');

  return new Promise<TranscribeOutcome>((resolve) => {
    let segments: TranscriptSegment[] = [];
    let language: DetectedLanguage | undefined;
    let error: string | undefined;
    let settled = false;
    const onAbort = () => ExpoSpeechRecognitionModule.abort();
    const subs = [
      ExpoSpeechRecognitionModule.addListener('result', (e) => {
        const r = e.results[0];
        if (!e.isFinal || !r?.transcript.trim()) return;
        const first = r.segments?.[0];
        const last = r.segments?.[r.segments.length - 1];
        const seg: TranscriptSegment = {
          text: r.transcript.trim(),
          ...(first ? { startMs: Math.max(0, Math.round(first.startTimeMillis)) } : {}),
          ...(last ? { endMs: Math.max(0, Math.round(last.endTimeMillis)) } : {}),
        };
        // Android sends one final result per utterance; iOS sends the whole text again, so keep the latest.
        segments = isAndroid() ? [...segments, seg].slice(-500) : [seg];
      }),
      ExpoSpeechRecognitionModule.addListener('languagedetection', (e) => {
        language = serviceLanguage(e.detectedLanguage, e.confidence) ?? language;
      }),
      ExpoSpeechRecognitionModule.addListener('error', (e) => {
        error = e.error;
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => finish()),
    ];
    function finish() {
      if (settled) return;
      settled = true;
      subs.forEach((s) => s.remove());
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) return resolve(fail('cancelled', ''));
      const text = segmentsText(segments);
      if (!text) return resolve(fail('failed', mediaErrorMessage('AUDIO_TRANSCRIPTION_FAILED')));
      resolve({
        ok: true, text, segments, location: onDevice ? 'on_device' : 'cloud_service',
        partial: !!error && error !== 'no-speech' && error !== 'aborted',
        ...(language ? { language } : {}),
      });
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      ExpoSpeechRecognitionModule.start({
        lang: speechLocale(opts.lang),
        interimResults: false,
        continuous: isAndroid(),
        addsPunctuation: true,
        requiresOnDeviceRecognition: onDevice,
        audioSource: { uri: opts.uri, ...(fmt ? { sampleRate: fmt.sampleRate, audioChannels: fmt.channels } : {}) },
        androidIntentOptions: {
          EXTRA_ENABLE_LANGUAGE_DETECTION: true,
          EXTRA_LANGUAGE_DETECTION_ALLOWED_LANGUAGES: SPEECH_LANGUAGES.map((l) => speechLocale(l)),
        },
      });
    } catch {
      error = 'start';
      finish();
    }
  });
}
