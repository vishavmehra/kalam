/**
 * The screen side of the one-time cloud notice (docs/03 §23, docs/11 §8.3). The orchestrator's
 * `askCloudNotice` dependency is `askCloudNotice` below: it opens the sheet that <CloudNoticeHost/>
 * shows and waits for the person. Pure TypeScript, so it is testable without a screen.
 * With no host mounted the answer is "nobody could be asked" (undefined): a missing mount refuses cloud help; it
 * never hangs a run and never lets content leave unasked. A question left unanswered for a minute ends the
 * same way, so a sheet that nobody sees cannot hold a run for ever. Only a real "Not now" is `false`, and only
 * that starts the orchestrator's decline pause.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let pending: { promise: Promise<boolean | undefined>; settle: (ok: boolean | undefined) => void; timer: ReturnType<typeof setTimeout> } | undefined;

/** How long the sheet waits for an answer before the run goes on without cloud help. */
export const CLOUD_NOTICE_TIMEOUT_MS = 60_000;

const notify = () => listeners.forEach((l) => l());

/**
 * true: the person allowed cloud help. false: "Not now". undefined: nobody could be asked (no screen, the
 * screen went away, or no answer in a minute). One question at a time.
 */
export function askCloudNotice(): Promise<boolean | undefined> {
  if (!listeners.size) return Promise.resolve(undefined);
  if (!pending) {
    let settle!: (ok: boolean | undefined) => void;
    const promise = new Promise<boolean | undefined>((resolve) => { settle = resolve; });
    pending = { promise, settle, timer: setTimeout(() => answerCloudNotice(undefined), CLOUD_NOTICE_TIMEOUT_MS) };
    notify();
  }
  return pending.promise;
}

/** The sheet's answer. A no-op when nothing is being asked. */
export function answerCloudNotice(ok: boolean | undefined): void {
  const p = pending;
  pending = undefined;
  if (p) clearTimeout(p.timer);
  p?.settle(ok);
  notify();
}

export const isCloudNoticeOpen = (): boolean => !!pending;

/** For useSyncExternalStore. The last host to leave closes a question left open (nobody could be asked). */
export function subscribeCloudNotice(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) answerCloudNotice(undefined);
  };
}
