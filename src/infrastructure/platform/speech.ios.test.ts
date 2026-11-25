import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  mod: {
    isRecognitionAvailable: vi.fn(() => true),
    supportsOnDeviceRecognition: vi.fn(() => true),
    getSupportedLocales: vi.fn(),
    androidTriggerOfflineModelDownload: vi.fn(),
  },
}));

vi.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: h.mod }));
// speech.native.ts deletes recordings through expo-file-system, which needs React Native.
vi.mock('./media-audio', async () => ({ ...(await import('./media-audio.shared')), discardRecording: vi.fn() }));

import { getSpeechCapability, installOnDeviceSpeech, startDictation } from './speech.ios';

function phoneLocale(locale: string) {
  vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({ resolvedOptions: () => ({ locale }) } as Intl.DateTimeFormat);
}

afterEach(() => {
  vi.restoreAllMocks();
  h.mod.isRecognitionAvailable.mockReturnValue(true);
  h.mod.supportsOnDeviceRecognition.mockReturnValue(true);
});

describe('iOS speech capability', () => {
  it('is on-device only for the phone\'s own language', async () => {
    phoneLocale('en-IN');
    expect(await getSpeechCapability('en')).toEqual({ supported: true, onDevice: 'available', locale: 'en-US' });
    expect(await getSpeechCapability('hi')).toEqual({ supported: true, onDevice: 'unknown', locale: 'hi-IN' });
  });

  it('is unavailable on device when iOS has no on-device recognizer, and never claims a download', async () => {
    phoneLocale('en-US');
    h.mod.supportsOnDeviceRecognition.mockReturnValue(false);
    expect((await getSpeechCapability('en')).onDevice).toBe('unavailable');
  });

  it('is unsupported when recognition is not available', async () => {
    h.mod.isRecognitionAvailable.mockReturnValue(false);
    expect(await getSpeechCapability('en')).toMatchObject({ supported: false, onDevice: 'unavailable' });
  });

  it('makes no Android-only call', async () => {
    phoneLocale('en-US');
    await getSpeechCapability('en');
    expect(await installOnDeviceSpeech('en')).toBe(false);
    expect(h.mod.getSupportedLocales).not.toHaveBeenCalled();
    expect(h.mod.androidTriggerOfflineModelDownload).not.toHaveBeenCalled();
  });

  it('keeps the shared dictation session from speech.native.ts', () => {
    expect(typeof startDictation).toBe('function');
  });
});
