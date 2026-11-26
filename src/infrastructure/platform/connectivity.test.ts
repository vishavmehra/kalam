import { describe, expect, it } from 'vitest';
import type { NetworkMonitor } from '@/core/contracts';
import { createConnectivity, looksUnreachable, RETRY_AFTER_MS, type ConnectivitySnapshot } from './connectivity';

function fakeMonitor(start = true) {
  let online = start;
  const listeners = new Set<(o: boolean) => void>();
  const monitor: NetworkMonitor = {
    online: () => online,
    subscribe(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
  return {
    monitor,
    set(next: boolean) {
      online = next;
      listeners.forEach((l) => l(next));
    },
    listeners,
  };
}

function setup(start = true) {
  const m = fakeMonitor(start);
  let t = 1_000;
  const c = createConnectivity(m.monitor, () => t);
  return { ...m, c, advance: (ms: number) => void (t += ms), time: () => t };
}

describe('connectivity service (docs/09 §13.4)', () => {
  it('reports online or offline and the time of the last change', () => {
    const s = setup();
    expect(s.c.online()).toBe(true);
    expect(s.c.lastChange()).toBeNull();
    s.advance(500);
    s.set(false);
    expect(s.c.online()).toBe(false);
    expect(s.c.lastChange()).toBe(1_500);
    s.advance(500);
    s.set(false); // same state again is not a change
    expect(s.c.lastChange()).toBe(1_500);
    s.advance(500);
    s.set(true);
    expect(s.c.lastChange()).toBe(2_500);
  });

  it('works as a NetworkMonitor for code that takes one', () => {
    const s = setup();
    const heard: boolean[] = [];
    const off = s.c.subscribe((o) => heard.push(o));
    s.set(false);
    s.set(true);
    off();
    s.set(false);
    expect(heard).toEqual([false, true]);
  });

  it('local work always may proceed; cloud work needs the platform online', () => {
    const s = setup(false);
    expect(s.c.can('local')).toBe(true);
    expect(s.c.can('cloud')).toBe(false);
    s.set(true);
    expect(s.c.can('cloud')).toBe(true);
  });

  it('counts cloud calls in flight and calls that wait elsewhere', async () => {
    const s = setup();
    const seen: number[] = [];
    s.c.watch((x) => seen.push(x.pending));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = s.c.track(async () => {
      await gate;
      return 'done';
    });
    expect(s.c.pending()).toBe(1);
    const off = s.c.addPendingSource(() => 3);
    expect(s.c.pending()).toBe(4);
    off();
    release();
    expect(await run).toBe('done');
    expect(s.c.pending()).toBe(0);
    expect(seen).toContain(1);
    expect(seen.at(-1)).toBe(0);
  });

  it('survives a pending source that throws', () => {
    const s = setup();
    s.c.addPendingSource(() => {
      throw new Error('boom');
    });
    s.c.addPendingSource(() => 2);
    expect(s.c.pending()).toBe(2);
  });

  it('holds cloud work back after a network failure, then lets a retry through', async () => {
    const s = setup();
    await expect(s.c.track(async () => { throw new TypeError('Failed to fetch'); })).rejects.toThrow('Failed to fetch');
    expect(s.c.online()).toBe(true); // the platform still says online: a hint, not proof
    expect(s.c.can('cloud')).toBe(false);
    expect(s.c.snapshot().reachable).toBe(false);
    s.advance(RETRY_AFTER_MS - 1);
    expect(s.c.can('cloud')).toBe(false);
    s.advance(1);
    expect(s.c.can('cloud')).toBe(true);
  });

  it('clears the mark on a success or when the platform reports a change', async () => {
    const s = setup();
    await s.c.track(async () => { throw Object.assign(new Error('x'), { code: 'functions/unavailable' }); }).catch(() => undefined);
    expect(s.c.can('cloud')).toBe(false);
    s.set(false);
    s.set(true);
    expect(s.c.can('cloud')).toBe(true);

    await s.c.track(async () => { throw new Error('Network request failed'); }).catch(() => undefined);
    expect(s.c.can('cloud')).toBe(false);
    await s.c.track(async () => 1); // a call that went through proves the cloud answers
    expect(s.c.can('cloud')).toBe(true);
    await s.c.track(async () => { throw new Error('not a network problem'); }).catch(() => undefined);
    expect(s.c.can('cloud')).toBe(true);
  });

  it('keeps one broken listener from stopping the others, and stops after dispose', () => {
    const s = setup();
    const heard: boolean[] = [];
    s.c.subscribe(() => {
      throw new Error('bad');
    });
    s.c.subscribe((o) => heard.push(o));
    s.set(false);
    expect(heard).toEqual([false]);
    s.c.dispose();
    expect(s.listeners.size).toBe(0);
    const watched: ConnectivitySnapshot[] = [];
    s.c.watch((x) => watched.push(x));
    s.set(true);
    expect(watched).toEqual([]);
  });

  it('tells a network failure from a refused request', () => {
    expect(looksUnreachable(new TypeError('Failed to fetch'))).toBe(true);
    expect(looksUnreachable(Object.assign(new Error('x'), { code: 'auth/network-request-failed' }))).toBe(true);
    expect(looksUnreachable(Object.assign(new Error('x'), { code: 'functions/deadline-exceeded' }))).toBe(true);
    expect(looksUnreachable(Object.assign(new Error('x'), { code: 'functions/permission-denied' }))).toBe(false);
    expect(looksUnreachable(new Error('The model refused the request'))).toBe(false);
    expect(looksUnreachable('plain string')).toBe(false);
    expect(looksUnreachable(null)).toBe(false);
  });
});
