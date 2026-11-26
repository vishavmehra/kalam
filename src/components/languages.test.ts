import { describe, expect, it } from 'vitest';
import type { SpeechCapability } from '@/infrastructure/platform/speech.shared';
import { canListenIn, LANGUAGES, recogniserFor } from './languages';

const cap = (supported: boolean, onDevice: SpeechCapability['onDevice']): SpeechCapability => ({ supported, onDevice, locale: 'hi-IN' });

describe('speech languages gated by the recogniser (docs/06 §8.6)', () => {
  it('re-exports the ten languages', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'hi', 'gu', 'mr', 'bn', 'ta', 'te', 'kn', 'ml', 'pa']);
  });

  it('says nothing until the language has been checked', () => {
    expect(recogniserFor(undefined, true)).toBeUndefined();
    expect(canListenIn(undefined)).toBe(true);
  });

  it('never offers a language the provider cannot recognise', () => {
    expect(recogniserFor(cap(false, 'unavailable'), true)).toBe('unsupported');
    expect(canListenIn('unsupported')).toBe(false);
  });

  it('on this device when the model is there, after a download when it can be fetched', () => {
    expect(recogniserFor(cap(true, 'available'), false)).toBe('on_device');
    expect(recogniserFor(cap(true, 'downloadable'), false)).toBe('downloadable');
    expect(recogniserFor(cap(true, 'downloading'), false)).toBe('downloadable');
  });

  it('otherwise only through the online speech service, and not at all when that is off', () => {
    for (const onDevice of ['unavailable', 'unknown'] as const) {
      expect(recogniserFor(cap(true, onDevice), true)).toBe('service');
      expect(recogniserFor(cap(true, onDevice), false)).toBe('service_off');
    }
    expect(canListenIn('service')).toBe(true);
    expect(canListenIn('service_off')).toBe(false);
  });
});
