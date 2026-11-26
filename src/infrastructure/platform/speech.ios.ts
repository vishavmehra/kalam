/**
 * iOS dictation: the same expo-speech-recognition session as Android (speech.native.ts), with an honest
 * on-device check. expo-speech-recognition 58.0.1 sets requiresOnDeviceRecognition only when the recognizer
 * for the requested locale supports it, and otherwise silently uses Apple's servers
 * (ios/ExpoSpeechRecognizer.swift). Its supportsOnDeviceRecognition() answers for the phone's default locale
 * only, so the kalam-apple module asks Apple about the locale Kalam dictates in. Without that module the
 * answer is 'unknown', which sends dictation down the consent path. Apple manages the on-device speech
 * models itself, so Kalam cannot download one: no Android-only call is made here.
 */
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { loadKalamApple } from '../../../modules/kalam-apple';
import { startDictation as startSharedDictation } from './speech.native';
import { speechLocale, type DictationSession, type SpeechCapability, type StartDictationOptions } from './speech.shared';

export * from './speech.native';

export async function getSpeechCapability(lang: string): Promise<SpeechCapability> {
  const locale = speechLocale(lang);
  let supported = false;
  try { supported = ExpoSpeechRecognitionModule.isRecognitionAvailable(); } catch { supported = false; }
  if (!supported) return { supported, onDevice: 'unavailable', locale };
  const apple = loadKalamApple().module;
  if (!apple) return { supported, onDevice: 'unknown', locale };
  try {
    return { supported, onDevice: apple.supportsOnDeviceSpeech(locale) ? 'available' : 'unavailable', locale };
  } catch {
    return { supported, onDevice: 'unknown', locale };
  }
}

/** iOS downloads its speech models itself (Settings, General, Keyboard, Dictation). */
export async function installOnDeviceSpeech(_lang: string): Promise<boolean> {
  return false;
}

/**
 * Refuses an on-device session iOS would quietly run on Apple's servers, so the audio never leaves the
 * phone under an on_device label without the person's OK.
 */
export async function startDictation(opts: StartDictationOptions): Promise<DictationSession> {
  if (opts.onDevice && (await getSpeechCapability(opts.lang)).onDevice !== 'available') {
    throw new Error('This iPhone or iPad cannot recognise speech in this language without the internet.');
  }
  return startSharedDictation(opts);
}
