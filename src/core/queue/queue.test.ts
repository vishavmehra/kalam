import { describe, expect, it } from 'vitest';
import type { NetworkMonitor } from '../contracts';
import { MAX_ACTIVE_OPS, MAX_ATTEMPTS, QueueError, type NewOperation, type PendingOperation } from './model';
import { createOperationQueue, type HandlerOutcome, type OpHandler, type QueueDeps } from './queue';
import { createMemoryOperationStore } from './store';

/** A network the test flips, and a clock and timer it advances by hand. */
function world(online = false) {
  let isOnline = online;
  let time = 1_000_000;
  const listeners = new Set<(o: boolean) => void>();
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  const network: NetworkMonitor = {
    online: () => isOnline,
    subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)),
  };
  return {
    network,
    now: () => time,
    setTimer: (fn: () => void, ms: number) => {
      const t = { at: time + ms, fn, live: true };
      timers.push(t);
      return () => void (t.live = false);
    },
    go(next: boolean) {
      isOnline = next;
      for (const l of [...listeners]) l(next);
    },
    advance(ms: number) {
      time += ms;
      for (const t of timers.filter((x) => x.live && x.at <= time)) {
        t.live = false;
        t.fn();
      }
    },
    pendingTimers: () => timers.filter((t) => t.live).length,
  };
}

const op = (patch: Partial<NewOperation> = {}): NewOperation => ({
  kind: 'translate', payloadRef: 'app_a', appId: 'app_a', dedupeKey: 'translate:app_a:hi', sends: ['labels'], params: { lang: 'hi' }, ...patch,
});

function setup(handler: OpHandler, online = false, extra: Partial<QueueDeps> = {}) {
  const w = world(online);
  const store = createMemoryOperationStore();
  let n = 0;
  const calls: string[] = [];
  const cleaned: string[] = [];
  const queue = createOperationQueue({
    store, network: w.network, now: w.now, setTimer: w.setTimer, newId: () => `op_${++n}`,
    handlers: { translate: async (o, ctx) => (calls.push(o.id), handler(o, ctx)), compile: async (o, ctx) => (calls.push(o.id), handler(o, ctx)) },
    cleanup: async (o) => void cleaned.push(o.id),
    ...extra,
  });
  const status = async (id: string) => (await store.get(id))?.status;
  return { w, store, queue, calls, cleaned, status };
}

const ok: OpHandler = async () => ({ ok: true });

describe('queue: waiting and resuming', () => {
  it('offline: the operation is stored as waiting_for_network and nothing runs', async () => {
    const t = setup(ok);
    const made = await t.queue.enqueue(op());
    await t.queue.pump();
    expect(made.status).toBe('waiting_for_network');
    expect(await t.status(made.id)).toBe('waiting_for_network');
    expect(t.calls).toEqual([]);
  });

  it('runs by itself when the connection returns, and completes', async () => {
    const t = setup(ok);
    await t.queue.start();
    const made = await t.queue.enqueue(op());
    t.w.go(true);
    await t.queue.pump();
    expect(await t.status(made.id)).toBe('completed');
    expect(t.calls).toEqual([made.id]);
  });

  it('online at enqueue time: runs at once', async () => {
    const t = setup(ok, true);
    const made = await t.queue.enqueue(op());
    expect(made.status).toBe('ready');
    await t.queue.pump();
    expect(await t.status(made.id)).toBe('completed');
  });

  it('runs one operation at a time, oldest first', async () => {
    const order: string[] = [];
    let running = 0;
    let most = 0;
    const t = setup(async (o) => {
      running += 1;
      most = Math.max(most, running);
      order.push(o.id);
      await Promise.resolve();
      running -= 1;
      return { ok: true };
    });
    await t.queue.start();
    const a = await t.queue.enqueue(op({ dedupeKey: 'a' }));
    t.w.advance(5);
    const b = await t.queue.enqueue(op({ dedupeKey: 'b' }));
    t.w.go(true);
    await t.queue.pump();
    expect(order).toEqual([a.id, b.id]);
    expect(most).toBe(1);
  });
});

