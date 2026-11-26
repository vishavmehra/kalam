/**
 * React side of the bounds registry. The edit-by-drawing overlay mounts `<ComponentBoundsProvider>`
 * around the running app; every runtime component spreads `useComponentBounds(c.id)` on its root
 * host view:
 *
 *   const bounds = useComponentBounds(c.id);
 *   return <View {...bounds} style={…}>…</View>;
 *
 * With no provider, or while `tracking` is false, the hook returns the frozen `NO_BOUNDS` object:
 * no ref, no onLayout, no measuring. Turning tracking on re-renders the bound components once so
 * their refs register; turning it off releases them.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { NO_BOUNDS, type ComponentBoundsBinding, type ComponentBoundsRegistry } from './bounds-registry';

const BoundsContext = createContext<ComponentBoundsRegistry | null>(null);

export function ComponentBoundsProvider({ registry, tracking, children }: {
  registry: ComponentBoundsRegistry;
  /** True while the overlay needs component rects. */
  tracking: boolean;
  children: ReactNode;
}) {
  // Not tracking: hand on the outer provider's registry, so two overlays can wrap one app and only the active one measures.
  const outer = useContext(BoundsContext);
  return <BoundsContext.Provider value={tracking ? registry : outer}>{children}</BoundsContext.Provider>;
}

/** Props for the root host view of the component with this KalamSpec id. Call unconditionally. */
export function useComponentBounds(componentId: string): ComponentBoundsBinding {
  const registry = useContext(BoundsContext);
  return registry ? registry.binding(componentId) : NO_BOUNDS;
}
