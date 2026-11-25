/**
 * Component bounds registry (docs/08 §16.5, docs/04 §12.5). Lets the edit-by-drawing overlay map
 * marks on the running app to KalamSpec component ids from real on-screen geometry, never from AI.
 *
 * Runtime components spread `useComponentBounds(c.id)` on their root host view (see
 * ./ComponentBounds.tsx). The registry only keeps node references. Nothing is measured until the
 * overlay asks, and with no overlay the hook hands out a constant empty object, so normal app use
 * pays nothing. Pure TypeScript: no React or React Native imports, so it runs under Vitest.
 */

export interface BoundsRect { x: number; y: number; width: number; height: number }

/**
 * The part of a host node we need. RN 0.88 host instances (ReactNativeElement) have both methods;
 * react-native-web refs are DOM elements with `getBoundingClientRect` (plus RNW's measure helpers).
 */
export interface MeasurableNode {
  getBoundingClientRect?: () => { left: number; top: number; width: number; height: number };
  measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
}

/** Props to spread on a component's root host view (`View`, `Text`, `Pressable`). */
export interface ComponentBoundsBinding {
  ref?: (node: MeasurableNode | null) => void | (() => void);
  onLayout?: () => void;
}

export interface ComponentBoundsRegistry {
  /** Stable binding for one component id (same object on every call). */
  binding(id: string): ComponentBoundsBinding;
  /** Ids that currently have a mounted node. */
  ids(): string[];
  /**
   * Measures every mounted component relative to `origin` (the overlay's root view). Parts with no
   * size (unmounted, collapsed) are left out.
   */
  measure(origin: MeasurableNode): Promise<Map<string, BoundsRect>>;
  /** Something moved or resized: listeners re-measure. */
  invalidate(): void;
  /** Called on mount, unmount and layout changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** Returned when no overlay is tracking bounds: spreading it adds no props at all. */
export const NO_BOUNDS: ComponentBoundsBinding = Object.freeze({});

const finite = (...n: number[]) => n.every((v) => Number.isFinite(v));

/** Window/viewport rect of a node, or undefined when it cannot be measured right now. */
export function measureNode(node: MeasurableNode, timeoutMs = 400): Promise<BoundsRect | undefined> {
  try {
    if (typeof node.getBoundingClientRect === 'function') {
      // Synchronous on web and on RN's DOM-style node API; includes transforms on both.
      const r = node.getBoundingClientRect();
      return Promise.resolve(finite(r.left, r.top, r.width, r.height) ? { x: r.left, y: r.top, width: r.width, height: r.height } : undefined);
    }
    const measureInWindow = node.measureInWindow;
    if (typeof measureInWindow === 'function') {
      return new Promise((resolve) => {
        let settled = false;
        const done = (rect: BoundsRect | undefined) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(rect);
        };
        // A node that unmounts mid-measure may never call back.
        const timer = setTimeout(() => done(undefined), timeoutMs);
        try {
          measureInWindow.call(node, (x, y, width, height) => done(finite(x, y, width, height) ? { x, y, width, height } : undefined));
        } catch {
          done(undefined);
        }
      });
    }
  } catch {
    // Fall through: a detached node is simply not measurable.
  }
  return Promise.resolve(undefined);
}

export function createBoundsRegistry(opts: { measureTimeoutMs?: number } = {}): ComponentBoundsRegistry {
  const nodes = new Map<string, MeasurableNode>();
  const bindings = new Map<string, ComponentBoundsBinding>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  return {
    binding(id) {
      let b = bindings.get(id);
      if (!b) {
        b = {
          ref: (node) => {
            // React 19 calls the returned cleanup on detach instead of ref(null).
            if (!node) return undefined;
            nodes.set(id, node);
            notify();
            return () => {
              if (nodes.get(id) !== node) return; // a newer node already took this id
              nodes.delete(id);
              notify();
            };
          },
          onLayout: notify,
        };
        bindings.set(id, b);
      }
      return b;
    },
    ids: () => [...nodes.keys()],
    async measure(origin) {
      const out = new Map<string, BoundsRect>();
      const o = await measureNode(origin, opts.measureTimeoutMs);
      if (!o) return out;
      const entries = await Promise.all(
        [...nodes].map(async ([id, node]) => [id, await measureNode(node, opts.measureTimeoutMs)] as const),
      );
      for (const [id, r] of entries) {
        if (r && r.width > 0 && r.height > 0) out.set(id, { x: r.x - o.x, y: r.y - o.y, width: r.width, height: r.height });
      }
      return out;
    },
    invalidate: notify,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
