import { beforeEach, describe, expect, it, vi } from 'vitest';

const speech = vi.hoisted(() => ({
  voices: [
    { identifier: 'en-in-x-ene-local', name: 'en-in-x-ene-local', quality: 'Default', language: 'en-IN' },
    { identifier: 'hi-in-x-hia-local', name: 'hi-in-x-hia-local', quality: 'Default', language: 'hin-IND' },
  ],
  speak: vi.fn(),
  stop: vi.fn(async () => undefined),
}));

vi.mock('expo-speech', () => ({
  getAvailableVoicesAsync: async () => speech.voices,
  speak: speech.speak,
  stop: speech.stop,
}));

import { createNativeTtsAdapter } from './tts.native';

beforeEach(() => {
  speech.speak.mockReset();
  speech.stop.mockClear();
});

describe('Android text-to-speech adapter', () => {
  it('reports installed voices, including Android three-letter language codes', async () => {
    const adapter = createNativeTtsAdapter();
    expect(await adapter.isAvailable()).toBe(true);
    expect((await adapter.getVoices()).map((v) => v.language)).toEqual(['en-IN', 'hi-IN']);
  });

  it('speaks with the chosen voice, language and rate, and resolves when done', async () => {
    speech.speak.mockImplementation((_text: string, o: { onDone?: () => void }) => o.onDone?.());
    await createNativeTtsAdapter().speak('Namaste', { language: 'hi-IN', rate: 3 });
    expect(speech.speak).toHaveBeenCalledWith('Namaste', expect.objectContaining({
      language: 'hi-IN', voice: 'hi-in-x-hia-local', rate: 2,
    }));
  });

  it('resolves when speech is stopped or fails, so the queue never stalls', async () => {
    speech.speak.mockImplementation((_t: string, o: { onStopped?: () => void }) => o.onStopped?.());
    await expect(createNativeTtsAdapter().speak('One')).resolves.toBeUndefined();
    speech.speak.mockImplementation((_t: string, o: { onError?: (e: Error) => void }) => o.onError?.(new Error('engine')));
    await expect(createNativeTtsAdapter().speak('Two')).resolves.toBeUndefined();
    speech.speak.mockImplementation(() => {
      throw new Error('no engine');
    });
    await expect(createNativeTtsAdapter().speak('Three')).resolves.toBeUndefined();
  });

  it('leaves the voice to the engine when no voice is installed for the language', async () => {
    speech.speak.mockImplementation((_t: string, o: { onDone?: () => void }) => o.onDone?.());
    await createNativeTtsAdapter().speak('வணக்கம்', { language: 'ta-IN' });
    expect(speech.speak).toHaveBeenCalledWith('வணக்கம்', expect.objectContaining({ language: 'ta-IN', voice: undefined }));
  });

  it('stop() reaches the engine and never throws', async () => {
    const adapter = createNativeTtsAdapter();
    await adapter.stop();
    expect(speech.stop).toHaveBeenCalled();
    speech.stop.mockRejectedValueOnce(new Error('idle'));
    await expect(adapter.stop()).resolves.toBeUndefined();
  });
});
