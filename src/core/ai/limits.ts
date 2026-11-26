/**
 * Client-side request limits (docs/07 §16.2, docs/11 §16.1, docs/04 §11.9): a token bucket per task
 * type, exponential backoff with full jitter, and the retry budget per error. They protect cost and
 * battery. They are not a security boundary (a modified client can skip them), so provider-side
 * quotas still apply.
 */
import type { AIErrorCode, StructuredRequest, TaskType } from '../contracts';
import { TASK_POLICIES } from './routing';

/**
 * Extra cloud attempts on the same provider, per error. Rate limits (429), service errors (5xx and
 * failures the provider could not classify) and network drops get two. A timeout already waited its
 * whole budget, so it gets one. Everything else (bad output, consent, configuration, App Check, a
 * refused request such as another 4xx or a blocked answer, cancel) is final. The orchestrator never
 * retries the on-device leg or a provider that threw, and stops when the run budget is spent.
 * Malformed output is not retried here: the compiler makes one repair call (docs/04 §11.9 step 4)
 * and on-device-first tasks get the one cloud fallback.
 */
export const RETRY_LIMITS: Readonly<Partial<Record<AIErrorCode, number>>> = {
  quota: 2, provider_error: 2, offline: 2, timeout: 1,
};

/** A provider call with no timeoutMs of its own waits this long (the Firebase provider uses it too). */
export const DEFAULT_TIMEOUT_MS = 90_000;
/**
 * Per-task execution budget (docs/07 §16.2): every attempt of one run (first call, retries, the one
 * cloud fallback) fits in this many times the request's own timeout, and each later attempt only
 * gets the time that is left. Output tokens are capped per call (model-config.ts), so a run spends
 * at most three calls' worth.
 */
export const RUN_BUDGET_FACTOR = 2;
/** A retry or fallback is not started with less time than this left in the budget. */
export const MIN_ATTEMPT_MS = 2_000;

/**
 * Prompt length and inline data limits (docs/07 §16.2, docs/11 §11). A modify request carries the
 * whole spec (at most 100 KB), so 300 000 characters leaves room; images are re-encoded to at most
 * 1280 px before they get here, and Firebase refuses inline requests over 20 MB.
 */
export const INPUT_LIMITS = { textChars: 300_000, images: 8, audio: 1, inlineBytes: 18 * 1024 * 1024 } as const;

/** Why a request is too large to send, or undefined. Technical detail for logs, never content. */
export function inputTooLarge(req: Pick<StructuredRequest<unknown>, 'prompt' | 'system' | 'images' | 'audio'>): string | undefined {
  const chars = req.prompt.length + (req.system?.length ?? 0);
  if (chars > INPUT_LIMITS.textChars) return `prompt has ${chars} characters, the limit is ${INPUT_LIMITS.textChars}`;
  const images = req.images ?? [];
  if (images.length > INPUT_LIMITS.images) return `${images.length} images, the limit is ${INPUT_LIMITS.images}`;
  const recordings = req.audio ?? [];
  if (recordings.length > INPUT_LIMITS.audio) return `${recordings.length} recordings, the limit is ${INPUT_LIMITS.audio}`;
  const bytes = [...images, ...recordings].reduce((n, i) => n + Math.floor((i.base64.length * 3) / 4), 0);
  if (bytes > INPUT_LIMITS.inlineBytes) return `images and recordings total ${bytes} bytes, the limit is ${INPUT_LIMITS.inlineBytes}`;
  return undefined;
}

/** Full jitter: a random wait between 0 and min(cap, base x 2^attempt). `attempt` starts at 0. */
export function backoffDelay(attempt: number, random: () => number = Math.random, baseMs = 500, capMs = 8_000): number {
  return Math.floor(random() * Math.min(capMs, baseMs * 2 ** attempt));
}

export interface BucketLimit {
  capacity: number;
  perMinute: number;
}

/** Compile, repair and safety calls are the expensive cloud ones; everything else may burst more. */
const HEAVY: BucketLimit = { capacity: 6, perMinute: 6 };
const LIGHT: BucketLimit = { capacity: 20, perMinute: 30 };

export function rateLimitFor(task: TaskType): BucketLimit {
  const { role } = TASK_POLICIES[task];
  return role === 'compiler' || role === 'repair' || role === 'safety' ? HEAVY : LIGHT;
}

/** The longest a request may wait for a token before it fails as rate limited. */
export const MAX_RATE_WAIT_MS = 5_000;

export interface TokenBuckets {
  /**
   * Takes a token for `task` and returns how many ms to wait before using it, or -1 (nothing taken)
   * when that wait would be longer than `maxWaitMs`.
   */
  reserve(task: TaskType, maxWaitMs?: number): number;
}

export function createTokenBuckets(
  now: () => number,
  limitFor: (task: TaskType) => BucketLimit = rateLimitFor,
): TokenBuckets {
  const state = new Map<TaskType, { tokens: number; at: number }>();
  return {
    reserve(task, maxWaitMs = MAX_RATE_WAIT_MS) {
      const { capacity, perMinute } = limitFor(task);
      const t = now();
      const perMs = perMinute / 60_000;
      const prev = state.get(task) ?? { tokens: capacity, at: t };
      // Tokens may go below zero: each missing token is a caller already waiting for its turn.
      // A clock set back (t < prev.at) refills nothing instead of draining the bucket.
      const available = Math.min(capacity, prev.tokens + Math.max(0, t - prev.at) * perMs);
      const wait = available >= 1 ? 0 : Math.ceil((1 - available) / perMs);
      if (wait > maxWaitMs) {
        state.set(task, { tokens: available, at: t });
        return -1;
      }
      state.set(task, { tokens: available - 1, at: t });
      return wait;
    },
  };
}

/** Resolves after `ms`, or as soon as `signal` aborts. Never rejects. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
