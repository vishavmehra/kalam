/**
 * The operation queue (docs/09 §18.3): persist the operation, show that it waits, resume when the
 * connection returns, re-check consent first, never run one twice, allow cancel, expose the retry state.
 *
 * - One operation runs at a time, so a flapping connection cannot start a burst of cloud calls.
 * - A failed attempt that may work later waits with a growing pause; a return to online skips the pause.
 *   After MAX_ATTEMPTS it stops and asks the person (status `failed`, Retry).
 * - A row left `processing` by a closed app is attempted once more at the next start. The work it did
 *   was a request, not a save: a build only returns a result, a translation is cached by key.
 * - Handlers return codes, never text, so no prompt, record value or error message reaches a row or a log.
 */
import type { NetworkMonitor } from '../contracts';
import {
  ENDED_TTL_MS, isActive, MAX_ACTIVE_OPS, MAX_ATTEMPTS, MAX_PAYLOAD_CHARS, parsePendingOp, QueueError,
  type NewOperation, type OpError, type OpKind, type PendingOperation,
} from './model';
import type { OperationStore } from './store';

export type HandlerOutcome =
  | { ok: true; /** JSON text, kind specific. */ result?: string; /** Keep the input (a build's draft) for the person to open. */ keepSnapshot?: boolean }
  | { ok: false; code: OpError; /** True when trying again later may work (no connection). */ retryable?: boolean };

export type OpHandler = (op: PendingOperation, ctx: { signal: AbortSignal }) => Promise<HandlerOutcome>;

export interface QueueDeps {
  store: OperationStore;
  network: Pick<NetworkMonitor, 'online' | 'subscribe'>;
  handlers: Partial<Record<OpKind, OpHandler>>;
  /** Re-checks consent and set-up right before an attempt. Return a code to stop it. */
  gate?: (op: PendingOperation) => Promise<OpError | undefined>;
  /** Removes the files kept for an operation. Called when its input is dropped or its row is removed. */
  cleanup?: (op: PendingOperation) => Promise<void>;
  now?: () => number;
  newId?: () => string;
  /** Pause before attempt number `attempt` (1 = first retry), used only while the network reports online. */
  backoffMs?: (attempt: number) => number;
  /** Schedules `fn` after `ms`; returns a canceller. Tests pass a fake clock. */
  setTimer?: (fn: () => void, ms: number) => () => void;
}

