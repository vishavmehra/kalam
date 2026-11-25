/**
 * Autosave scheduler (docs/08 §13). Debounces rapid edits, saves one write at a time, retries a
 * failed write with a growing delay until it works, and flushes on demand (app goes to the
 * background, page is hidden, studio closes). Framework-free so the retry logic is unit tested.
 */
export interface AutosaveDeps {
  /** Writes the current document. Rejects when the write fails. */
  save(): Promise<void>;
  /** True while the current document differs from the last one written. */
  isDirty(): boolean;
  /** Reports transient states. 'saved' and 'unsaved' are decided by `save` itself. */
  onStatus(status: 'saving' | 'error'): void;
}

export interface AutosaveOptions {
  debounceMs?: number;
  /** Delay before each retry; the last value repeats. */
  retryMs?: readonly number[];
}

export interface Autosaver {
  /** Call after every document change. */
  notify(): void;
  /** Saves now if there is anything to save. Resolves true when the document is clean afterwards. */
  flush(): Promise<boolean>;
  /** Stops timers. A write already in flight still finishes. */
  dispose(): void;
}

export const AUTOSAVE_DEBOUNCE_MS = 800;
export const AUTOSAVE_RETRY_MS = [2_000, 5_000, 15_000, 30_000] as const;

export function createAutosaver(deps: AutosaveDeps, opts: AutosaveOptions = {}): Autosaver {
  const debounceMs = opts.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const retryMs = opts.retryMs ?? AUTOSAVE_RETRY_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<boolean> | undefined;
  let failures = 0;
  let disposed = false;

  const clearTimers = () => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
  };

  const armRetry = () => {
    if (disposed) return;
    if (retryTimer) clearTimeout(retryTimer);
    const delay = retryMs[Math.min(failures - 1, retryMs.length - 1)] ?? 30_000;
    retryTimer = setTimeout(() => { retryTimer = undefined; void saveNow(); }, delay);
  };

  async function saveNow(): Promise<boolean> {
    if (inflight) await inflight;
    if (!deps.isDirty()) return true;
    const run = (async () => {
      deps.onStatus('saving');
      try {
        await deps.save();
        failures = 0;
        return true;
      } catch {
        failures += 1;
        deps.onStatus('error');
        armRetry();
        return false;
      } finally {
        inflight = undefined;
      }
    })();
    inflight = run;
    return run;
  }

  return {
    notify() {
      if (disposed) return;
      clearTimers();
      timer = setTimeout(() => { timer = undefined; void saveNow(); }, debounceMs);
    },
    async flush() {
      if (timer) { clearTimeout(timer); timer = undefined; }
      // A change can land while a write is in flight, so loop until clean or a write fails.
      for (let i = 0; i < 4; i++) {
        if (!(await saveNow())) return false;
        if (!deps.isDirty()) return true;
      }
      return !deps.isDirty();
    },
    dispose() {
      disposed = true;
      clearTimers();
    },
  };
}
