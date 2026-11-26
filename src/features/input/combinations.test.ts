/**
 * Input combinations (docs/06 §18.6, docs/13 §5.7): every pair of inputs the document lists, then three and four at
 * once. For each: which inputs the compiler is told about, in what order the pictures go, that nothing is
 * duplicated or dropped silently, and that a file that failed never costs the others.
 */
import { describe, expect, it } from 'vitest';
import type { NormalizedImage } from '@/core/contracts';
import type { InputModality } from '@/core/contracts';
import { addAttachment, createSession, imageBudget, prepareHandoff, sessionAddsInput, setTranscript, updateAttachment } from '@/core/session';
import { buildSends } from '@/features/queue/snapshot';
import { createBlocker } from '@/features/media/create-bridge';
import { buildNormalizedInput, draftModalities, type CreationDraft } from './normalize';

const img = (id: string, source: NormalizedImage['source']): NormalizedImage => ({ id, mimeType: 'image/jpeg', base64: 'AA', width: 8, height: 8, source });

type Piece = 'text' | 'image' | 'audio' | 'video' | 'drawing';
const PIECES: Record<Piece, Partial<CreationDraft>> = {
  text: { text: 'A credit book for my shop' },
  image: { photos: [img('p1', 'photo')] },
  audio: { voice: { transcript: 'add customer name and amount', recognizedBy: 'on_device', durationSec: 4 } },
  video: { video: { name: 'clip', durationSec: 8, droppedFrames: 0, frames: [img('vf1', 'video_frame'), img('vf2', 'video_frame')] } },
  drawing: {
    drawing: {
      title: 'Sketch',
      summary: { drawingId: 'd1', pageCount: 1, elements: [{ kind: 'box', page: 0, bbox: [0, 0, 1, 1], label: 'Name' }], texts: ['Name'], images: [img('dp1', 'drawing')] },
    },
  },
};
const ORDER: Piece[] = ['text', 'image', 'audio', 'video', 'drawing'];
const MODALITY: Record<Piece, InputModality> = { text: 'text', image: 'image', audio: 'audio', video: 'video', drawing: 'drawing' };

const draftOf = (...pieces: Piece[]): CreationDraft => ({ text: '', photos: [], preferences: { language: 'en' }, ...Object.assign({}, ...pieces.map((p) => PIECES[p])) });

const PAIRS: Array<[Piece, Piece]> = [
  ['text', 'image'], ['text', 'audio'], ['text', 'video'], ['text', 'drawing'], ['image', 'audio'],
  ['image', 'video'], ['image', 'drawing'], ['audio', 'drawing'], ['video', 'drawing'],
];

describe('two inputs at once', () => {
  it.each(PAIRS)('%s with %s: both reach the compiler, once, in the documented order', (a, b) => {
    const d = draftOf(a, b);
    const input = buildNormalizedInput(d);
    expect(input.modalities).toEqual(ORDER.filter((p) => p === a || p === b).map((p) => MODALITY[p]));
    expect(draftModalities(d)).toEqual(input.modalities);
    expect(createBlocker(d, undefined)).toBeUndefined();
    // Typed words and spoken words travel in their own fields and are never copied into each other.
    expect(input.text).toBe(a === 'text' || b === 'text' ? PIECES.text.text : '');
    expect(input.audioTranscript).toBe(a === 'audio' || b === 'audio' ? PIECES.audio.voice!.transcript : undefined);
    expect(input.text).not.toContain('add customer');
    expect(input.images.map((i) => i.id)).toEqual(a === 'image' || b === 'image' ? ['p1'] : []);
    expect(!!input.video).toBe(a === 'video' || b === 'video');
    expect(!!input.drawing).toBe(a === 'drawing' || b === 'drawing');
  });

  it.each(PAIRS)('%s with %s: says honestly what a cloud build would send', (a, b) => {
    const sends = buildSends(draftOf(a, b));
    const want: Record<Piece, string> = { text: 'text', image: 'photos', audio: 'voice_text', video: 'video_frames', drawing: 'drawing' };
    expect(sends).toEqual(ORDER.filter((p) => p === a || p === b).map((p) => want[p]));
  });

  it.each(PAIRS)('%s with %s: fits the compiler picture budget with nothing left out', (a, b) => {
    const budget = imageBudget(prepareHandoff(buildNormalizedInput(draftOf(a, b)), createSession('s_1', 1)).input);
    expect(budget.excluded).toEqual([]);
    expect(budget.notice).toBeUndefined();
  });
});

describe('three and four inputs at once', () => {
  it('all five together still reads once each, and the pictures go drawing pages, photos, then video frames', () => {
    const d = draftOf('text', 'image', 'audio', 'video', 'drawing');
    const input = buildNormalizedInput(d);
    expect(input.modalities).toEqual(['text', 'image', 'audio', 'video', 'drawing']);
    expect(imageBudget(input).includedIds).toEqual(['dp1', 'p1', 'vf1', 'vf2']);
  });

  it('names what does not fit when pictures from several inputs pass the limit', () => {
    const d = draftOf('text', 'image', 'video', 'drawing');
    d.photos = ['p1', 'p2', 'p3', 'p4'].map((id) => img(id, 'photo'));
    const { input, notices } = prepareHandoff(buildNormalizedInput(d), createSession('s_1', 1));
    expect(imageBudget(input).includedIds).toHaveLength(6);
    expect(imageBudget(input).excluded.map((e) => e.id)).toEqual(['vf2']);
    expect(notices.join(' ')).toMatch(/1 video frame/);
  });

  it('three inputs keep their own text fields apart', () => {
    const input = buildNormalizedInput(draftOf('text', 'audio', 'drawing'));
    expect(input.text).toBe('A credit book for my shop');
    expect(input.audioTranscript).toBe('add customer name and amount');
    expect(input.drawing?.drawingId).toBe('d1');
  });
});

describe('a file that failed never costs the other inputs', () => {
  const failedRecording = () => {
    let s = addAttachment(createSession('s_1', 1), { id: 'a1', type: 'audio', mimeType: 'audio/mp4', sizeBytes: 9, status: 'ready', createdAt: 1, updatedAt: 1 }, 2).session;
    s = setTranscript(s, { attachmentId: 'a1', text: 'words that must not be used', original: 'x', source: 'device', status: 'complete' }, 3);
    return updateAttachment(s, 'a1', { status: 'failed' }, 4);
  };

  it('leaves out a failed recording and keeps the typed text and the photo', () => {
    const input = prepareHandoff(buildNormalizedInput(draftOf('text', 'image')), failedRecording()).input;
    expect(input.audioTranscript).toBeUndefined();
    expect(input.modalities).toEqual(['text', 'image']);
    expect(input.text).toBe('A credit book for my shop');
  });

  it('a failed recording alone gives the create button nothing to build from', () => {
    expect(sessionAddsInput(failedRecording())).toBe(false);
    expect(createBlocker(draftOf(), failedRecording())).toBeTruthy();
  });

  it('a good recording next to a failed one is still heard', () => {
    let s = failedRecording();
    s = addAttachment(s, { id: 'a2', type: 'audio', mimeType: 'audio/mp4', sizeBytes: 9, status: 'ready', createdAt: 1, updatedAt: 1 }, 5).session;
    s = setTranscript(s, { attachmentId: 'a2', text: 'milk sales', original: 'milk sales', source: 'device', status: 'complete' }, 6);
    const input = prepareHandoff(buildNormalizedInput(draftOf('text')), s).input;
    expect(input.audioTranscript).toContain('milk sales');
    expect(input.audioTranscript).not.toContain('must not be used');
  });
});
