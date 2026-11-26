/**
 * Video frame timestamps (docs/06 §9.4, §9.5). The extractors in infrastructure/platform/media.*
 * label frames "Frame at m:ss" and sample at known times; this recovers each frame's real time,
 * keeps frames in order and labels them for the compiler.
 */
import type { VideoFrameArtifact } from './types';

/** "m:ss" for a time in milliseconds. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Seconds from a "Frame at m:ss" label, or undefined. */
export function parseFrameLabel(label: string | undefined): number | undefined {
  const m = /(\d+):([0-5]\d)\s*$/.exec(label ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

/** Evenly spaced sample times, centred in each slot (same rule as media-math.frameTimestamps). */
export function sampleTimesSec(durationSec: number, count: number): number[] {
  if (!(durationSec > 0)) return [0];
  const n = Math.max(1, Math.min(count, Math.ceil(durationSec)));
  return Array.from({ length: n }, (_, i) => Math.round(((durationSec * (i + 0.5)) / n) * 100) / 100);
}

/** Probe times the Android extractor uses when the picker reports no duration. */
export const PROBE_TIMES_SEC = [0.5, 2, 5, 10, 20, 40];

/**
 * Real time of each kept frame in milliseconds. A label "m:ss" is matched to the first unused sample
 * time with the same whole second; without a match the label's second is used.
 */
export function resolveFrameTimes(labels: Array<string | undefined>, candidatesSec: number[]): number[] {
  const used = new Set<number>();
  let floor = 0;
  return labels.map((label) => {
    const s = parseFrameLabel(label);
    const i = candidatesSec.findIndex((t, k) => !used.has(k) && (s === undefined ? t * 1000 >= floor : Math.floor(t) === s));
    let msAt: number;
    if (i >= 0) {
      used.add(i);
      msAt = Math.round(candidatesSec[i]! * 1000);
    } else {
      msAt = (s ?? floor / 1000) * 1000;
    }
    floor = Math.max(floor, msAt);
    return msAt;
  });
}

export interface FrameLike {
  id: string;
  width: number;
  height: number;
  label?: string;
}

/** Frame artifacts in time order. Negative or duplicate times are made strictly increasing. */
export function frameArtifacts(attachmentId: string, frames: readonly FrameLike[], timesMs: readonly number[]): VideoFrameArtifact[] {
  const rows = frames.map((f, i) => ({ f, t: Math.max(0, Math.round(timesMs[i] ?? 0)), i }));
  rows.sort((a, b) => a.t - b.t || a.i - b.i);
  let last = -1;
  return rows.map(({ f, t }) => {
    const timestampMs = t <= last ? last + 1 : t;
    last = timestampMs;
    return {
      id: `${attachmentId}.f${String(timestampMs)}`,
      attachmentId,
      assetId: f.id,
      timestampMs,
      width: Math.max(1, Math.round(f.width)),
      height: Math.max(1, Math.round(f.height)),
    };
  });
}

/** Candidate sample times for an extraction run, matching the extractor that produced the frames. */
export function candidateTimesSec(durationSec: number, maxFrames: number): number[] {
  return durationSec > 0 ? sampleTimesSec(durationSec, maxFrames) : PROBE_TIMES_SEC;
}