export interface OperationQueue {
  /** Stores a new operation, or returns the active one with the same key. Runs it at once when online. */
  enqueue(input: NewOperation): Promise<PendingOperation>;
  /** Active first (oldest first), then finished (newest first). */
  list(): Promise<PendingOperation[]>;
  get(id: string): Promise<PendingOperation | undefined>;
  /** Stops a waiting or running operation and drops its input. No-op for one that already ended. */
  cancel(id: string): Promise<void>;
  /** Tries a failed operation again, from zero attempts. */
  retry(id: string): Promise<void>;
  /** Removes a finished row and its files. */
  dismiss(id: string): Promise<void>;
  /** Recovers rows left by a closed app, drops old finished rows, starts listening for the network. */
  start(): Promise<void>;
  stop(): void;
  /** Runs everything that is due. Resolves when the pass is done. */
  pump(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

const defaultBackoff = (attempt: number) => Math.min(30_000 * 2 ** (attempt - 1), 15 * 60_000);

/** A fresh id for an operation. Callers that store files first need it before `enqueue`. */
export function newOperationId(): string {
  const bytes = new Uint8Array(10);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `op_${Date.now().toString(36)}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const byCreated = (a: PendingOperation, b: PendingOperation) => a.createdAt - b.createdAt;

export function createOperationQueue(deps: QueueDeps): OperationQueue {
  const { store, network, handlers } = deps;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? newOperationId;
  const backoff = deps.backoffMs ?? defaultBackoff;
  const setTimer = deps.setTimer ?? ((fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  });

  const controllers = new Map<string, AbortController>();
  let started = false;
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  let cancelTimer: (() => void) | undefined;
  let running: Promise<void> | undefined;
  let again = false;
  let force = false;
  let lock: Promise<unknown> = Promise.resolve();
  /** Serialises the writes that must see each other (the duplicate check in `enqueue`). */
  const exclusive = <R>(fn: () => Promise<R>): Promise<R> => {
    const run = lock.then(fn, fn);
    lock = run.catch(() => undefined);
    return run;
  };

  const clean = async (op: PendingOperation) => {
    try {
      await deps.cleanup?.(op);
    } catch {
      // Leftover files are swept later by the storage manager; a failed sweep must not block the queue.
    }
  };
  const save = (op: PendingOperation, patch: Partial<PendingOperation>) => store.put({ ...op, ...patch, updatedAt: now() });
  const idleStatus = (): PendingOperation['status'] => (network.online() ? 'ready' : 'waiting_for_network');

  const isDue = (op: PendingOperation, override: boolean) =>
    op.status === 'ready' || (op.status === 'waiting_for_network' && (override || (op.nextAttemptAt ?? 0) <= now()));

  /** `listed` came from the pass's single list(); a cancel or an app delete may have changed the row since. */
  async function attempt(listed: PendingOperation, override: boolean): Promise<void> {
    const op = await store.get(listed.id);
    // ponytail: a cancel landing between this read and the write below still loses; a conditional put in the store would close it.
    if (!op || !isDue(op, override)) return;
    await save(op, { status: 'processing', nextAttemptAt: undefined });
    const controller = new AbortController();
    controllers.set(op.id, controller);
    let outcome: HandlerOutcome;
    try {
      const blocked = await deps.gate?.(op);
      const handler = handlers[op.kind];
      if (blocked) outcome = { ok: false, code: blocked };
      else if (!handler) outcome = { ok: false, code: 'failed' };
      else outcome = await handler(op, { signal: controller.signal });
    } catch {
      outcome = { ok: false, code: 'failed' };
    } finally {
      controllers.delete(op.id);
    }
    // Closed while running: the row stays `processing` and the next start recovers it.
    if (stopped) return;
    const current = await store.get(op.id);
    // Cancelled or deleted while it ran: that decision stands, and the late result is dropped.
    if (!current || current.status !== 'processing') return;

    if (outcome.ok) {
      const result = outcome.result;
      if (result !== undefined && result.length > MAX_PAYLOAD_CHARS) {
        await save(current, { status: 'failed', lastError: 'invalid_result', retryCount: current.retryCount + 1 });
        return;
      }
      const keep = outcome.keepSnapshot === true;
      const done = { ...current, status: 'completed' as const, result, lastError: undefined, snapshot: keep ? current.snapshot : undefined };
      await save(done, {});
      if (!keep) await clean(done);
      return;
    }
    const attempts = current.retryCount + 1;
    if (outcome.retryable && attempts < MAX_ATTEMPTS) {
      const online = network.online();
      await save(current, {
        status: 'waiting_for_network', retryCount: attempts, lastError: outcome.code,
        nextAttemptAt: online ? now() + backoff(attempts) : undefined,
      });
    } else {
      await save(current, { status: 'failed', retryCount: attempts, lastError: outcome.code });
    }
  }

  function scheduleNext(rows: readonly PendingOperation[]) {
    cancelTimer?.();
    cancelTimer = undefined;
    if (stopped || !network.online()) return;
    const times = rows.filter((o) => o.status === 'waiting_for_network' && o.nextAttemptAt !== undefined).map((o) => o.nextAttemptAt!);
    if (!times.length) return;
    cancelTimer = setTimer(kick, Math.max(0, Math.min(...times) - now()));
  }

  /** Runs what is due. Calls made while a pass is running ask for one more pass and share its promise. */
  function pump(): Promise<void> {
    again = true;
    return (running ??= loop());
  }
  const kick = () => void pump().catch(() => undefined);

  async function loop(): Promise<void> {
    await Promise.resolve(); // `running` is assigned before the first pass can finish
    try {
      while (again) {
        again = false;
        const override = force;
        force = false;
        if (stopped || !network.online()) break;
        const due = (await store.list()).filter((o) => isDue(o, override)).sort(byCreated);
        for (const op of due) {
          if (stopped || !network.online()) break;
          await attempt(op, override);
        }
      }
    } finally {
      running = undefined;
    }
    scheduleNext(await store.list());
  }

  return {
    enqueue: (input) =>
      exclusive(async () => {
        const rows = await store.list();
        const same = rows.find((o) => isActive(o.status) && o.kind === input.kind && o.dedupeKey === input.dedupeKey);
        if (same) return same;
        if (rows.filter((o) => isActive(o.status)).length >= MAX_ACTIVE_OPS) throw new QueueError('queue_full');
        const time = now();
        const op = parsePendingOp({
          id: input.id ?? newId(), kind: input.kind, status: idleStatus(), payloadRef: input.payloadRef,
          ...(input.appId ? { appId: input.appId } : {}), dedupeKey: input.dedupeKey, sends: input.sends,
          params: input.params ?? {}, ...(input.snapshot !== undefined ? { snapshot: input.snapshot } : {}),
          createdAt: time, updatedAt: time, retryCount: 0,
        });
        if (!op) throw new QueueError('invalid_operation');
        await store.put(op);
        kick();
        return op;
      }),

    async list() {
      const rows = await store.list();
      const active = rows.filter((o) => isActive(o.status)).sort(byCreated);
      const ended = rows.filter((o) => !isActive(o.status)).sort((a, b) => b.updatedAt - a.updatedAt);
      return [...active, ...ended];
    },
    get: (id) => store.get(id),

    async cancel(id) {
      const op = await store.get(id);
      if (!op) throw new QueueError('not_found');
      if (!isActive(op.status)) return;
      controllers.get(id)?.abort();
      const next = { ...op, status: 'cancelled' as const, snapshot: undefined, result: undefined, nextAttemptAt: undefined, lastError: undefined };
      await save(next, {});
      await clean(next);
    },

    async retry(id) {
      const op = await store.get(id);
      if (!op) throw new QueueError('not_found');
      if (op.status !== 'failed') throw new QueueError('wrong_state');
      await save(op, { status: idleStatus(), retryCount: 0, lastError: undefined, nextAttemptAt: undefined });
      force = true;
      kick();
    },

    async dismiss(id) {
      const op = await store.get(id);
      if (!op) return;
      if (isActive(op.status)) throw new QueueError('wrong_state');
      await store.remove(id);
      await clean(op);
    },

    async start() {
      if (started) return;
      started = true;
      stopped = false;
      for (const op of await store.list()) {
        if (op.status === 'processing') await save(op, { status: idleStatus(), nextAttemptAt: undefined });
        else if (!isActive(op.status) && now() - op.updatedAt > ENDED_TTL_MS) {
          await store.remove(op.id);
          await clean(op);
        }
      }
      unsubscribe = network.subscribe((online) => {
        if (!online) return;
        force = true;
        kick();
      });
      await pump();
    },

    stop() {
      stopped = true;
      started = false;
      unsubscribe?.();
      unsubscribe = undefined;
      cancelTimer?.();
      cancelTimer = undefined;
      for (const c of controllers.values()) c.abort();
    },

    pump,
    subscribe: (listener) => store.subscribe(listener),
  };
}
