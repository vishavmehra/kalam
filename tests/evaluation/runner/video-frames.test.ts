import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { NormalizedImage } from '@/core/contracts';
import { buildCompilerPrompt, frameTimeline } from '@/core/compiler/prompt';
import { parseArgs } from './cli';
import { modalityCaseInput } from './evaluate';
import type { GoldenModalityCase } from './types';

const golden = JSON.parse(readFileSync(new URL('../golden/modalities.json', import.meta.url), 'utf8')) as { cases: GoldenModalityCase[] };
const video = golden.cases.find((c) => c.id === 'mv01-video-tap-counter')!;
const frame = (i: number): NormalizedImage & { atSec: number } => ({
  id: `frame_${i}`, mimeType: 'image/jpeg', base64: '/9j/AAAA', width: 10, height: 10, source: 'video_frame', label: `Frame at 0:0${i * 3}`, atSec: i * 3,
});

describe('video cases from stills (D15-024)', () => {
  it('replaces the placeholder frames with the real ones and keeps their order and times', () => {
    const placeholder = modalityCaseInput(video);
    expect(placeholder.video!.frames.every((f) => f.base64.length < 200)).toBe(true);
    const real = modalityCaseInput(video, undefined, [frame(1), frame(2), frame(3)]);
    expect(real.video!.frames.map((f) => f.id)).toEqual(['frame_1', 'frame_2', 'frame_3']);
    expect(real.modalities).toContain('video');
    // What the compiler is told: images in order, each with its time in the video.
    expect(frameTimeline(real)).toEqual(['image 1 at 0:03', 'image 2 at 0:06', 'image 3 at 0:09']);
    expect(buildCompilerPrompt(real)).toContain('Frame times, in the order the person showed them');
  });

  it('parses --video-frames and needs the usual live budget', () => {
    expect(parseArgs(['--live', '--budget', '12', '--video-frames']).videoFrames).toBe(true);
    expect(parseArgs([]).videoFrames).toBe(false);
  });

  it('has a placeholder-free still set for every video case in the golden file', () => {
    const ids = golden.cases.filter((c) => c.modality === 'video').map((c) => c.id);
    expect(ids).toEqual([
      'mv01-video-tap-counter', 'mv02-video-inventory-walkthrough', 'mv03-video-plus-instruction', 'mv04-video-multi-role-tour', 'mv05-video-whiteboard-flow',
    ]);
  });
});
