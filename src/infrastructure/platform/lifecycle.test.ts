import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlushRegistry } from './lifecycle.shared';
import { lifecycle, onSuspend } from './lifecycle.web';

function fakeSuspend() {
  let listeners = 0;
  let fire: () => void = () => {};
  return {
    onSuspend(cb: () => void) {
      listeners++;
      fire = cb;
      return () => void listeners--;
    },
    listeners: () => listeners,
    suspend: () => fire(),
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('flush registry (docs/09 §15.5)', () => {
  it('runs every flusher when the app is suspended', async () => {
    const p = fakeSuspend();
    const reg = createFlushRegistry(p.onSuspend);
    const ran: string[] = [];
    reg.register(() => void ran.push('a'));
    reg.register(async () => {
      await tick();
      ran.push('b');
    });
    p.suspend();
    await tick();
    await tick();
    expect(ran.sort()).toEqual(['a', 'b']);
  });

  it('listens to the platform only while something is registered', () => {
    const p = fakeSuspend();
    const reg = createFlushRegistry(p.onSuspend);
    expect(p.listeners()).toBe(0);
    const off1 = reg.register(() => {});
    const off2 = reg.register(() => {});
    expect(p.listeners()).toBe(1);
    off1();
    expect(p.listeners()).toBe(1);
    off2();
    expect(p.listeners()).toBe(0);
    expect(reg.size).toBe(0);
  });

  it('ignores a flusher that fails, and still runs the others', async () => {
    const reg = createFlushRegistry(fakeSuspend().onSuspend);
    const ok = vi.fn();
    reg.register(() => {
      throw new Error('sync');
    });
    reg.register(async () => {
      throw new Error('async');
    });
    reg.register(ok);
    await expect(reg.flush()).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledOnce();
  });

  it('can be flushed by hand, and a removed flusher no longer runs', async () => {
    const reg = createFlushRegistry(fakeSuspend().onSuspend);
    const f = vi.fn();
    const off = reg.register(f);
    await reg.flush();
    off();
    await reg.flush();
    expect(f).toHaveBeenCalledOnce();
  });
});

describe('web suspend events', () => {
  const g = globalThis as unknown as { window?: EventTarget; document?: EventTarget & { visibilityState: string } };
  afterEach(() => {
    delete g.window;
    delete g.document;
  });

  it('does nothing outside a browser', () => {
    expect(() => onSuspend(() => {})()).not.toThrow();
  });

  it('fires when the page is hidden or closed, not when it becomes visible', () => {
    g.window = new EventTarget();
    g.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const cb = vi.fn();
    const off = onSuspend(cb);
    g.document!.visibilityState = 'hidden';
    g.document!.dispatchEvent(new Event('visibilitychange'));
    expect(cb).toHaveBeenCalledTimes(1);
    g.document!.visibilityState = 'visible';
    g.document!.dispatchEvent(new Event('visibilitychange'));
    expect(cb).toHaveBeenCalledTimes(1);
    g.window!.dispatchEvent(new Event('pagehide'));
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    g.window!.dispatchEvent(new Event('pagehide'));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('the shared registry is wired to it', async () => {
    g.window = new EventTarget();
    g.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const f = vi.fn();
    const off = lifecycle.register(f);
    g.window!.dispatchEvent(new Event('pagehide'));
    await tick();
    expect(f).toHaveBeenCalledOnce();
    off();
  });
});
