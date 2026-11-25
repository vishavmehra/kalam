import { describe, expect, it, vi } from 'vitest';
import { createSpeechQueue, SPEECH_PRIORITY } from './tts-queue';
import {
  chooseVoice, chunkForSpeech, clampRate, languageBase, normalizeLanguageTag, normalizeSpeechText, voicesForLanguage,
  type SpeakOptions, type SpeechVoice, type TextToSpeechAdapter,
} from './tts.shared';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** An adapter whose utterances end only when the test says so. */
function fakeAdapter(opts: { failFirst?: boolean } = {}) {
  const calls: Array<{ text: string; options?: SpeakOptions; end(): void }> = [];
  let failed = false;
  const stop = vi.fn(async () => undefined);
  const adapter: TextToSpeechAdapter = {
    isAvailable: async () => true,
    getVoices: async () => [],
    speak: (text, options) => {
      if (opts.failFirst && !failed) {
        failed = true;
        calls.push({ text, options, end: () => undefined });
        return Promise.reject(new Error('no voice'));
      }
      return new Promise<void>((resolve) => calls.push({ text, options, end: resolve }));
    },
    stop,
  };
  return { adapter, calls, stop, spoken: () => calls.map((c) => c.text) };
}

function setup(extra: { failFirst?: boolean; maxPending?: number } = {}) {
  const f = fakeAdapter(extra);
  let t = 1000;
  const queue = createSpeechQueue({ adapter: f.adapter, now: () => t, maxPending: extra.maxPending });
  return { ...f, queue, advance: (ms: number) => { t += ms; } };
}

describe('speech queue', () => {
  it('speaks lines one at a time, in order', async () => {
    const { queue, calls, spoken } = setup();
    expect(queue.say({ text: 'First line' })).toBe(true);
    expect(queue.say({ text: 'Second line' })).toBe(true);
    expect(spoken()).toEqual(['First line']);
    expect(queue.isSpeaking()).toBe(true);
    expect(queue.pendingCount()).toBe(1);
    calls[0]!.end();
    await flush();
    expect(spoken()).toEqual(['First line', 'Second line']);
    calls[1]!.end();
    await flush();
    expect(queue.isSpeaking()).toBe(false);
  });

  it('drops a line that was just said, then allows it again after the window', async () => {
    const { queue, calls, advance } = setup();
    queue.say({ text: 'Saved' });
    expect(queue.say({ text: 'Saved' })).toBe(false); // playing
    queue.say({ text: 'Next' });
    expect(queue.say({ text: 'Next' })).toBe(false); // waiting
    calls[0]!.end();
    await flush();
    calls[1]!.end();
    await flush();
    expect(queue.say({ text: 'Next' })).toBe(false); // finished moments ago
    advance(2500);
    expect(queue.say({ text: 'Next' })).toBe(true);
  });

  it('keeps only the newest of rapid navigation lines', async () => {
    const { queue, calls, spoken } = setup();
    queue.say({ text: 'Result line' });
    queue.say({ text: 'Screen one', priority: 'navigation' });
    queue.say({ text: 'Screen two', priority: 'navigation' });
    queue.say({ text: 'Screen three', priority: 'info' });
    expect(queue.pendingCount()).toBe(1);
    calls[0]!.end();
    await flush();
    expect(spoken()).toEqual(['Result line', 'Screen three']);
  });

  it('lets an error cut in front of a screen title, and drops the stale lines behind it', async () => {
    const { queue, calls, stop, spoken } = setup();
    queue.say({ text: 'Orders screen', priority: 'navigation' });
    queue.say({ text: 'Hint', priority: 'info' });
    queue.say({ text: 'Chest is required', priority: 'critical' });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(spoken()).toEqual(['Orders screen', 'Chest is required']);
    expect(queue.pendingCount()).toBe(0);
    calls[0]!.end(); // the cut-off utterance ending late must not disturb the new one
    await flush();
    expect(queue.isSpeaking()).toBe(true);
  });

  it('does not interrupt for a less urgent line', async () => {
    const { queue, stop, spoken } = setup();
    queue.say({ text: 'Delete this order?', priority: 'critical' });
    queue.say({ text: 'Screen title', priority: 'navigation' });
    expect(stop).not.toHaveBeenCalled();
    expect(spoken()).toEqual(['Delete this order?']);
  });

  it('caps how many lines wait, dropping the oldest of the least urgent', async () => {
    const { queue, calls, spoken } = setup({ maxPending: 3 });
    queue.say({ text: 'Now' });
    for (const t of ['A', 'B', 'C', 'D']) queue.say({ text: t });
    expect(queue.pendingCount()).toBe(3);
    for (let i = 0; i < 4; i++) {
      calls[i]!.end();
      await flush();
    }
    expect(spoken()).toEqual(['Now', 'B', 'C', 'D']);
  });

  it('replaces a waiting line with the same key and cuts off a playing one', async () => {
    const { queue, stop, spoken } = setup();
    queue.say({ text: 'Orders. You can say: New order.', priority: 'navigation', key: 'screen' });
    queue.say({ text: 'New order. Fields: Customer.', priority: 'navigation', key: 'screen' });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(spoken()).toEqual(['Orders. You can say: New order.', 'New order. Fields: Customer.']);
  });

  it('stop() silences everything and ignores the old utterance finishing', async () => {
    const { queue, calls, stop, spoken } = setup();
    queue.say({ text: 'One' });
    queue.say({ text: 'Two' });
    queue.stop();
    expect(stop).toHaveBeenCalled();
    expect(queue.isSpeaking()).toBe(false);
    expect(queue.pendingCount()).toBe(0);
    queue.say({ text: 'Three' });
    calls[0]!.end(); // late end of "One"
    await flush();
    expect(queue.isSpeaking()).toBe(true);
    expect(spoken()).toEqual(['One', 'Three']);
  });

  it('repeats the last line, even right after it was said', async () => {
    const { queue, calls, spoken } = setup();
    expect(queue.repeatLast()).toBe(false);
    queue.say({ text: 'Order saved', rate: 1.25, language: 'hi-IN' });
    calls[0]!.end();
    await flush();
    expect(queue.lastText()).toBe('Order saved');
    expect(queue.repeatLast()).toBe(true);
    expect(spoken()).toEqual(['Order saved', 'Order saved']);
    expect(calls[1]!.options).toMatchObject({ rate: 1.25, language: 'hi-IN' });
  });

  it('interrupt: true replaces whatever is playing and waiting', async () => {
    const { queue, spoken } = setup();
    queue.say({ text: 'Long answer' });
    queue.say({ text: 'Waiting' });
    queue.say({ text: 'Say confirm or cancel.', interrupt: true, priority: 'critical' });
    expect(spoken()).toEqual(['Long answer', 'Say confirm or cancel.']);
    expect(queue.pendingCount()).toBe(0);
  });

  it('keeps going when the voice fails', async () => {
    const { queue, spoken } = setup({ failFirst: true });
    queue.say({ text: 'Broken' });
    queue.say({ text: 'Fine' });
    await flush();
    await flush();
    expect(spoken()).toEqual(['Broken', 'Fine']);
  });

  it('ignores empty text and tells listeners when speech starts and ends', async () => {
    const { queue, calls } = setup();
    const seen: boolean[] = [];
    queue.subscribe((s) => seen.push(s));
    expect(queue.say({ text: '  **  ' })).toBe(false);
    queue.say({ text: 'Hello' });
    calls[0]!.end();
    await flush();
    expect(seen).toEqual([true, false]);
  });

  it('orders by the documented priorities', () => {
    expect(SPEECH_PRIORITY.critical).toBeLessThan(SPEECH_PRIORITY.completion);
    expect(SPEECH_PRIORITY.completion).toBeLessThan(SPEECH_PRIORITY.result);
    expect(SPEECH_PRIORITY.result).toBeLessThan(SPEECH_PRIORITY.navigation);
    expect(SPEECH_PRIORITY.navigation).toBeLessThan(SPEECH_PRIORITY.info);
  });
});

