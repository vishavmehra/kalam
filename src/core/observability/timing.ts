/**
 * Content-free timing events (docs/09 §22: app open, spec validation and record write durations).
 *
 * An event is a name from a closed list, a duration in milliseconds, a clock time, whether it worked,
 * and optionally a count of items. There is no field that could carry an id, a record value, a prompt
 * or a file name, and the functions copy only those fields from what they are given. Events live in a
 * bounded in-memory ring, are never written to disk and are never sent anywhere. A diagnostics view
 * reads them with `events()` or `summarize()`.
 *
 * The ring keeps up to `capacity` events for each name, so a burst of one kind (a backup import
 * validates every app) cannot push every other kind out of the medians.
 */
import { notifyAll } from './notify';

export const TIMING_NAMES = [
  'app_open', 'spec_validate', 'record_write',
  // Local media steps (docs/06 §17.3). Model time is not here: it is the latency on each inference event.
  'attachment_intake', 'media_validate', 'media_preprocess', 'thumbnail', 'audio_transcribe', 'video_frames', 'drawing_export',
  'context_assemble', 'request_prepare',
] as const;
export type TimingName = (typeof TIMING_NAMES)[number];

export interface TimingEvent {
  readonly name: TimingName;
  /** Duration in milliseconds, one decimal. */
  readonly ms: number;
  /** Epoch milliseconds when it finished. */
  readonly at: number;
  readonly ok: boolean;
  /** How many items the step handled, when that is useful (for example fields checked). */
  readonly count?: number;
}

/** The only things a caller may add. Any other property is ignored. */
export interface TimingOptions {
  ok?: boolean;
  count?: number;
}

export interface TimingSummary {
  readonly name: TimingName;
  readonly runs: number;
  readonly failed: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

export interface RunningTiming {
  /** Records the duration. A second call does nothing. Returns the event, or undefined if not kept. */
  stop(options?: TimingOptions): TimingEvent | undefined;
}

export interface TimingLog {
  record(name: TimingName, ms: number, options?: TimingOptions): TimingEvent | undefined;
  start(name: TimingName): RunningTiming;
  /**
   * Times `fn`. A promise is awaited; a throw or rejection is recorded as failed and rethrown.
   * `worked` marks a returned value as a failure, for steps that report failure as a value (a transcript result).
   */
  time<T>(name: TimingName, fn: () => Promise<T>, worked?: (value: T) => boolean): Promise<T>;
  time<T>(name: TimingName, fn: () => T, worked?: (value: T) => boolean): T;
  /** Oldest first. */
  events(): readonly TimingEvent[];
  /** One row per name that has at least one event, in the order of `TIMING_NAMES`. */
  summarize(): TimingSummary[];
  clear(): void;
  subscribe(listener: () => void): () => void;
  /** Changes whenever the ring changes (for `useSyncExternalStore`). */
  version(): number;
}

/** Events kept per name. */
export const TIMING_RING_SIZE = 50;
const MAX_MS = 60 * 60 * 1000;
const MAX_COUNT = 1_000_000_000;
const NAMES: ReadonlySet<string> = new Set(TIMING_NAMES);

const defaultClock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Nearest-rank percentile of an ascending list. */
const rank = (sorted: readonly number[], p: number): number =>
  sorted[Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length))) - 1];

const isPromiseLike = (v: unknown): v is PromiseLike<unknown> =>
  typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';

export interface TimingLogOptions {
  /** Events kept per name. At least 1. */
  capacity?: number;
  /** Monotonic milliseconds, for durations. */
  clock?: () => number;
  /** Epoch milliseconds, for `at`. */
  wall?: () => number;
}

export function createTimingLog({ capacity: wanted = TIMING_RING_SIZE, clock = defaultClock, wall = Date.now }: TimingLogOptions = {}): TimingLog {
  const capacity = Number.isFinite(wanted) ? Math.max(1, Math.floor(wanted)) : TIMING_RING_SIZE;
  let ring: TimingEvent[] = [];
  let version = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    version += 1;
    notifyAll(listeners);
  };

  function record(name: TimingName, ms: number, options?: TimingOptions): TimingEvent | undefined {
    if (!NAMES.has(name) || typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined;
    const count = options?.count;
    const event: TimingEvent = {
      name,
      ms: Math.round(Math.min(ms, MAX_MS) * 10) / 10,
      at: wall(),
      ok: options?.ok !== false,
      ...(typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= MAX_COUNT ? { count } : {}),
    };
    ring = [...ring, event];
    const mine = ring.filter((e) => e.name === name);
    if (mine.length > capacity) ring = ring.filter((e) => e !== mine[0]);
    changed();
    return event;
  }

  function start(name: TimingName): RunningTiming {
    const began = clock();
    let done = false;
    return {
      stop(options) {
        if (done) return undefined;
        done = true;
        return record(name, clock() - began, options);
      },
    };
  }

  function time<T>(name: TimingName, fn: () => T | Promise<T>, worked?: (value: T) => boolean): T | Promise<T> {
    const running = start(name);
    let result: T | Promise<T>;
    try {
      result = fn();
    } catch (error) {
      running.stop({ ok: false });
      throw error;
    }
    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(
        (value) => {
          running.stop(worked && !worked(value) ? { ok: false } : undefined);
          return value;
        },
        (error: unknown) => {
          running.stop({ ok: false });
          throw error;
        },
      );
    }
    running.stop(worked && !worked(result) ? { ok: false } : undefined);
    return result;
  }

  return {
    record,
    start,
    time: time as TimingLog['time'],
    events: () => ring,
    summarize() {
      const out: TimingSummary[] = [];
      for (const name of TIMING_NAMES) {
        const mine = ring.filter((e) => e.name === name);
        if (!mine.length) continue;
        const sorted = mine.map((e) => e.ms).sort((a, b) => a - b);
        out.push({
          name,
          runs: mine.length,
          failed: mine.filter((e) => !e.ok).length,
          medianMs: rank(sorted, 50),
          p95Ms: rank(sorted, 95),
          maxMs: sorted[sorted.length - 1],
        });
      }
      return out;
    },
    clear() {
      ring = [];
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
  };
}

/** The one log the app uses. Call sites: `timings.time('record_write', () => ...)`. */
export const timings = createTimingLog();