describe('queue: no duplicates', () => {
  it('the same key while active returns the same operation', async () => {
    const t = setup(ok);
    const [a, b] = await Promise.all([t.queue.enqueue(op()), t.queue.enqueue(op())]);
    expect(b.id).toBe(a.id);
    expect(await t.queue.list()).toHaveLength(1);
  });

  it('a finished operation does not block queuing the same thing again', async () => {
    const t = setup(ok, true);
    const a = await t.queue.enqueue(op());
    await t.queue.pump();
    const b = await t.queue.enqueue(op());
    expect(b.id).not.toBe(a.id);
  });

  it('a late pump while one is running does not run the operation twice', async () => {
    const t = setup(ok, true);
    const made = await t.queue.enqueue(op());
    await Promise.all([t.queue.pump(), t.queue.pump(), t.queue.pump()]);
    expect(t.calls.filter((c) => c === made.id)).toHaveLength(1);
  });

  it('refuses to hold more than MAX_ACTIVE_OPS', async () => {
    const t = setup(ok);
    for (let i = 0; i < MAX_ACTIVE_OPS; i++) await t.queue.enqueue(op({ dedupeKey: `k${i}` }));
    await expect(t.queue.enqueue(op({ dedupeKey: 'extra' }))).rejects.toMatchObject({ code: 'queue_full' });
  });

  it('rejects an operation that does not validate', async () => {
    const t = setup(ok);
    await expect(t.queue.enqueue(op({ params: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 } }))).rejects.toBeInstanceOf(QueueError);
    await expect(t.queue.enqueue(op({ dedupeKey: '' }))).rejects.toMatchObject({ code: 'invalid_operation' });
  });
});

describe('queue: retry and failure', () => {
  const offlineFail: OpHandler = async () => ({ ok: false, code: 'offline', retryable: true });

  it('a retryable failure goes back to waiting with a pause, then runs again after it', async () => {
    let tries = 0;
    const t = setup(async () => (++tries < 2 ? ({ ok: false, code: 'offline', retryable: true } as HandlerOutcome) : { ok: true }), true);
    const made = await t.queue.enqueue(op());
    await t.queue.pump();
    const waiting = (await t.store.get(made.id))!;
    expect(waiting.status).toBe('waiting_for_network');
    expect(waiting.retryCount).toBe(1);
    expect(waiting.lastError).toBe('offline');
    expect(waiting.nextAttemptAt).toBeGreaterThan(t.w.now());
    expect(t.w.pendingTimers()).toBe(1);
    t.w.advance(10_000); // too early: still paused
    await t.queue.pump();
    expect(tries).toBe(1);
    t.w.advance(60_000);
    await t.queue.pump();
    expect(await t.status(made.id)).toBe('completed');
    expect(tries).toBe(2);
  });

  it('a return to online skips the pause', async () => {
    let tries = 0;
    const t = setup(async () => (++tries < 2 ? ({ ok: false, code: 'offline', retryable: true } as HandlerOutcome) : { ok: true }), true);
    await t.queue.start();
    const made = await t.queue.enqueue(op());
    await t.queue.pump();
    expect(await t.status(made.id)).toBe('waiting_for_network');
    t.w.go(false);
    t.w.go(true);
    await t.queue.pump();
    expect(await t.status(made.id)).toBe('completed');
  });

  it('stops after MAX_ATTEMPTS and asks the person; Retry starts again from zero', async () => {
    const t = setup(offlineFail, true);
    const made = await t.queue.enqueue(op());
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      t.w.advance(20 * 60_000);
      await t.queue.pump();
    }
    const failed = (await t.store.get(made.id))!;
    expect(failed.status).toBe('failed');
    expect(failed.retryCount).toBe(MAX_ATTEMPTS);
    expect(failed.lastError).toBe('offline');
    await t.queue.retry(made.id);
    const again = (await t.store.get(made.id))!;
    expect(again.retryCount).toBe(0);
    expect(again.lastError).toBeUndefined();
    expect(['ready', 'waiting_for_network', 'processing']).toContain(again.status);
  });

  it('a non-retryable failure fails at once with its code and keeps the input', async () => {
    const t = setup(async () => ({ ok: false, code: 'source_missing' }), true);
    const made = await t.queue.enqueue(op({ kind: 'compile', snapshot: '{"text":"x"}', dedupeKey: 'c1' }));
    await t.queue.pump();
    const row = (await t.store.get(made.id))!;
    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('source_missing');
    expect(row.snapshot).toBe('{"text":"x"}');
    expect(t.cleaned).toEqual([]);
  });

  it('a handler that throws fails with a code only, never its message', async () => {
    const t = setup(async () => {
      throw new Error('secret record value 12345');
    }, true);
    const made = await t.queue.enqueue(op());
    await t.queue.pump();
    const row = (await t.store.get(made.id))!;
    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('failed');
    expect(JSON.stringify(row)).not.toContain('12345');
  });

  it('the gate re-checks consent before every attempt', async () => {
    let allowed = false;
    const t = setup(ok, true, { gate: async () => (allowed ? undefined : 'cloud_off') });
    const made = await t.queue.enqueue(op());
    await t.queue.pump();
    expect((await t.store.get(made.id))?.lastError).toBe('cloud_off');
    expect(t.calls).toEqual([]);
    allowed = true;
    await t.queue.retry(made.id);
    await t.queue.pump();
    expect(await t.status(made.id)).toBe('completed');
  });

  it('an oversized result is refused, not stored', async () => {
    const t = setup(async () => ({ ok: true, result: 'x'.repeat(400_001) }), true);
    const made = await t.queue.enqueue(op());
    await t.queue.pump();
    expect((await t.store.get(made.id))?.lastError).toBe('invalid_result');
  });
});

