import { describe, expect, it } from 'vitest';
import type { NormalizedImage } from '@/core/contracts';
import {
  base64Bytes, dedupeFrames, fitWithin, frameTimestamps, hammingDistance, luminanceHash, stripDataUrl,
} from './media-math';
import { buildNormalizedInput, creationInputRecord, draftBlocker, draftBlockerKey, draftModalities, type CreationDraft } from './normalize';

/** Solid or gradient RGBA test images. */
function image(w: number, h: number, px: (x: number, y: number) => number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = px(x, y); const i = (y * w + x) * 4;
      out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255;
    }
  }
  return out;
}

describe('image sizing', () => {
  it('fits the longest side within 1280 and never upscales', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1280, height: 960, scaled: true });
    expect(fitWithin(3024, 4032)).toEqual({ width: 960, height: 1280, scaled: true });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scaled: false });
    expect(fitWithin(1280, 1280)).toEqual({ width: 1280, height: 1280, scaled: false });
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0, scaled: false });
    expect(fitWithin(10000, 10)).toEqual({ width: 1280, height: 1, scaled: true });
  });

  it('handles data URLs and base64 sizes', () => {
    expect(stripDataUrl('data:image/jpeg;base64,QUJD')).toBe('QUJD');
    expect(stripDataUrl('QUJD')).toBe('QUJD');
    expect(base64Bytes('QUJD')).toBe(3);
    expect(base64Bytes('QUI=')).toBe(2);
  });
});

describe('video frame sampling', () => {
  it('spreads at most 6 frames across the clip, centred in each slot', () => {
    expect(frameTimestamps(60)).toEqual([5, 15, 25, 35, 45, 55]);
    expect(frameTimestamps(2)).toEqual([0.5, 1.5]);
    expect(frameTimestamps(0)).toEqual([0]);
    expect(frameTimestamps(0.4)).toEqual([0.2]);
  });
});

describe('luminance hash + dedupe', () => {
  const gradient = image(64, 48, (x) => (x * 4) % 256);
  const reversed = image(64, 48, (x) => 255 - ((x * 4) % 256));

  it('is stable under brightness noise and distinguishes different frames', () => {
    const noisy = image(64, 48, (x, y) => Math.min(255, ((x * 4) % 256) + ((x + y) % 3)));
    const a = luminanceHash(gradient, 64, 48);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingDistance(a, luminanceHash(noisy, 64, 48))).toBeLessThan(6);
    expect(hammingDistance(a, luminanceHash(reversed, 64, 48))).toBeGreaterThan(40);
    expect(hammingDistance('ff', 'f')).toBe(8);
  });

  it('drops near-duplicate frames but keeps distinct ones', () => {
    const hA = luminanceHash(gradient, 64, 48);
    const hB = luminanceHash(reversed, 64, 48);
    const kept = dedupeFrames([{ id: 1, hash: hA }, { id: 2, hash: hA }, { id: 3, hash: hB }, { id: 4, hash: hA }]);
    expect(kept.map((f) => f.id)).toEqual([1, 3]);
  });
});

describe('NormalizedInput assembly', () => {
  const img = (id: string): NormalizedImage =>
    ({ id, mimeType: 'image/jpeg', base64: 'AAAA', width: 10, height: 10, source: 'photo' });
  const empty: CreationDraft = { text: '', photos: [], preferences: { language: 'en' } };

  it('blocks empty drafts with a plain explanation', () => {
    expect(draftBlocker(empty)).toMatch(/Describe your app/);
    expect(draftBlocker({ ...empty, text: '   ' })).toBeDefined();
    expect(draftBlocker({ ...empty, text: 'a calculator' })).toBeUndefined();
    expect(draftBlocker({ ...empty, text: 'x'.repeat(4001) })).toMatch(/4000/);
  });

  it('collects every modality and preferences without raw media', () => {
    const draft: CreationDraft = {
      text: '  Tailor order book ',
      photos: [img('p1'), img('p2'), img('p3'), img('p4'), img('p5')],
      voice: { transcript: 'with delivery date', audioUri: 'blob:local', recognizedBy: 'on_device' },
      video: { durationSec: 30, frames: [img('f1')], droppedFrames: 2 },
      drawing: { title: 'Sketch', summary: { drawingId: 'drw_1', pageCount: 1, elements: [{ kind: 'stamp:list', page: 1, bbox: [0, 0, 1, 1] }], texts: [], images: [] } },
      preferences: { language: 'hi', themePreset: 'warm_paper', currency: 'INR' },
    };
    const input = buildNormalizedInput(draft);
    expect(input.text).toBe('Tailor order book');
    expect(input.modalities).toEqual(['text', 'image', 'audio', 'video', 'drawing']);
    expect(input.images).toHaveLength(4);
    expect(input.audioTranscript).toBe('with delivery date');
    expect(input.video).toEqual({ frames: [img('f1')], durationSec: 30 });
    expect(input.drawing?.drawingId).toBe('drw_1');
    expect(input.language).toBe('hi');
    expect(input.preferences).toEqual({ themePreset: 'warm_paper', currency: 'INR' });
    expect(JSON.stringify(input)).not.toContain('blob:local');
    expect(creationInputRecord(draft)).toEqual({
      text: 'Tailor order book', modalities: ['text', 'image', 'audio', 'video', 'drawing'], drawingId: 'drw_1',
    });
  });

  it('keeps a voice-only transcript separate from the typed text', () => {
    const draft: CreationDraft = { ...empty, voice: { transcript: 'a kirana udhaar ledger', recognizedBy: 'cloud_service' } };
    const input = buildNormalizedInput(draft);
    expect(input.text).toBe('');
    expect(input.audioTranscript).toBe('a kirana udhaar ledger');
    expect(draftBlocker(draft)).toBeUndefined();
    expect(input.modalities).toEqual(['audio']);
    expect(input.preferences).toBeUndefined();
    expect(draftModalities({ ...empty, drawing: { title: 'x', summary: { drawingId: 'd', pageCount: 1, elements: [], texts: [], images: [] } } })).toEqual([]);
  });
});

describe('draft blocker', () => {
  it('the English wording and the translated key always agree', () => {
    const empty: CreationDraft = { text: '', photos: [], preferences: { language: 'en' } };
    for (const d of [empty, { ...empty, text: '  ' }, { ...empty, text: 'a ledger' }, { ...empty, text: 'x'.repeat(4001) }]) {
      expect(draftBlocker(d) === undefined, d.text.slice(0, 10)).toBe(draftBlockerKey(d) === undefined);
    }
    expect(draftBlockerKey({ ...empty, text: 'x'.repeat(4001) })).toBe('create.ws.blockLong');
  });
});
