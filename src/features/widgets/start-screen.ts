import type { KalamSpec } from '@/core/spec/schema';
import { navigate } from '@/runtime/engine/state';
import type { RuntimeState } from '@/runtime/engine/types';

/**
 * Where an app goes when a widget (or its link, `kalam://app/<id>?screen=<screen>`) asks for a screen. One rule for both
 * ways in: a cold start applies it to the first state, and an app that is already open applies it to the state it has, so
 * the second tap on a widget goes to its screen too. An unknown or missing screen leaves the state as it is.
 * `navigate` is the runtime's own move, so Back, bookkeeping of opened entries and the bound on the stack all hold.
 */
export function applyStartScreen(spec: KalamSpec, state: RuntimeState, screen: string | undefined): RuntimeState {
  return (screen ? navigate(spec, state, screen) : undefined) ?? state;
}
