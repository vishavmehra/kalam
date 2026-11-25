import { describe, expect, it, vi } from 'vitest';
import { settleRecording } from './media-audio.shared';
import { blockedMessage, chooseSpeechPath, type SpeechPolicyInput } from './speech-policy';
import type { SpeechCapability } from './speech.shared';

const cap = (onDevice: SpeechCapability['onDevice'], supported = true): SpeechCapability => ({ supported, onDevice, locale: 'en-IN' });
const hybrid: SpeechPolicyInput = { aiMode: 'hybrid', allowCloud: true, consent: false };

describe('speech recognition path', () => {
  it('uses on-device recognition whenever it is available, whatever the settings', () => {
    expect(chooseSpeechPath(cap('available'), { aiMode: 'offline_only', allowCloud: false, consent: false })).toEqual({ kind: 'on_device' });
  });

  it('asks before using the online speech service', () => {
    expect(chooseSpeechPath(cap('unavailable'), hybrid)).toEqual({ kind: 'needs_consent', canDownload: false });
    expect(chooseSpeechPath(cap('downloadable'), hybrid)).toEqual({ kind: 'needs_consent', canDownload: true });
    expect(chooseSpeechPath(cap('unknown'), { ...hybrid, consent: true })).toEqual({ kind: 'cloud_service' });
  });

  it('never uses the online service when Settings say offline only or cloud AI is off', () => {
    expect(chooseSpeechPath(cap('unavailable'), { aiMode: 'offline_only', allowCloud: true, consent: true })).toMatchObject({
      kind: 'blocked', reason: 'offline_only',
    });
    expect(chooseSpeechPath(cap('downloadable'), { aiMode: 'hybrid', allowCloud: false, consent: true })).toEqual({
      kind: 'blocked', reason: 'cloud_off', canDownload: true,
    });
  });

  it('reports missing support, and speaks a plain reason with a typing fallback', () => {
    expect(chooseSpeechPath(undefined, hybrid)).toEqual({ kind: 'unsupported' });
    expect(chooseSpeechPath(cap('available', false), hybrid)).toEqual({ kind: 'unsupported' });
    for (const p of [
      { kind: 'unsupported' } as const,
      { kind: 'blocked', reason: 'offline_only', canDownload: false } as const,
      { kind: 'blocked', reason: 'cloud_off', canDownload: false } as const,
    ]) {
      const message = blockedMessage(p);
      expect(message).toMatch(/type a command/i);
      expect(message).not.toMatch(/[—–]/);
    }
  });
});

describe('recording privacy (docs/11 §7.3)', () => {
  it('deletes a temporary recording right after transcription by default', async () => {
    const discard = vi.fn(async () => true);
    expect(await settleRecording('file:///cache/rec.wav', false, discard)).toBeUndefined();
    expect(discard).toHaveBeenCalledWith('file:///cache/rec.wav');
  });

  it('keeps it only when the person turned on "Keep recordings"', async () => {
    const discard = vi.fn(async () => true);
    expect(await settleRecording('file:///cache/rec.wav', true, discard)).toBe('file:///cache/rec.wav');
    expect(discard).not.toHaveBeenCalled();
  });

  it('does nothing when there was no recording, and never reports a failed delete as kept', async () => {
    const discard = vi.fn(async () => true);
    expect(await settleRecording(undefined, false, discard)).toBeUndefined();
    expect(discard).not.toHaveBeenCalled();
    const broken = vi.fn(async () => {
      throw new Error('locked');
    });
    expect(await settleRecording('file:///x.wav', false, broken)).toBeUndefined();
  });
});
