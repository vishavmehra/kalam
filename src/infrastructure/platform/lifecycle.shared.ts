/**
 * Lifecycle flush (docs/09 §15.5): "persist critical data before the app is suspended when practical; do not
 * assume the process will remain alive". Code that holds unsaved work registers a flusher; when the app goes
 * to the background or the page is hidden, every flusher runs. Each platform supplies its own `onSuspend`
 * (lifecycle.native.ts: AppState, lifecycle.web.ts: visibilitychange and pagehide).
 *
 * A flusher that throws or rejects is ignored: leaving the app must never fail because one saver did.
 * The platform listener exists only while at least one flusher is registered. Pure TypeScript.
 */
export type Flusher = () => void | Promise<void>;

export interface FlushRegistry {
  /** Adds a flusher. Returns a remover; the last remover also detaches the platform listener. */
  register(flusher: Flusher): () => void;
  /** Runs every flusher now and resolves when all have finished or failed. Also what a suspend does. */
  flush(): Promise<void>;
  readonly size: number;
}

export function createFlushRegistry(onSuspend: (callback: () => void) => () => void): FlushRegistry {
  const flushers = new Set<Flusher>();
  let detach: (() => void) | undefined;
  const flush = async (): Promise<void> => {
    await Promise.allSettled([...flushers].map(async (f) => f()));
  };
  return {
    register(flusher) {
      flushers.add(flusher);
      detach ??= onSuspend(() => void flush());
      return () => {
        flushers.delete(flusher);
        if (!flushers.size) {
          detach?.();
          detach = undefined;
        }
      };
    },
    flush,
    get size() {
      return flushers.size;
    },
  };
}
