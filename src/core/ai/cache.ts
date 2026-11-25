/**
 * Reuse of AI work (docs/07 §16.2, docs/00 §29: an LRU of 500 results, docs/16 R-011). Identical
 * requests in flight share one model call, and finished answers of tasks that are safe to repeat are
 * kept for a day. Keys are SHA-256 hashes, so a key never holds prompt text, record values or image
 * bytes; an image enters a key only as the hash of its bytes, and the cache stores answers, never inputs.
 * What is kept and shared is the model's raw JSON, the value the caller's parser accepted. Every
 * caller runs its own parser on it, because parsers reshape output (an AI step writes its own field).
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import type {
  AICacheRepository, ModelRole, InferenceMode, StructuredRequest, TaskType,
} from '../contracts';

/**
 * Tasks whose answer depends only on the request (AI blocks run them at temperature 0). App creation,
 * edits, repair, verification and safety review are left out: asking again must give a fresh attempt.
 */
export const CACHEABLE_TASKS: ReadonlySet<TaskType> = new Set<TaskType>([
  'classify', 'summarize', 'translate', 'extract_data', 'extract_template_params',
]);
export const CACHE_MAX_ENTRIES = 500;
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const hash = (s: string): string => bytesToHex(sha256(utf8ToBytes(s)));

/** JSON with object keys sorted and undefined members dropped, so equal values give equal strings. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export interface KeyContext {
  taskType: TaskType;
  role: ModelRole;
  mode: InferenceMode;
  /** Always part of the key, so one app's answers are never served to another. */
  appId?: string;
  escalationReason?: string;
  promptVersion: string;
  model: string;
}

/** Stable key for "the same request": task, role, mode, app and a hash of every input that shapes the answer. */
export function requestKey(req: StructuredRequest<unknown>, k: KeyContext): string {
  return hash(stableStringify({
    v: 2, ...k, appId: k.appId ?? '',
    system: req.system, prompt: req.prompt, jsonSchema: req.jsonSchema,
    images: req.images?.map((i) => `${i.mimeType}:${hash(i.base64)}`),
    languages: req.languages, temperature: req.temperature, maxOutputTokens: req.maxOutputTokens,
  }));
}

export interface CachedAnswer {
  /** The model's JSON as the provider received it, before any caller's parser reshaped it. */
  raw: unknown;
  provider: 'firebase' | 'claude' | 'nebius';
  source: 'on_device' | 'cloud';
  model?: string;
}

/** Shape written to db.aiCache. Read back as untrusted: anything else is a miss. */
const stored = z.object({
  v: z.literal(2),
  expiresAt: z.number(),
  raw: z.unknown(),
  provider: z.enum(['firebase', 'claude', 'nebius']),
  source: z.enum(['on_device', 'cloud']),
  model: z.string().optional(),
  /** Owning app, so an app-scoped purge can find the row (C1 CONTRACT CHANGE REQUEST). */
  appId: z.string().optional(),
});

/**
 * db.aiCache plus the purge member asked for in C1's CONTRACT CHANGE REQUEST. Until the repository
 * has `remove`, an expired row stays on disk until LRU eviction or the repository's own TTL.
 */
export type PurgeableAICache = AICacheRepository & { remove?(key: string): Promise<void> };

export interface ResultCache {
  get(key: string): Promise<CachedAnswer | undefined>;
  set(key: string, answer: CachedAnswer, taskType: TaskType, appId?: string): void;
  size(): number;
}

export function createResultCache(opts: {
  now: () => number;
  /** Optional persistence (db.aiCache). Its failures never affect a run. */
  store?: PurgeableAICache;
  max?: number;
  ttlMs?: number;
}): ResultCache {
  const max = opts.max ?? CACHE_MAX_ENTRIES;
  const ttl = opts.ttlMs ?? CACHE_TTL_MS;
  // A Map keeps insertion order: the first key is the least recently used.
  const memory = new Map<string, { answer: CachedAnswer; expiresAt: number }>();
  const remember = (key: string, entry: { answer: CachedAnswer; expiresAt: number }) => {
    memory.delete(key);
    memory.set(key, entry);
    while (memory.size > max) memory.delete(memory.keys().next().value as string);
  };

  const { store } = opts;
  /** Drops a persisted row that is stale or unreadable, so its content does not stay on disk. */
  const purge = (key: string) => {
    if (!store?.remove) return;
    void Promise.resolve().then(() => store.remove?.(key)).catch(() => { /* persistence is optional */ });
  };

  return {
    async get(key) {
      let entry = memory.get(key);
      if (!entry && store) {
        try {
          const row = await store.get(key);
          const r = stored.safeParse(row);
          if (r.success) {
            const { raw, provider, source, model, expiresAt } = r.data;
            entry = { answer: { raw, provider, source, ...(model ? { model } : {}) }, expiresAt };
          } else if (row !== undefined) {
            purge(key); // an older shape, or not ours
          }
        } catch {
          /* persistence is optional */
        }
      }
      const t = opts.now();
      // An expiry more than one TTL away means the clock was set back: treat the entry as stale.
      if (!entry || entry.expiresAt <= t || entry.expiresAt > t + ttl) {
        if (entry) {
          memory.delete(key);
          purge(key);
        }
        return undefined;
      }
      remember(key, entry);
      return entry.answer;
    },
    set(key, answer, taskType, appId) {
      const expiresAt = opts.now() + ttl;
      remember(key, { answer, expiresAt });
      if (store) {
        void Promise.resolve()
          .then(() => store.set(key, { v: 2, expiresAt, ...answer, ...(appId ? { appId } : {}) }, { taskType, source: answer.source }))
          .catch(() => { /* persistence is optional */ });
      }
    },
    size: () => memory.size,
  };
}

/**
 * Shares one call between identical requests in flight. The shared call is cancelled only when every
 * caller has cancelled; a caller that cancels alone stops waiting and gets `cancelled()`. Every holder
 * gets the same value, so a value that carries a parsed answer must be parsed again per caller.
 */
export function createInflight<V>(cancelled: () => V) {
  interface Flight { promise: Promise<V>; holders: number; controller: AbortController }
  const flights = new Map<string, Flight>();
  /** A flight every holder has cancelled is finishing as cancelled: a new caller starts afresh. */
  const joinable = (f: Flight | undefined) => (f && !f.controller.signal.aborted ? f : undefined);
  const launch = (key: string, start: (signal: AbortSignal) => Promise<V>): Flight => {
    const controller = new AbortController();
    const flight: Flight = { holders: 0, controller, promise: start(controller.signal) };
    flights.set(key, flight);
    flight.promise
      .finally(() => { if (flights.get(key) === flight) flights.delete(key); })
      .catch(() => { /* each holder sees the rejection itself */ });
    return flight;
  };

  return {
    run(key: string, signal: AbortSignal | undefined, start: (signal: AbortSignal) => Promise<V>): Promise<V> {
      const f = joinable(flights.get(key)) ?? launch(key, start);
      f.holders += 1;
      if (!signal) return f.promise;
      return new Promise<V>((resolve, reject) => {
        const onAbort = () => {
          f.holders -= 1;
          if (f.holders === 0) f.controller.abort();
          resolve(cancelled());
        };
        signal.addEventListener('abort', onAbort, { once: true });
        f.promise.then(
          (r) => { signal.removeEventListener('abort', onAbort); resolve(r); },
          (e: unknown) => { signal.removeEventListener('abort', onAbort); reject(e); },
        );
      });
    },
    size: () => flights.size,
  };
}
