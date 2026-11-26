import { describe, expect, it } from 'vitest';

import { createShelfReader, type ReaderSpeech, type ReaderStatus, shelfSentences } from './read-aloud';

/** A speech engine that says one line at a time. `finish()` ends the current line, as the engine would. */
function fakeSpeech(refuse: (text: string) => boolean = () => false) {
  const said: string[] = [];
  const listeners = new Set<(speaking: boolean) => void>();
  let speaking = false;
  const emit = (v: boolean) => { speaking = v; listeners.forEach((l) => l(v)); };
  const speech: ReaderSpeech = {
    say(text) {
      if (refuse(text)) return false;
      said.push(text);
      emit(true);
      return true;
    },
    stop() { if (speaking) emit(false); },
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
  return { speech, said, finish: () => emit(false), isSpeaking: () => speaking, listenerCount: () => listeners.size };
}

describe('shelf read-aloud with pause (D10-020)', () => {
  it('builds the sentences: the count line, then each app name, capped', () => {
    expect(shelfSentences('3 apps on this device', ['Expense tracker', ' ', 'Tailor book'])).toEqual(['3 apps on this device', 'Expense tracker', 'Tailor book']);
    const many = Array.from({ length: 20 }, (_, n) => `App ${n}`);
    expect(shelfSentences('20 apps', many, 4)).toHaveLength(5);
  });

  it('reads one sentence after another and ends as done', () => {
    const f = fakeSpeech();
    const r = createShelfReader(f.speech);
    const seen: ReaderStatus[] = [];
    r.onChange((s) => seen.push(s));
    r.start(['one', 'two', 'three']);
    expect(f.said).toEqual(['one']);
    f.finish();
    expect(f.said).toEqual(['one', 'two']);
    f.finish();
    f.finish();
    expect(f.said).toEqual(['one', 'two', 'three']);
    expect(r.status()).toBe('done');
    expect(seen).toEqual(['reading', 'done']);
  });

  it('pauses at the sentence and resumes by saying that sentence again', () => {
    const f = fakeSpeech();
    const r = createShelfReader(f.speech);
    r.start(['one', 'two', 'three']);
    f.finish();
    expect(r.index()).toBe(1);
    r.pause();
    expect(r.status()).toBe('paused');
    expect(f.isSpeaking()).toBe(false);
    // Stopping the engine for the pause must not count as "sentence two finished".
    expect(r.index()).toBe(1);
    expect(f.said).toEqual(['one', 'two']);
    r.resume();
    expect(r.status()).toBe('reading');
    expect(f.said).toEqual(['one', 'two', 'two']);
    f.finish();
    expect(f.said.at(-1)).toBe('three');
  });

  it('does nothing when pause or resume come in the wrong state', () => {
    const f = fakeSpeech();
    const r = createShelfReader(f.speech);
    r.pause();
    r.resume();
    expect(r.status()).toBe('idle');
    expect(f.said).toEqual([]);
  });

  it('stops everything and goes back to the first sentence', () => {
    const f = fakeSpeech();
    const r = createShelfReader(f.speech);
    r.start(['one', 'two']);
    r.stop();
    expect(r.status()).toBe('idle');
    expect(f.isSpeaking()).toBe(false);
    expect(r.index()).toBe(0);
    expect(f.said).toEqual(['one']);
  });

  it('repeats the current sentence without skipping ahead', () => {
    const f = fakeSpeech();
    const r = createShelfReader(f.speech);
    r.start(['one', 'two']);
    f.finish();
    r.repeat();
    expect(f.said).toEqual(['one', 'two', 'two']);
    expect(r.index()).toBe(1);
    expect(r.status()).toBe('reading');
  });

  it('starts over from the top when repeating after it is done', () => {
    const f = fakeSpeech();
    const r = createShelfReader(f.speech);
    r.start(['one']);
    f.finish();
    expect(r.status()).toBe('done');
    r.repeat();
    expect(f.said).toEqual(['one', 'one']);
    expect(r.status()).toBe('reading');
  });

  it('skips a sentence the engine refuses instead of stalling', () => {
    const f = fakeSpeech((t) => t === 'two');
    const r = createShelfReader(f.speech);
    r.start(['one', 'two', 'three']);
    f.finish();
    expect(f.said).toEqual(['one', 'three']);
  });

  it('is done at once with nothing to read, and dispose stops listening', () => {
    const f = fakeSpeech();
    const r = createShelfReader(f.speech);
    r.start([]);
    expect(r.status()).toBe('done');
    r.dispose();
    expect(f.listenerCount()).toBe(0);
  });
});
