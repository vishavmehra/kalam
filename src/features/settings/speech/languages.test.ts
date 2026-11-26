import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEECH } from '@/core/contracts';
import { findSpeechLanguage, formatRate, SPEECH_LANGUAGES, speechServiceName, stepRate } from './languages';

describe('speech settings helpers', () => {
  it('steps the speaking rate in quarters and stays between 0.5 and 2', () => {
    expect(stepRate(1, 1)).toBe(1.25);
    expect(stepRate(1, -1)).toBe(0.75);
    expect(stepRate(0.5, -1)).toBe(0.5);
    expect(stepRate(2, 1)).toBe(2);
    let r = 1;
    for (let i = 0; i < 10; i++) r = stepRate(r, 1);
    expect(r).toBe(2);
  });

  it('formats the rate without noise', () => {
    expect(formatRate(1)).toBe('1x');
    expect(formatRate(1.25)).toBe('1.25x');
    expect(formatRate(0.75)).toBe('0.75x');
  });

  it('offers the ten product languages plus English variants, each with a test sentence', () => {
    const bases = new Set(SPEECH_LANGUAGES.map((l) => l.tag.split('-')[0]));
    expect([...bases].sort()).toEqual(['bn', 'en', 'gu', 'hi', 'kn', 'ml', 'mr', 'pa', 'ta', 'te']);
    for (const l of SPEECH_LANGUAGES) {
      expect(l.sample.length).toBeGreaterThan(5);
      expect(l.sample).not.toMatch(/[—–]/);
    }
  });

  it('the default languages are offered', () => {
    expect(findSpeechLanguage(DEFAULT_SPEECH.sttLanguage)).toBeDefined();
    expect(findSpeechLanguage(DEFAULT_SPEECH.ttsLanguage)).toBeDefined();
    expect(findSpeechLanguage('hi_in')?.english).toBe('Hindi');
    expect(findSpeechLanguage('xx-YY')).toBeUndefined();
  });

  it('recordings are not kept by default', () => {
    expect(DEFAULT_SPEECH.keepRecordings).toBe(false);
  });

  it('names the online speech service of each platform', () => {
    expect(speechServiceName('web')).toBe("your browser's speech service");
    expect(speechServiceName('ios')).toBe("Apple's speech service");
    expect(speechServiceName('android')).toBe("Android's speech service");
  });
});
