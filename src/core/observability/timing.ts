/**
 * Content-free timing events (docs/09 §22: app open, spec validation and record write durations).
 *
 * An event is a name from a closed list, a duration in milliseconds, a clock time, whether it worked,
 * and optionally a count of items. There is no field that could carry an id, a record value, a prompt
 * or a file name, and the functions copy only those fields from what they are given. Events live in a
 * bounded in-memory ring, are never written to disk and are never sent anywhere. A diagnostics view
 * reads them with `events()` or `summarize()`.
 */

export const TIMING_NAMES = ['app_open', 'spec_validate', 'record_write'] as const;
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
  /** Times `fn`. A promise is awaited; a throw or rejection is recorded as failed and rethrown. */
  time<T>(name: TimingName, fn: () => Promise<T>): Promise<T>;
  time<T>(name: TimingName, fn: () => T): T;
  /** Oldest first. */
  events(): readonly TimingEvent[];
  /** One row per name that has at least one event, in the order of `TIMING_NAMES`. */
  summarize(): TimingSummary[];
  clear(): void;
  subscribe(listener: () => void): () => void;
  /** Changes whenever the ring changes (for `useSyncExternalStore`). */
  version(): number;
}

export const TIMING_RING_SIZE = 200;
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
  capacity?: number;
  /** Monotonic milliseconds, for durations. */
  clock?: () => number;
  /** Epoch milliseconds, for `at`. */
  wall?: () => number;
}

export function createTimingLog({ capacity = TIMING_RING_SIZE, clock = defaultClock, wall = Date.now }: TimingLogOptions = {}): TimingLog {
  let ring: TimingEvent[] = [];
  let version = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    version += 1;
    for (const l of [...listeners]) l();
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
    ring = [...ring, event].slice(-capacity);
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

  function time<T>(name: TimingName, fn: () => T | Promise<T>): T | Promise<T> {
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
          running.stop();
          return value;
        },
        (error: unknown) => {
          running.stop({ ok: false });
          throw error;
        },
      );
    }
    running.stop();
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
