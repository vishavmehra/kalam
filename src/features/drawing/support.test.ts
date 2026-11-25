import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument } from './model';
import { createAutosaver, type AutosaveDeps } from './autosave';
import { createImageCache } from './image-cache-core';
import { clearRecovery, readRecovery, writeRecovery, type StorageLike } from './recovery';

describe('autosave', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function harness(failures = 0) {
    const state = { dirty: false, saves: 0, failuresLeft: failures, statuses: [] as string[] };
    const deps: AutosaveDeps = {
      isDirty: () => state.dirty,
      onStatus: (s) => { state.statuses.push(s); },
      save: async () => {
        if (state.failuresLeft > 0) { state.failuresLeft -= 1; throw new Error('disk full'); }
        state.saves += 1;
        state.dirty = false;
      },
    };
    return { state, saver: createAutosaver(deps, { debounceMs: 800, retryMs: [2000, 5000] }) };
  }

  it('waits for the debounce, then saves once for many changes', async () => {
    const { state, saver } = harness();
    state.dirty = true;
    saver.notify(); saver.notify(); saver.notify();
    await vi.advanceTimersByTimeAsync(799);
    expect(state.saves).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(state.saves).toBe(1);
    expect(state.statuses).toEqual(['saving']);
  });

  it('retries a failed write with a growing delay until it works', async () => {
    const { state, saver } = harness(2);
    state.dirty = true;
    saver.notify();
    await vi.advanceTimersByTimeAsync(800);
    expect(state.saves).toBe(0);
    expect(state.statuses.at(-1)).toBe('error');
    await vi.advanceTimersByTimeAsync(1999);
    expect(state.saves).toBe(0);
    await vi.advanceTimersByTimeAsync(2); // first retry at 2 s fails again
    expect(state.saves).toBe(0);
    await vi.advanceTimersByTimeAsync(5001); // second retry at 5 s works
    expect(state.saves).toBe(1);
    expect(state.dirty).toBe(false);
  });

  it('flushes immediately and reports whether the drawing is safe', async () => {
    const { state, saver } = harness();
    state.dirty = true;
    saver.notify();
    expect(await saver.flush()).toBe(true);
    expect(state.saves).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.saves).toBe(1);
    expect(await saver.flush()).toBe(true); // nothing to save
    expect(state.saves).toBe(1);
  });

  it('reports failure on flush and stops retrying after dispose', async () => {
    const { state, saver } = harness(1);
    state.dirty = true;
    expect(await saver.flush()).toBe(false);
    saver.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.saves).toBe(0);
    saver.notify();
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.saves).toBe(0);
  });

  it('does not run two writes at once', async () => {
    let running = 0; let peak = 0; let dirty = true;
    const saver = createAutosaver({
      isDirty: () => dirty,
      onStatus: () => {},
      save: async () => {
        running += 1; peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 100));
        running -= 1; dirty = false;
      },
    });
    const a = saver.flush();
    const b = saver.flush();
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all([a, b]);
    expect(peak).toBe(1);
  });
});

describe('image cache', () => {
  const png = { base64: 'AAAA', mimeType: 'image/png' };

  it('loads on first use, notifies, and serves the decoded image afterwards', async () => {
    const cache = createImageCache<string>((p) => `decoded:${p.base64}`);
    const loader = vi.fn(async () => png);
    cache.setLoader(loader);
    const seen = vi.fn();
    cache.subscribe(seen);
    expect(cache.get('b1')).toBeUndefined();
    expect(cache.get('b1')).toBeUndefined(); // still loading: no second request
    await cache.ensure(['b1']);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.get('b1')).toBe('decoded:AAAA');
    expect(seen).toHaveBeenCalled();
    expect(cache.version()).toBeGreaterThan(0);
  });

  it('marks missing or unsafe blobs and does not retry them', async () => {
    const cache = createImageCache<string>(() => 'x');
    const loader = vi.fn(async (id: string) => (id === 'gone' ? undefined : { base64: 'AA', mimeType: 'text/html' }));
    cache.setLoader(loader);
    await cache.ensure(['gone', 'html']);
    expect(cache.isMissing('gone')).toBe(true);
    expect(cache.isMissing('html')).toBe(true);
    expect(cache.get('gone')).toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('accepts bytes already in hand and survives a decoder that fails', async () => {
    const cache = createImageCache<string>((p) => { if (p.base64 === 'bad') throw new Error('corrupt'); return 'ok'; });
    await cache.put('fresh', png);
    expect(cache.get('fresh')).toBe('ok');
    await cache.put('broken', { base64: 'bad', mimeType: 'image/jpeg' });
    expect(cache.isMissing('broken')).toBe(true);
  });

  it('does nothing without a loader', async () => {
    const cache = createImageCache<string>(() => 'x');
    expect(cache.get('a')).toBeUndefined();
    await cache.ensure(['a']);
    expect(cache.isMissing('a')).toBe(false);
  });
});

describe('recovery copy', () => {
  function memory(): StorageLike & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } };
  }

  it('writes, reads back and clears an emergency copy', () => {
    const store = memory();
    const doc = createDocument(1, 'drw_r');
    expect(writeRecovery(store, doc, 500)).toBe(true);
    const raw = readRecovery(store, 'drw_r') as { updatedAt: number; id: string };
    expect(raw).toMatchObject({ id: 'drw_r', updatedAt: 500 });
    clearRecovery(store, 'drw_r');
    expect(readRecovery(store, 'drw_r')).toBeUndefined();
  });

  it('never throws: no storage, full storage, bad JSON', () => {
    const doc = createDocument(1, 'drw_r');
    expect(writeRecovery(undefined, doc)).toBe(false);
    const full: StorageLike = { getItem: () => '{oops', setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(writeRecovery(full, doc)).toBe(false);
    expect(readRecovery(full, 'x')).toBeUndefined();
    expect(() => clearRecovery(full, 'x')).not.toThrow();
    expect(readRecovery(undefined, 'x')).toBeUndefined();
  });
});
