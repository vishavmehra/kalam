/**
 * Android text-to-speech over expo-speech (docs/10 §4.4). Uses the device's own TTS engine, so
 * installed voices and languages vary; `getVoices()` reports what is really there and
 * `chooseVoice` never claims a voice that is not installed.
 */
import * as Speech from 'expo-speech';
import { createSpeechQueue, type SpeechQueue } from './tts-queue';
import {
  chooseVoice, clampRate, normalizeLanguageTag, type SpeakOptions, type SpeechVoice, type TextToSpeechAdapter,
} from './tts.shared';

export * from './tts.shared';
export * from './tts-queue';

export function createNativeTtsAdapter(): TextToSpeechAdapter {
  let cache: SpeechVoice[] | undefined;
  let generation = 0;

  const voices = async (): Promise<SpeechVoice[]> => {
    if (cache) return cache;
    try {
      const list = await Speech.getAvailableVoicesAsync();
      cache = list.map((v) => ({ id: v.identifier, name: v.name, language: normalizeLanguageTag(v.language), local: true }));
    } catch {
      cache = [];
    }
    return cache;
  };

  return {
    async isAvailable() {
      return (await voices()).length > 0;
    },
    getVoices: voices,
    speak(text: string, options: SpeakOptions = {}) {
      const gen = ++generation;
      return new Promise<void>((resolve) => {
        // Resolve for every ending (done, stopped, error): the queue only needs to know it is over.
        void voices().then((all) => {
          // stop() ran while the voice list was loading: do not start late.
          if (gen !== generation) return resolve();
          const choice = chooseVoice(all, { voiceId: options.voiceId, language: options.language });
          try {
            Speech.speak(text, {
              language: choice.voice?.language ?? (options.language ? normalizeLanguageTag(options.language) : undefined),
              voice: choice.voice?.id,
              rate: clampRate(options.rate),
              onDone: () => resolve(),
              onStopped: () => resolve(),
              onError: () => resolve(),
            });
          } catch {
            resolve();
          }
        });
      });
    },
    async stop() {
      generation += 1;
      try {
        await Speech.stop();
      } catch {
        // Nothing was speaking.
      }
    },
  };
}

let adapter: TextToSpeechAdapter | undefined;
export function getTtsAdapter(): TextToSpeechAdapter {
  return (adapter ??= createNativeTtsAdapter());
}

let speaker: SpeechQueue | undefined;
/** The one speech queue for the whole app. */
export function getSpeaker(): SpeechQueue {
  return (speaker ??= createSpeechQueue({ adapter: getTtsAdapter() }));
}
