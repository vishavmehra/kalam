/**
 * Speaks app text with the person's speech settings (voice, rate, language). This is what the
 * runtime's `services.speak(text, lang)` should call, so Read-aloud, `speak` actions and the voice
 * agent all share one queue and never talk over each other. Failure is silent: speech is a
 * convenience and must never break an app (docs/10 §4.4).
 */
import { DEFAULT_SPEECH } from '@/core/contracts';
import { getSpeaker } from '@/infrastructure/platform/tts';
import { useSettingsStore } from '@/state/settings-store';
import { speechVoiceFor } from './speech-voice';

export function speakAloud(text: string, lang: string): void {
  try {
    const speech = useSettingsStore.getState().settings.speech ?? DEFAULT_SPEECH;
    getSpeaker().say({ text, priority: 'result', ...speechVoiceFor(speech, lang) });
  } catch {
    // No voice on this device: the app keeps working.
  }
}

/** Stops all speech now and drops anything waiting. */
export function stopSpeakingAloud(): void {
  try {
    getSpeaker().stop();
  } catch {
    // Nothing to stop.
  }
}

/** Says the most recent line again. */
export function repeatSpeech(): boolean {
  try {
    return getSpeaker().repeatLast();
  } catch {
    return false;
  }
}
