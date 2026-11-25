import { describe, expect, it } from 'vitest';

import { answersToText, inputParts, inputSummary, joinParts } from './input-summary';

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
});

describe('clarifying answers', () => {
  it('turns answered questions into sentences and skips blanks', () => {
    expect(answersToText(['Who uses it?', 'Which currency?'], ['my staff', ''])).toBe('Who uses it? my staff.');
    expect(answersToText(['Which currency?'], ['Rupees.'])).toBe('Which currency? Rupees.');
    expect(answersToText(['A?'], ['  '])).toBe('');
  });
});
