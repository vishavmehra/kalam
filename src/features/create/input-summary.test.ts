import { describe, expect, it } from 'vitest';

import { loadCatalogue } from '@/i18n/catalogue';
import { createTranslator } from '@/i18n/translator';

import { answersToText, inputParts, inputPartsT, inputSummary, joinParts, sentenceCase } from './input-summary';

const img = (id: string) => ({ id, width: 10, height: 10, source: 'photo' as const, mimeType: 'image/jpeg' as const, base64: '' });
const base = { text: '', photos: [], voice: undefined, video: undefined, drawing: undefined };

describe('input summary', () => {
  it('is empty with no inputs', () => {
    expect(inputParts(base)).toEqual([]);
    expect(inputSummary(base)).toBe('');
  });

  it('lists every modality of a mixed creation in a fixed order', () => {
    const d = {
      text: 'A ledger',
      photos: [img('a'), img('b')],
      voice: { transcript: 'customer name and amount', recognizedBy: 'on_device' as const },
      video: { durationSec: 12, frames: [img('f')], droppedFrames: 0 },
      drawing: { title: 'Sketch', summary: { drawingId: 'd', pageCount: 1, elements: [], texts: [], images: [] } },
    };
    expect(inputParts(d)).toEqual(['text', 'voice', '2 photos', 'video', '1 drawing']);
    expect(inputSummary(d)).toBe('Text, voice, 2 photos, video and 1 drawing');
  });

  it('ignores blank text and transcripts and joins two parts with "and"', () => {
    const d = { ...base, text: '  ', voice: { transcript: ' ', recognizedBy: 'typed' as const }, photos: [img('a')] };
    expect(inputParts(d)).toEqual(['1 photo']);
    expect(joinParts(['text', 'voice'])).toBe('text and voice');
  });

  it('says the same parts in the UI language', () => {
    const { t, format } = createTranslator('en', { warn: false });
    const d = {
      text: 'A ledger', photos: [img('a')], voice: undefined, video: undefined,
      drawing: { title: 'Sketch', summary: { drawingId: 'd', pageCount: 3, elements: [], texts: [], images: [] } },
    };
    expect(inputPartsT(d, t)).toEqual(['text', '1 photo', 'a 3-screen drawing']);
    expect(sentenceCase(format.list(inputPartsT(d, t)))).toBe('Text, 1 photo and a 3-screen drawing');
    expect(sentenceCase('')).toBe('');
    expect(sentenceCase('फ़ोटो')).toBe('फ़ोटो');
  });

  it('says them in Hindi too, with no English left', async () => {
    await loadCatalogue('hi');
    const { t } = createTranslator('hi', { warn: false });
    const d = { ...base, text: 'A ledger', photos: [img('a'), img('b')], voice: { transcript: 'नाम', recognizedBy: 'typed' as const } };
    const parts = inputPartsT(d, t);
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p).toMatch(/[ऀ-ॿ]/);
    expect(parts.join(' ')).not.toMatch(/text|voice|photo/i);
  });
});

describe('clarifying answers', () => {
  it('turns answered questions into sentences and skips blanks', () => {
    expect(answersToText(['Who uses it?', 'Which currency?'], ['my staff', ''])).toBe('Who uses it? my staff.');
    expect(answersToText(['Which currency?'], ['Rupees.'])).toBe('Which currency? Rupees.');
    expect(answersToText(['A?'], ['  '])).toBe('');
  });
});
