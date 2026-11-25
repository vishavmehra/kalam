/**
 * iOS dictation: the same expo-speech-recognition session as Android (speech.native.ts), with an honest
 * on-device check. On iOS the module's getSupportedLocales() lists every server locale as "installed", and
 * supportsOnDeviceRecognition() answers only for the phone's own language (SFSpeechRecognizer() with the
 * default locale; expo-speech-recognition 58.0.1 ios/ExpoSpeechRecognitionModule.swift). Apple manages the
 * on-device speech models itself, so Kalam cannot download one: no Android-only call is made here.
 */
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { speechLocale, type SpeechCapability } from './speech.shared';

export * from './speech.native';

const primary = (tag: string) => tag.toLowerCase().split(/[-_]/)[0] ?? '';

export async function getSpeechCapability(lang: string): Promise<SpeechCapability> {
  const locale = speechLocale(lang);
  let supported = false;
  try { supported = ExpoSpeechRecognitionModule.isRecognitionAvailable(); } catch { supported = false; }
  if (!supported) return { supported, onDevice: 'unavailable', locale };
  let onDevice = false;
  try { onDevice = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(); } catch { onDevice = false; }
  if (!onDevice) return { supported, onDevice: 'unavailable', locale };
  // The answer above is for the phone's language. Another language may or may not run on the device, and
  // 'unknown' sends it down the consent path rather than claiming it stays on the phone.
  const phone = Intl.DateTimeFormat().resolvedOptions().locale;
  return { supported, onDevice: primary(phone) === primary(locale) ? 'available' : 'unknown', locale };
}

/** iOS downloads its speech models itself (Settings, General, Keyboard, Dictation). */
export async function installOnDeviceSpeech(_lang: string): Promise<boolean> {
  return false;
}
