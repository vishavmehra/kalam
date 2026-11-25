import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (e: Record<string, unknown>) => void;

const h = vi.hoisted(() => {
  const listeners: Record<string, Listener[]> = {};
  const discard = vi.fn(async (_uri: string) => true);
  const mod = {
    requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
    addListener: vi.fn((name: string, cb: Listener) => {
      (listeners[name] ??= []).push(cb);
      return { remove: () => { listeners[name] = (listeners[name] ?? []).filter((l) => l !== cb); } };
    }),
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    isRecognitionAvailable: () => true,
    supportsOnDeviceRecognition: () => true,
    getSupportedLocales: vi.fn(async () => ({ installedLocales: ['en-IN'] })),
    androidTriggerOfflineModelDownload: vi.fn(),
  };
  const emit = (name: string, payload: Record<string, unknown> = {}) => (listeners[name] ?? []).slice().forEach((l) => l(payload));
  const reset = () => { for (const k of Object.keys(listeners)) delete listeners[k]; };
  return { mod, discard, emit, reset };
});

vi.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: h.mod }));
vi.mock('./media-audio', async () => {
  const shared = await import('./media-audio.shared');
  return { ...shared, discardRecording: h.discard };
});

import { startDictation } from './speech.native';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function callbacks() {
  return { onText: vi.fn(), onError: vi.fn(), onEnd: vi.fn() };
}

beforeEach(() => {
  h.reset();
  h.mod.start.mockClear();
  h.discard.mockClear();
});

describe('Android dictation and recordings (docs/11 §7.3)', () => {
  it('does not ask the recogniser to save audio by default', async () => {
    await startDictation({ lang: 'en-IN', onDevice: true, ...callbacks() });
    const options = h.mod.start.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.recordingOptions).toBeUndefined();
    expect(options.requiresOnDeviceRecognition).toBe(true);
    expect(options.lang).toBe('en-IN');
  });

  it('deletes any recording file right after transcription, and reports none', async () => {
    const cb = callbacks();
    await startDictation({ lang: 'en-IN', onDevice: true, ...cb });
    h.emit('result', { results: [{ transcript: 'save' }], isFinal: true });
    h.emit('audioend', { uri: 'file:///cache/recording_1.wav' });
    h.emit('end');
    await flush();
    expect(h.discard).toHaveBeenCalledWith('file:///cache/recording_1.wav');
    expect(cb.onEnd).toHaveBeenCalledWith({});
    expect(cb.onText).toHaveBeenCalledWith('save', true);
  });

  it('keeps the recording only when the person asked to', async () => {
    const cb = callbacks();
    await startDictation({ lang: 'en-IN', onDevice: true, keepRecording: true, ...cb });
    expect((h.mod.start.mock.calls[0]![0] as { recordingOptions?: { persist: boolean } }).recordingOptions).toEqual({ persist: true });
    h.emit('audioend', { uri: 'file:///cache/recording_2.wav' });
    h.emit('end');
    await flush();
    expect(h.discard).not.toHaveBeenCalled();
    expect(cb.onEnd).toHaveBeenCalledWith({ audioUri: 'file:///cache/recording_2.wav' });
  });

  it('passes the words of the screen to the recogniser as hints, bounded', async () => {
    await startDictation({ lang: 'hi-IN', onDevice: false, hints: Array.from({ length: 150 }, (_, i) => `word ${i}`), ...callbacks() });
    const options = h.mod.start.mock.calls[0]![0] as { contextualStrings?: string[] };
    expect(options.contextualStrings).toHaveLength(100);
  });

  it('refuses to start without microphone permission, with a plain message', async () => {
    h.mod.requestPermissionsAsync.mockResolvedValueOnce({ granted: false });
    await expect(startDictation({ lang: 'en-IN', onDevice: true, ...callbacks() })).rejects.toThrow(/microphone/i);
    expect(h.mod.start).not.toHaveBeenCalled();
  });
});
