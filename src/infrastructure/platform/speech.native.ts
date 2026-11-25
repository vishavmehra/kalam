/**
 * Android dictation via expo-speech-recognition. `requiresOnDeviceRecognition` keeps audio on the
 * device when an offline model is installed. No recording file is made unless `keepRecording` is set,
 * and any file that does appear is deleted right after transcription (docs/11 §7.3).
 */
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { discardRecording, settleRecording } from './media-audio';
import {
  speechErrorMessage, speechLocale, type DictationSession, type SpeechCapability, type StartDictationOptions,
} from './speech.shared';

export * from './speech.shared';

export async function getSpeechCapability(lang: string): Promise<SpeechCapability> {
  const locale = speechLocale(lang);
  let supported = false;
  try { supported = ExpoSpeechRecognitionModule.isRecognitionAvailable(); } catch { supported = false; }
  if (!supported) return { supported, onDevice: 'unavailable', locale };
  if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) return { supported, onDevice: 'unavailable', locale };
  try {
    const { installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({ androidRecognitionServicePackage: 'com.google.android.as' });
    const base = locale.split('-')[0]!;
    const installed = installedLocales.some((l) => l === locale || l.split('-')[0] === base);
    return { supported, onDevice: installed ? 'available' : 'downloadable', locale };
  } catch {
    return { supported, onDevice: 'unknown', locale };
  }
}

export async function installOnDeviceSpeech(lang: string): Promise<boolean> {
  try {
    const res = await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale: speechLocale(lang) });
    return res.status === 'download_success';
  } catch {
    return false;
  }
}

export async function startDictation(opts: StartDictationOptions): Promise<DictationSession> {
  const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  if (!perm.granted) throw new Error(speechErrorMessage('not-allowed'));

  let audioUri: string | undefined;
  const subs = [
    ExpoSpeechRecognitionModule.addListener('result', (e) => {
      const text = e.results[0]?.transcript ?? '';
      opts.onText(text.trim(), e.isFinal);
    }),
    ExpoSpeechRecognitionModule.addListener('error', (e) => {
      const msg = speechErrorMessage(e.error);
      if (msg) opts.onError(msg);
    }),
    ExpoSpeechRecognitionModule.addListener('audioend', (e) => { audioUri = e.uri ?? undefined; }),
    ExpoSpeechRecognitionModule.addListener('end', () => {
      subs.forEach((s) => s.remove());
      // Delete the temporary recording unless the person chose to keep it.
      void settleRecording(audioUri, opts.keepRecording === true, discardRecording).then((kept) => {
        opts.onEnd(kept ? { audioUri: kept } : {});
      });
    }),
  ];

  ExpoSpeechRecognitionModule.start({
    lang: speechLocale(opts.lang),
    interimResults: true,
    continuous: true,
    addsPunctuation: true,
    requiresOnDeviceRecognition: opts.onDevice,
    ...(opts.hints?.length ? { contextualStrings: opts.hints.slice(0, 100) } : {}),
    ...(opts.keepRecording ? { recordingOptions: { persist: true } } : {}),
  });

  return {
    location: opts.onDevice ? 'on_device' : 'cloud_service',
    stop: () => ExpoSpeechRecognitionModule.stop(),
    abort: () => ExpoSpeechRecognitionModule.abort(),
  };
}