describe('queue: results and input', () => {
  it('keeps the result, and drops the input and its files unless the handler keeps it', async () => {
    const t = setup(async () => ({ ok: true, result: '{"n":1}' }), true);
    const made = await t.queue.enqueue(op({ snapshot: '{"in":1}' }));
    await t.queue.pump();
    const row = (await t.store.get(made.id))!;
    expect(row.result).toBe('{"n":1}');
    expect(row.snapshot).toBeUndefined();
    expect(t.cleaned).toEqual([made.id]);
  });

  it('keepSnapshot keeps the draft for the person to open, and dismiss removes it with its files', async () => {
    const t = setup(async () => ({ ok: true, result: '{"ok":true}', keepSnapshot: true }), true);
    const made = await t.queue.enqueue(op({ kind: 'compile', snapshot: '{"text":"a"}', dedupeKey: 'c' }));
    await t.queue.pump();
    expect((await t.store.get(made.id))?.snapshot).toBe('{"text":"a"}');
    expect(t.cleaned).toEqual([]);
    await t.queue.dismiss(made.id);
    expect(await t.store.get(made.id)).toBeUndefined();
    expect(t.cleaned).toEqual([made.id]);
  });

  it('dismiss refuses an active operation', async () => {
    const t = setup(ok);
    const made = await t.queue.enqueue(op());
    await expect(t.queue.dismiss(made.id)).rejects.toMatchObject({ code: 'wrong_state' });
  });

  it('list puts active first, oldest first, then finished, newest first', async () => {
    const t = setup(ok);
    const a = await t.queue.enqueue(op({ dedupeKey: 'a' }));
    t.w.advance(10);
    const b = await t.queue.enqueue(op({ dedupeKey: 'b' }));
    t.w.advance(10);
    await t.queue.cancel(a.id);
    expect((await t.queue.list()).map((o) => [o.id, o.status])).toEqual([[b.id, 'waiting_for_network'], [a.id, 'cancelled']]);
  });
});

