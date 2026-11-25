import type { ComponentProps } from 'react';
import type { Pressable, Text, View } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { createBoundsRegistry, measureNode, NO_BOUNDS, type MeasurableNode } from './bounds-registry';

describe('integration contract (checked by tsc)', () => {
  it('spreads onto the host roots runtime components use: View, Text and Pressable', () => {
    const binding = createBoundsRegistry().binding('save');
    const asView: ComponentProps<typeof View> = { ...binding };
    const asText: ComponentProps<typeof Text> = { ...binding };
    const asPressable: ComponentProps<typeof Pressable> = { ...binding };
    for (const props of [asView, asText, asPressable]) expect(Object.keys(props).sort()).toEqual(['onLayout', 'ref']);
  });
});

const rectNode = (x: number, y: number, width: number, height: number): MeasurableNode => ({
  getBoundingClientRect: () => ({ left: x, top: y, width, height }),
});
const windowNode = (x: number, y: number, width: number, height: number): MeasurableNode => ({
  measureInWindow: (cb) => setTimeout(() => cb(x, y, width, height), 0),
});

/** Attaches like React 19 does: call the ref, keep the cleanup it returns. */
function attach(registry: ReturnType<typeof createBoundsRegistry>, id: string, node: MeasurableNode) {
  const cleanup = registry.binding(id).ref?.(node);
  return typeof cleanup === 'function' ? cleanup : () => undefined;
}

describe('bounds registry', () => {
  it('hands out one stable binding per id', () => {
    const r = createBoundsRegistry();
    expect(r.binding('save')).toBe(r.binding('save'));
    expect(r.binding('save')).not.toBe(r.binding('notes'));
  });

  it('NO_BOUNDS adds nothing when spread', () => {
    expect(Object.keys(NO_BOUNDS)).toEqual([]);
    expect(Object.isFrozen(NO_BOUNDS)).toBe(true);
  });

  it('measures mounted parts relative to the overlay origin', async () => {
    const r = createBoundsRegistry();
    attach(r, 'title', rectNode(110, 80, 300, 40));
    attach(r, 'save', windowNode(110, 400, 300, 56));
    const rects = await r.measure(rectNode(100, 50, 400, 700));
    expect(rects.get('title')).toEqual({ x: 10, y: 30, width: 300, height: 40 });
    expect(rects.get('save')).toEqual({ x: 10, y: 350, width: 300, height: 56 });
  });

  it('drops parts with no size and parts that fail to measure', async () => {
    const r = createBoundsRegistry({ measureTimeoutMs: 20 });
    attach(r, 'collapsed', rectNode(0, 0, 0, 0));
    attach(r, 'throws', { getBoundingClientRect: () => { throw new Error('detached'); } });
    attach(r, 'silent', { measureInWindow: () => undefined });
    attach(r, 'ok', rectNode(5, 5, 10, 10));
    const rects = await r.measure(rectNode(0, 0, 100, 100));
    expect([...rects.keys()]).toEqual(['ok']);
  });

  it('returns nothing when the origin itself cannot be measured', async () => {
    const r = createBoundsRegistry();
    attach(r, 'ok', rectNode(5, 5, 10, 10));
    expect((await r.measure({})).size).toBe(0);
  });

  it('cleanup removes a node, but never a newer node that took the same id', () => {
    const r = createBoundsRegistry();
    const first = attach(r, 'save', rectNode(0, 0, 1, 1));
    attach(r, 'save', rectNode(0, 0, 2, 2)); // remount before the old cleanup ran
    first();
    expect(r.ids()).toEqual(['save']);
    const solo = attach(r, 'notes', rectNode(0, 0, 1, 1));
    solo();
    expect(r.ids()).toEqual(['save']);
  });

  it('ignores ref(null) (React 19 uses the returned cleanup)', () => {
    const r = createBoundsRegistry();
    attach(r, 'save', rectNode(0, 0, 1, 1));
    r.binding('save').ref?.(null);
    expect(r.ids()).toEqual(['save']);
  });

  it('notifies listeners on mount, unmount and layout, until unsubscribed', () => {
    const r = createBoundsRegistry();
    const listener = vi.fn();
    const off = r.subscribe(listener);
    const detach = attach(r, 'save', rectNode(0, 0, 1, 1));
    r.binding('save').onLayout?.();
    detach();
    expect(listener).toHaveBeenCalledTimes(3);
    off();
    r.invalidate();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('measureNode', () => {
  it('prefers the synchronous rect when a node has both methods', async () => {
    const measureInWindow = vi.fn();
    const rect = await measureNode({ getBoundingClientRect: () => ({ left: 1, top: 2, width: 3, height: 4 }), measureInWindow });
    expect(rect).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(measureInWindow).not.toHaveBeenCalled();
  });

  it('rejects non-finite numbers', async () => {
    expect(await measureNode(rectNode(Number.NaN, 0, 1, 1))).toBeUndefined();
  });
});
