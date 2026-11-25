/**
 * The helper's small state machine and the edit it produces. No React in here, so it is tested on its own.
 */
import type { SpecPatchOp } from '@/core/contracts';
import { type FormulaAssistResult, formulaEditOps } from '@/core/formula-assist';
import type { KalamSpec } from '@/core/spec/schema';

import { COPY } from './copy';

export type HelperState =
  | { phase: 'idle' }
  | { phase: 'working'; id: number }
  | { phase: 'done'; id: number; request: string; result: FormulaAssistResult };

export type HelperAction =
  | { type: 'start'; id: number }
  | { type: 'finish'; id: number; request: string; result: FormulaAssistResult }
  | { type: 'clear' };

export function helperReducer(state: HelperState, action: HelperAction): HelperState {
  switch (action.type) {
    case 'start': return { phase: 'working', id: action.id };
    // An answer for an older request, or one that was cleared while it was running, is dropped.
    case 'finish': return state.phase === 'working' && state.id === action.id ? { phase: 'done', id: action.id, request: action.request, result: action.result } : state;
    case 'clear': return { phase: 'idle' };
  }
}

/** The label of the stat the formula is for, as people see it. */
export const statLabel = (spec: KalamSpec, componentId: string): string => {
  const c = spec.screens.flatMap((s) => s.children).find((x) => x.id === componentId);
  return c && 'label' in c && typeof c.label === 'string' && c.label ? c.label : 'this number';
};

/** What "Use this" sends to the editor: the existing set-property op and a one-line history summary. */
export function useThisEdit(spec: KalamSpec, componentId: string, result: FormulaAssistResult | undefined): { ops: SpecPatchOp[]; summary: string } | undefined {
  if (!result?.ok) return undefined;
  return { ops: formulaEditOps(componentId, result.formula), summary: COPY.summary(statLabel(spec, componentId)) };
}
