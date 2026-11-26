/**
 * Runs `task` with its own abort signal and returns `undefined` once `ms` pass or `outer` aborts,
 * even if the task ignores its signal. The orchestrator does not retry a cancelled run.
 * A task that throws before then rethrows, so a caller can tell a failure from a time-out.
 */
export async function withDeadline<T>(
  task: (signal: AbortSignal) => Promise<T>, ms: number, outer?: AbortSignal,
): Promise<T | undefined> {
  const ctl = new AbortController();
  const relay = () => ctl.abort();
  if (outer?.aborted) ctl.abort();
  outer?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(relay, ms);
  const stop = new Promise<undefined>((resolve) => {
    if (ctl.signal.aborted) resolve(undefined);
    else ctl.signal.addEventListener('abort', () => resolve(undefined), { once: true });
  });
  try {
    const run = Promise.resolve().then(() => task(ctl.signal));
    run.catch(() => {}); // a late rejection after the deadline is expected
    return await Promise.race([run, stop]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', relay);
  }
}
