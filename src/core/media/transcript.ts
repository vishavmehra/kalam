/**
 * Transcripts (docs/06 §8.4, §8.5) and pause-and-resume dictation timing (docs/06 §8.1). The first
 * machine text is kept as `original`; edits never overwrite it.
 */
import type { AudioTranscript, TranscriptSegment } from './types';
import type { DetectedLanguage } from './language';

const MAX = 20_000;

export function createTranscript(
  attachmentId: string,
  text: string,
  opts: { source: 'device' | 'cloud'; segments?: TranscriptSegment[]; language?: DetectedLanguage; partial?: boolean },
): AudioTranscript {
  const clean = text.trim().slice(0, MAX);
  return {
    attachmentId,
    text: clean,
    original: clean,
    source: opts.source,
    status: !clean ? 'failed' : opts.partial ? 'partial' : 'complete',
    ...(opts.segments?.length ? { segments: opts.segments.slice(0, 500) } : {}),
    ...(opts.language ? { language: opts.language.code, languageSource: opts.language.source } : {}),
  };
}

/** A transcript the person typed because no recogniser could read the file. */
export function typedTranscript(attachmentId: string, text: string): AudioTranscript {
  const clean = text.slice(0, MAX);
  return { attachmentId, text: clean, original: '', source: 'user_edited', status: clean.trim() ? 'complete' : 'failed' };
}

/** The person's edit. Returning to the original text restores the machine source. */
export function editTranscript(t: AudioTranscript, text: string, machineSource: 'device' | 'cloud' = 'device'): AudioTranscript {
  const next = text.slice(0, MAX);
  const backToOriginal = !!t.original && next === t.original;
  return {
    ...t,
    text: next,
    source: backToOriginal ? machineSource : 'user_edited',
    status: next.trim() ? (t.status === 'partial' && backToOriginal ? 'partial' : 'complete') : 'failed',
  };
}

export const wasEdited = (t: AudioTranscript) => !!t.original && t.text !== t.original;

/** Joined text of all segments. */
export const segmentsText = (segments: readonly TranscriptSegment[]) =>
  segments.map((s) => s.text.trim()).filter(Boolean).join(' ');

/**
 * Dictation clock across pauses. Recognition is stopped on pause and started again on resume, so each
 * listening stretch becomes one segment with times relative to the start of the session.
 */
export interface DictationClock {
  /** Listening time before the current stretch. */
  elapsedMs: number;
  /** When the current stretch started (wall clock), or undefined while paused. */
  runningSince?: number;
}

export const startClock = (now: number): DictationClock => ({ elapsedMs: 0, runningSince: now });

export function pauseClock(c: DictationClock, now: number): DictationClock {
  if (c.runningSince === undefined) return c;
  return { elapsedMs: c.elapsedMs + Math.max(0, now - c.runningSince) };
}

export function resumeClock(c: DictationClock, now: number): DictationClock {
  return c.runningSince === undefined ? { elapsedMs: c.elapsedMs, runningSince: now } : c;
}

export const clockMs = (c: DictationClock, now: number) => c.elapsedMs + (c.runningSince === undefined ? 0 : Math.max(0, now - c.runningSince));

/** Closes the current stretch as a segment (empty text adds nothing). */
export function closeSegment(segments: readonly TranscriptSegment[], text: string, startMs: number, endMs: number): TranscriptSegment[] {
  const clean = text.trim();
  if (!clean) return [...segments];
  return [...segments, { text: clean, startMs: Math.max(0, Math.round(startMs)), endMs: Math.max(Math.round(startMs), Math.round(endMs)) }].slice(-500);
}
