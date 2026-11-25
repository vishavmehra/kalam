/**
 * Web Speech API dictation. Chrome's on-device recognition (`processLocally`, Chrome 139+) keeps
 * audio in the browser; the older `mode = 'ondevice-only'` shape is detected too. Without it,
 * browsers send audio to their own speech servers — callers ask for consent before that path.
 */
import {
  speechErrorMessage, speechLocale, type DictationSession, type OnDeviceSpeech, type SpeechCapability,
  type StartDictationOptions,
} from './speech.shared';

export * from './speech.shared';

interface RecognitionResultLike { isFinal: boolean; 0: { transcript: string } }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  mode?: string;
  onresult: ((e: { results: ArrayLike<RecognitionResultLike> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface RecognitionStatic {
  new (): Recognition;
  available?(o: { langs: string[]; processLocally: boolean }): Promise<string>;
  install?(o: { langs: string[]; processLocally: boolean }): Promise<boolean>;
  availableOnDevice?(lang: string): Promise<string>;
  installOnDevice?(lang: string): Promise<boolean>;
}

function recognitionClass(): RecognitionStatic | undefined {
  const g = globalThis as unknown as { SpeechRecognition?: RecognitionStatic; webkitSpeechRecognition?: RecognitionStatic };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition;
}

const asStatus = (s: string): OnDeviceSpeech =>
  (['available', 'downloadable', 'downloading', 'unavailable'] as const).find((v) => v === s) ?? 'unknown';

export async function getSpeechCapability(lang: string): Promise<SpeechCapability> {
  const SR = recognitionClass();
  const locale = speechLocale(lang);
  if (!SR) return { supported: false, onDevice: 'unavailable', locale };
  try {
    if (SR.available) return { supported: true, onDevice: asStatus(await SR.available({ langs: [locale], processLocally: true })), locale };
    if (SR.availableOnDevice) return { supported: true, onDevice: asStatus(await SR.availableOnDevice(locale)), locale };
  } catch {
    return { supported: true, onDevice: 'unknown', locale };
  }
  return { supported: true, onDevice: 'unavailable', locale };
}

/** Downloads the on-device speech model (needs a user gesture). */
export async function installOnDeviceSpeech(lang: string): Promise<boolean> {
  const SR = recognitionClass();
  const locale = speechLocale(lang);
  try {
    if (SR?.install) return await SR.install({ langs: [locale], processLocally: true });
    if (SR?.installOnDevice) return await SR.installOnDevice(locale);
  } catch {
    return false;
  }
  return false;
}

/** The Web Speech API never exposes the audio, so there is nothing to keep or delete here. */
export async function startDictation(opts: StartDictationOptions): Promise<DictationSession> {
  const SR = recognitionClass();
  if (!SR) throw new Error('This browser does not support speech recognition. Type your idea instead.');
  const rec = new SR();
  rec.lang = speechLocale(opts.lang);
  rec.continuous = true;
  rec.interimResults = true;
  if (opts.onDevice) {
    if ('processLocally' in rec || SR.available) rec.processLocally = true;
    else rec.mode = 'ondevice-only';
  }
  rec.onresult = (e) => {
    let text = '';
    let isFinal = false;
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i]!;
      text += r[0].transcript;
      isFinal = r.isFinal;
    }
    opts.onText(text.replace(/\s+/g, ' ').trim(), isFinal);
  };
  rec.onerror = (e) => {
    const msg = speechErrorMessage(e.error);
    if (msg) opts.onError(msg);
  };
  rec.onend = () => opts.onEnd({});
  rec.start();
  return {
    location: opts.onDevice ? 'on_device' : 'cloud_service',
    stop: () => rec.stop(),
    abort: () => rec.abort(),
  };
}
