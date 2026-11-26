/**
 * React side of the runtime context (docs/09 §6). KalamRuntime creates the value once per app instance with
 * `createRuntimeContext` (engine/context.ts) and wraps what it renders in the provider; blocks read it with
 * `useRuntimeContext` instead of taking services, caches and snapshots as props.
 */
import { createContext, useContext } from 'react';
import type { RuntimeContextValue } from './engine/context';

const Context = createContext<RuntimeContextValue | null>(null);

export const RuntimeContextProvider = Context.Provider;

export function useRuntimeContext(): RuntimeContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('useRuntimeContext must be used inside a running app');
  return value;
}

/** For a block that also renders outside a running app (a gallery preview): null instead of throwing. */
export function useOptionalRuntimeContext(): RuntimeContextValue | null {
  return useContext(Context);
}
