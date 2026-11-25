import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebTtsAdapter } from './tts.web';

class FakeUtterance {
  voice: unknown = null;
  lang = '';
  rate = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

const VOICES = [
  { voiceURI: 'v-en', name: 'English', lang: 'en_US', localService: true, default: true },
  { voiceURI: 'v-hi', name: 'Hindi', lang: 'hi-IN', localService: true, default: false },
];

function installSpeech(autoEnd: boolean) {
  const spoken: FakeUtterance[] = [];
  const synth = {
    speaking: false,
    pending: false,
    getVoices: () => VOICES,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    cancel: vi.fn(),
    speak: (u: FakeUtterance) => {
      spoken.push(u);
      if (autoEnd) setTimeout(() => u.onend?.(), 0);
    },
  };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return { synth, spoken };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web text-to-speech adapter', () => {
  it('lists the browser voices with normalised language tags', async () => {
    installSpeech(true);
    const adapter = createWebTtsAdapter();
    expect(await adapter.isAvailable()).toBe(true);
    expect(await adapter.getVoices()).toEqual([
      { id: 'v-en', name: 'English', language: 'en-US', local: true, isDefault: true },
      { id: 'v-hi', name: 'Hindi', language: 'hi-IN', local: true, isDefault: false },
    ]);
  });

  it('speaks with the voice and rate from the settings', async () => {
    const { spoken } = installSpeech(true);
    await createWebTtsAdapter().speak('Namaste', { language: 'hi-IN', rate: 1.5 });
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toMatchObject({ text: 'Namaste', rate: 1.5, lang: 'hi-IN' });
    expect((spoken[0]!.voice as { voiceURI: string }).voiceURI).toBe('v-hi');
  });

  it('prefers the voice the person picked', async () => {
    const { spoken } = installSpeech(true);
    await createWebTtsAdapter().speak('Hello', { language: 'hi-IN', voiceId: 'v-en' });
    expect((spoken[0]!.voice as { voiceURI: string }).voiceURI).toBe('v-en');
  });

  it('does not pick a voice for a language that is not installed', async () => {
    const { spoken } = installSpeech(true);
    await createWebTtsAdapter().speak('வணக்கம்', { language: 'ta-IN' });
    expect(spoken[0]!.voice).toBeNull();
    expect(spoken[0]!.lang).toBe('ta-IN');
  });

  it('splits long text into sentences and speaks them in order', async () => {
    const { spoken } = installSpeech(true);
    const sentence = 'This is one sentence that is fairly long and keeps going for a while. ';
    await createWebTtsAdapter().speak(sentence.repeat(6));
    expect(spoken.length).toBeGreaterThan(1);
    expect(spoken.every((u) => u.text.length <= 180)).toBe(true);
  });

  it('stop() cancels the browser and drops the rest of a long text', async () => {
    const { spoken, synth } = installSpeech(false);
    const adapter = createWebTtsAdapter();
    const sentence = 'This is one sentence that is fairly long and keeps going for a while. ';
    const done = adapter.speak(sentence.repeat(6));
    await tick();
    await tick();
    expect(spoken).toHaveLength(1);
    await adapter.stop();
    expect(synth.cancel).toHaveBeenCalled();
    spoken[0]!.onend?.(); // the browser reports the cut-off utterance
    await done;
    expect(spoken).toHaveLength(1);
  });

  it('is quiet and safe when the browser has no speech synthesis', async () => {
    vi.stubGlobal('speechSynthesis', undefined);
    const adapter = createWebTtsAdapter();
    expect(await adapter.isAvailable()).toBe(false);
    expect(await adapter.getVoices()).toEqual([]);
    await expect(adapter.speak('Hello')).resolves.toBeUndefined();
    await expect(adapter.stop()).resolves.toBeUndefined();
  });
});
