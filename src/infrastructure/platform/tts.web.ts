/**
 * Web text-to-speech over `speechSynthesis` (docs/10 §4.4). Voices load late in Chrome, so the
 * list waits for `voiceschanged`. Long text is split into sentences because Chrome cuts off
 * utterances that run much past 15 seconds. Missing support resolves quietly: speech is a
 * convenience and must never break an app.
 */
import { createSpeechQueue, type SpeechQueue } from './tts-queue';
import {
  chooseVoice, chunkForSpeech, clampRate, normalizeLanguageTag, type SpeakOptions, type SpeechVoice,
  type TextToSpeechAdapter,
} from './tts.shared';

export * from './tts.shared';
export * from './tts-queue';

function synth(): SpeechSynthesis | undefined {
  const g = globalThis as unknown as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: unknown };
  return g.speechSynthesis && g.SpeechSynthesisUtterance ? g.speechSynthesis : undefined;
}

function loadVoices(s: SpeechSynthesis, timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  const ready = s.getVoices();
  if (ready.length) return Promise.resolve(ready);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      s.removeEventListener('voiceschanged', done);
      resolve(s.getVoices());
    };
    const timer = setTimeout(done, timeoutMs);
    s.addEventListener('voiceschanged', done, { once: true });
  });
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createWebTtsAdapter(): TextToSpeechAdapter {
  let generation = 0;
  // Chrome drops an utterance's events if the object is garbage collected mid-speech.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept only so the object stays reachable
  let holding: SpeechSynthesisUtterance | undefined;

  const toVoices = (list: SpeechSynthesisVoice[]): SpeechVoice[] =>
    list.map((v) => ({
      id: v.voiceURI, name: v.name, language: normalizeLanguageTag(v.lang), local: v.localService, isDefault: v.default,
    }));

  return {
    async isAvailable() {
      return synth() !== undefined;
    },
    async getVoices() {
      const s = synth();
      return s ? toVoices(await loadVoices(s)) : [];
    },
    async speak(text: string, options: SpeakOptions = {}) {
      const s = synth();
      if (!s) return;
      const gen = ++generation;
      if (s.speaking || s.pending) {
        s.cancel();
        await delay(60);
        if (gen !== generation) return;
      }
      const raw = await loadVoices(s);
      const choice = chooseVoice(toVoices(raw), { voiceId: options.voiceId, language: options.language });
      const voice = choice.voice ? raw.find((v) => v.voiceURI === choice.voice?.id) : undefined;
      for (const chunk of chunkForSpeech(text)) {
        if (gen !== generation) return;
        await new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(chunk);
          if (voice) {
            u.voice = voice;
            u.lang = voice.lang;
          } else if (options.language) {
            u.lang = normalizeLanguageTag(options.language);
          }
          u.rate = clampRate(options.rate);
          u.onend = () => resolve();
          u.onerror = () => resolve();
          holding = u;
          s.speak(u);
        });
      }
      holding = undefined;
    },
    async stop() {
      generation += 1;
      holding = undefined;
      synth()?.cancel();
    },
  };
}

let adapter: TextToSpeechAdapter | undefined;
export function getTtsAdapter(): TextToSpeechAdapter {
  return (adapter ??= createWebTtsAdapter());
}

let speaker: SpeechQueue | undefined;
/** The one speech queue for the whole app. */
export function getSpeaker(): SpeechQueue {
  return (speaker ??= createSpeechQueue({ adapter: getTtsAdapter() }));
}
