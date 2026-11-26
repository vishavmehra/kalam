/**
 * Dictation with pause and resume (docs/06 §2.3, §8.1). Recognition is stopped on pause and started
 * again on resume; each listening stretch becomes a timed segment (docs/06 §8.4). Works wherever
 * `startDictation` works (web, Android, iOS). Recordings follow `keepRecording` per stretch.
 *
 * The platform's "end" event arrives some time after stop(). Each stretch keeps its own text, start
 * and end in a closure, so a late end never loses the paused stretch's words and never touches the
 * next stretch. Resume waits (briefly) for the previous end before listening again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { closeSegment, clockMs, pauseClock, resumeClock, segmentsText, startClock, type DictationClock } from '@/core/media/transcript';
import type { TranscriptSegment } from '@/core/media/types';
import { startDictation, type DictationSession } from '@/infrastructure/platform/speech';

export type DictationState = 'idle' | 'listening' | 'paused';

export interface SegmentedDictationOptions {
  lang: string;
  onDevice: boolean;
  keepRecording?: boolean;
  hints?: string[];
}

interface Stretch {
  startMs: number;
  /** Set when pause or stop is pressed, so a late end event keeps the right end time. */
  endMs?: number;
  text: string;
  session?: DictationSession;
  ended: Promise<void>;
}

/** How long resume waits for the previous stretch's end event before listening anyway. */
const END_WAIT_MS = 1500;

export function useSegmentedDictation(opts: SegmentedDictationOptions) {
  const [state, setState] = useState<DictationState>('idle');
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [live, setLive] = useState('');
  const [error, setError] = useState<string>();
  const [recordings, setRecordings] = useState<string[]>([]);
  const [location, setLocation] = useState<DictationSession['location']>();
  const current = useRef<Stretch | undefined>(undefined);
  const clock = useRef<DictationClock>({ elapsedMs: 0 });
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const listen = useCallback(async () => {
    setError(undefined);
    setLive('');
    let markEnded: () => void = () => undefined;
    const stretch: Stretch = { startMs: clockMs(clock.current, Date.now()), text: '', ended: new Promise<void>((r) => { markEnded = r; }) };
    current.current = stretch;
    try {
      const o = optsRef.current;
      stretch.session = await startDictation({
        lang: o.lang,
        onDevice: o.onDevice,
        ...(o.keepRecording ? { keepRecording: true } : {}),
        ...(o.hints?.length ? { hints: o.hints } : {}),
        onText: (text) => {
          stretch.text = text;
          if (current.current === stretch) setLive(text);
        },
        onError: (message) => {
          if (current.current === stretch) setError(message);
        },
        onEnd: ({ audioUri }) => {
          const end = stretch.endMs ?? clockMs(clock.current, Date.now());
          setSegments((prev) => closeSegment(prev, stretch.text, stretch.startMs, end));
          if (audioUri) setRecordings((r) => [...r, audioUri]);
          if (current.current === stretch) {
            current.current = undefined;
            setLive('');
          }
          markEnded();
        },
      });
      setLocation(stretch.session.location);
      setState('listening');
    } catch (e) {
      markEnded();
      if (current.current === stretch) current.current = undefined;
      setError(e instanceof Error ? e.message : undefined);
      clock.current = pauseClock(clock.current, Date.now());
      setState('idle');
    }
  }, []);

  /** Ends the running stretch: its end time is taken now, its words arrive with the end event. */
  const endStretch = useCallback(() => {
    const s = current.current;
    if (s && s.endMs === undefined) s.endMs = clockMs(clock.current, Date.now());
    s?.session?.stop();
    clock.current = pauseClock(clock.current, Date.now());
  }, []);

  /** `over` applies to this start only: the screen may learn where it can listen in the same tap. */
  const start = useCallback(async (over?: Partial<SegmentedDictationOptions>) => {
    if (over) optsRef.current = { ...optsRef.current, ...over };
    setSegments([]);
    setRecordings([]);
    clock.current = startClock(Date.now());
    await listen();
  }, [listen]);

  const pause = useCallback(() => {
    endStretch();
    setState('paused');
  }, [endStretch]);

  const resume = useCallback(async () => {
    const previous = current.current;
    if (previous) await Promise.race([previous.ended, new Promise((r) => setTimeout(r, END_WAIT_MS))]);
    clock.current = resumeClock(clock.current, Date.now());
    await listen();
  }, [listen]);

  const stop = useCallback(() => {
    endStretch();
    setState('idle');
  }, [endStretch]);

  useEffect(() => () => current.current?.session?.abort(), []);

  const transcript = [segmentsText(segments), live.trim()].filter(Boolean).join(' ');
  const elapsedMs = useCallback(() => clockMs(clock.current, Date.now()), []);
  return { state, segments, transcript, error, recordings, location, elapsedMs, start, pause, resume, stop };
}
