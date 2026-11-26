import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  mod: {
    isRecognitionAvailable: vi.fn(() => true),
    supportsOnDeviceRecognition: vi.fn(() => true),
    getSupportedLocales: vi.fn(),
    androidTriggerOfflineModelDownload: vi.fn(),
    requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
    addListener: vi.fn(() => ({ remove: vi.fn() })),
    start: vi.fn(),
  },
}));

vi.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: h.mod }));
// speech.native.ts deletes recordings through expo-file-system, which needs React Native.
vi.mock('./media-audio', async () => ({ ...(await import('./media-audio.shared')), discardRecording: vi.fn() }));

import { getSpeechCapability, installOnDeviceSpeech, startDictation } from './speech.ios';

type G = { expo?: unknown };
const g = globalThis as G;

/** kalam-apple where Expo installs it; Apple answers on-device support per recognizer locale. */
function appleSpeech(onDeviceLocales: string[]) {
  const supportsOnDeviceSpeech = vi.fn((locale: string) => onDeviceLocales.includes(locale));
  g.expo = { modules: { KalamApple: { supportsOnDeviceSpeech } } };
  return supportsOnDeviceSpeech;
}

const dictation = (lang: string) => ({ lang, onDevice: true, onText: vi.fn(), onError: vi.fn(), onEnd: vi.fn() });

afterEach(() => {
  delete g.expo;
  vi.clearAllMocks();
  h.mod.isRecognitionAvailable.mockReturnValue(true);
});

describe('iOS speech capability', () => {
  it('asks Apple about the locale Kalam dictates in, not the phone\'s default one', async () => {
    const check = appleSpeech(['en-US']);
    expect(await getSpeechCapability('en')).toEqual({ supported: true, onDevice: 'available', locale: 'en-US' });
    expect(check).toHaveBeenCalledWith('en-US');
    expect(h.mod.supportsOnDeviceRecognition).not.toHaveBeenCalled();
  });

  it('is not on-device for a region whose recognizer needs Apple\'s servers, even when the phone\'s is on-device', async () => {
    appleSpeech(['en-US']); // the phone's en-US recognizer runs on the device; en-IN does not
    expect(await getSpeechCapability('en-IN')).toEqual({ supported: true, onDevice: 'unavailable', locale: 'en-IN' });
    expect(await getSpeechCapability('hi')).toMatchObject({ onDevice: 'unavailable', locale: 'hi-IN' });
  });

  it('is unknown without the kalam-apple module (Expo Go), so dictation asks first', async () => {
    expect(await getSpeechCapability('en')).toMatchObject({ supported: true, onDevice: 'unknown' });
  });

  it('is unknown when the native check throws', async () => {
    appleSpeech([]).mockImplementation(() => { throw new Error('no recognizer'); });
    expect((await getSpeechCapability('en')).onDevice).toBe('unknown');
  });

  it('is unsupported when recognition is not available', async () => {
    appleSpeech(['en-US']);
    h.mod.isRecognitionAvailable.mockReturnValue(false);
    expect(await getSpeechCapability('en')).toMatchObject({ supported: false, onDevice: 'unavailable' });
  });

  it('makes no Android-only call', async () => {
    appleSpeech(['en-US']);
    await getSpeechCapability('en');
    expect(await installOnDeviceSpeech('en')).toBe(false);
    expect(h.mod.getSupportedLocales).not.toHaveBeenCalled();
    expect(h.mod.androidTriggerOfflineModelDownload).not.toHaveBeenCalled();
  });
});

describe('iOS dictation', () => {
  it('refuses an on-device session that iOS would run on its servers, before the microphone starts', async () => {
    appleSpeech(['en-US']);
    await expect(startDictation(dictation('en-IN'))).rejects.toThrow(/without the internet/);
    expect(h.mod.start).not.toHaveBeenCalled();
  });

  it('starts the shared session, on the device, for a locale Apple runs on the device', async () => {
    appleSpeech(['en-US']);
    const session = await startDictation(dictation('en'));
    expect(session.location).toBe('on_device');
    expect(h.mod.start).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en-US', requiresOnDeviceRecognition: true }));
  });
});