describe('queue: cancel', () => {
  it('cancels a waiting operation: it never runs and its files go', async () => {
    const t = setup(ok);
    const made = await t.queue.enqueue(op({ snapshot: '{"in":1}' }));
    await t.queue.cancel(made.id);
    t.w.go(true);
    await t.queue.pump();
    const row = (await t.store.get(made.id))!;
    expect(row.status).toBe('cancelled');
    expect(row.snapshot).toBeUndefined();
    expect(t.calls).toEqual([]);
    expect(t.cleaned).toEqual([made.id]);
  });

  it('cancels a running operation: the signal fires and a late success is dropped', async () => {
    let release!: () => void;
    let aborted = false;
    const t = setup((_o, ctx) => new Promise<HandlerOutcome>((resolve) => {
      ctx.signal.addEventListener('abort', () => (aborted = true));
      release = () => resolve({ ok: true, result: '{"late":true}' });
    }), true);
    const made = await t.queue.enqueue(op());
    const pass = t.queue.pump();
    await new Promise((r) => setTimeout(r, 0));
    expect(await t.status(made.id)).toBe('processing');
    await t.queue.cancel(made.id);
    expect(aborted).toBe(true);
    release();
    await pass;
    const row = (await t.store.get(made.id))!;
    expect(row.status).toBe('cancelled');
    expect(row.result).toBeUndefined();
  });

  /** A runs and blocks; B was listed in the same pass. `act` changes B while A runs. */
  async function whileAIsRunning(act: (t: ReturnType<typeof setup>, b: PendingOperation) => Promise<void>) {
    let release!: () => void;
    const t = setup((o) => (o.dedupeKey === 'a'
      ? new Promise<HandlerOutcome>((resolve) => { release = () => resolve({ ok: true }); })
      : Promise.resolve<HandlerOutcome>({ ok: true })));
    const a = await t.queue.enqueue(op({ dedupeKey: 'a', snapshot: '{"in":"a"}' }));
    t.w.advance(5);
    const b = await t.queue.enqueue(op({ dedupeKey: 'b', snapshot: '{"in":"typed text"}' }));
    t.w.go(true);
    const pass = t.queue.pump();
    await new Promise((r) => setTimeout(r, 0));
    expect(await t.status(a.id)).toBe('processing');
    await act(t, b);
    release();
    await pass;
    return { t, a, b };
  }

  it('cancelling a waiting operation while another runs: the cancel stands and it never runs', async () => {
    const { t, a, b } = await whileAIsRunning((x, row) => x.queue.cancel(row.id));
    expect(t.calls).toEqual([a.id]);
    const row = (await t.store.get(b.id))!;
    expect(row.status).toBe('cancelled');
    expect(row.snapshot).toBeUndefined();
  });

  it('deleting the owning app while another runs: the row is not written back and it never runs', async () => {
    const { t, a, b } = await whileAIsRunning((x, row) => x.store.remove(row.id));
    expect(t.calls).toEqual([a.id]);
    expect(await t.store.get(b.id)).toBeUndefined();
  });

  it('cancel on a finished operation does nothing; on an unknown id it says not found', async () => {
    const t = setup(ok, true);
    const made = await t.queue.enqueue(op());
    await t.queue.pump();
    await t.queue.cancel(made.id);
    expect(await t.status(made.id)).toBe('completed');
    await expect(t.queue.cancel('nope')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('queue: restart', () => {
  it('a row left processing by a closed app is attempted again once', async () => {
    const t = setup(ok);
    const made = await t.queue.enqueue(op());
    await t.store.put({ ...made, status: 'processing' });
    // A new queue over the same rows is what the next app start sees.
    const second = createOperationQueue({ store: t.store, network: t.w.network, now: t.w.now, handlers: { translate: ok }, setTimer: t.w.setTimer });
    await second.start();
    expect(await t.status(made.id)).toBe('waiting_for_network');
    t.w.go(true);
    await second.pump();
    expect(await t.status(made.id)).toBe('completed');
  });

  it('removes finished rows older than a week, with their files, and keeps the rest', async () => {
    const t = setup(ok, true);
    const old = await t.queue.enqueue(op({ dedupeKey: 'old' }));
    await t.queue.pump();
    t.w.advance(8 * 24 * 60 * 60 * 1000);
    const fresh = await t.queue.enqueue(op({ dedupeKey: 'fresh' }));
    await t.queue.pump();
    const second = createOperationQueue({ store: t.store, network: t.w.network, now: t.w.now, handlers: { translate: ok }, cleanup: async (o) => void t.cleaned.push(`swept:${o.id}`) });
    await second.start();
    expect(await t.store.get(old.id)).toBeUndefined();
    expect(t.cleaned).toContain(`swept:${old.id}`);
    expect(await t.store.get(fresh.id)).toBeDefined();
  });

  it('stop aborts running work and leaves it for the next start', async () => {
    let seen: AbortSignal | undefined;
    const t = setup((_o, ctx) => {
      seen = ctx.signal;
      return new Promise<HandlerOutcome>(() => undefined);
    }, true);
    await t.queue.start();
    const made = await t.queue.enqueue(op());
    await new Promise((r) => setTimeout(r, 0));
    t.queue.stop();
    expect(seen?.aborted).toBe(true);
    expect(await t.status(made.id)).toBe('processing');
  });
});

describe('queue: store notifications', () => {
  it('subscribers hear about every change, and unsubscribe works', async () => {
    const t = setup(ok, true);
    const seen: number[] = [];
    const off = t.queue.subscribe(() => seen.push(1));
    await t.queue.enqueue(op());
    await t.queue.pump();
    expect(seen.length).toBeGreaterThanOrEqual(3); // stored, processing, completed
    off();
    const before = seen.length;
    await t.queue.enqueue(op({ dedupeKey: 'again' }));
    expect(seen.length).toBe(before);
  });
});

it('rows from the store are validated: a bad row is not used', async () => {
  const store = createMemoryOperationStore();
  await expect(store.put({ id: 'bad id!' } as unknown as PendingOperation)).rejects.toThrow();
});