describe('speech text helpers', () => {
  it('cleans markup and caps length at a sentence end', () => {
    expect(normalizeSpeechText('  **Saved**  \n the `order`  ')).toBe('Saved the order');
    const long = `${'Word. '.repeat(200)}`;
    const out = normalizeSpeechText(long);
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out.endsWith('.')).toBe(true);
  });

  it('splits long text into sentence chunks without losing words', () => {
    const text = 'You can say: New order, Save or Reports. To fill in a field, say its name and the value. Fields: Customer, Chest, Garment and 2 more. Say help for the rest.';
    const chunks = chunkForSpeech(text, 60);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.length <= 60)).toBe(true);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text);
    expect(chunkForSpeech('Short.')).toEqual(['Short.']);
    expect(chunkForSpeech('   ')).toEqual([]);
  });

  it('splits a single huge sentence on spaces', () => {
    const chunks = chunkForSpeech('word '.repeat(100).trim(), 50);
    expect(chunks.every((c) => c.length <= 50)).toBe(true);
    expect(chunks.join(' ').split(' ').length).toBe(100);
  });

  it('normalises language tags, including three-letter Android codes', () => {
    expect(normalizeLanguageTag('hin-IND')).toBe('hi-IN');
    expect(normalizeLanguageTag('en_us')).toBe('en-US');
    expect(normalizeLanguageTag('guj')).toBe('gu');
    expect(languageBase('ta-IN')).toBe('ta');
    expect(normalizeLanguageTag(undefined)).toBe('');
  });

  it('clamps the speaking rate to 0.5 to 2', () => {
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(9)).toBe(2);
    expect(clampRate(undefined)).toBe(1);
    expect(clampRate(Number.NaN)).toBe(1);
    expect(clampRate(1.25)).toBe(1.25);
  });
});

describe('voice choice', () => {
  const voices: SpeechVoice[] = [
    { id: 'a', name: 'Online Hindi', language: 'hi-IN', local: false },
    { id: 'b', name: 'Device Hindi', language: 'hi-IN', local: true },
    { id: 'c', name: 'US English', language: 'en-US', local: true },
    { id: 'd', name: 'Indian English', language: 'en-IN', local: true, isDefault: true },
  ];

  it('uses the voice the person picked', () => {
    expect(chooseVoice(voices, { voiceId: 'a', language: 'hi-IN' })).toMatchObject({ match: 'voice', voice: { id: 'a' } });
  });

  it('prefers an on-device voice for an exact language', () => {
    expect(chooseVoice(voices, { language: 'hi-IN' })).toMatchObject({ match: 'language', voice: { id: 'b' } });
  });

  it('says when only another region is installed', () => {
    expect(chooseVoice(voices, { language: 'en-GB' })).toMatchObject({ match: 'language_base', voice: { id: 'd' } });
  });

  it('never picks a voice for a language that is not installed', () => {
    expect(chooseVoice(voices, { language: 'ta-IN' })).toEqual({ match: 'none' });
    expect(chooseVoice(voices, {})).toEqual({ match: 'none' });
    expect(chooseVoice(voices, { voiceId: 'gone', language: 'ta-IN' })).toEqual({ match: 'none' });
  });

  it('lists voices for a language, best first', () => {
    expect(voicesForLanguage(voices, 'hi-IN').map((v) => v.id)).toEqual(['b', 'a']);
    expect(voicesForLanguage(voices, 'en').map((v) => v.id)).toEqual(['d', 'c']);
  });
});
