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
  /** A hand-edited formula, or new example values, that passed the checks take the place of the suggestion on screen. Only for the same request. */
  | { type: 'replace'; id: number; result: FormulaAssistResult }
  | { type: 'clear' };

export function helperReducer(state: HelperState, action: HelperAction): HelperState {
  switch (action.type) {
    case 'start': return { phase: 'working', id: action.id };
    // An answer for an older request, or one that was cleared while it was running, is dropped.
    case 'finish': return state.phase === 'working' && state.id === action.id ? { phase: 'done', id: action.id, request: action.request, result: action.result } : state;
    case 'replace': return state.phase === 'done' && state.id === action.id && action.result.ok ? { ...state, result: action.result } : state;
    case 'clear': return { phase: 'idle' };
  }
}

/** The label of the stat the formula is for, as people see it. */
export const statLabel = (spec: KalamSpec, componentId: string): string => {
  const c = spec.screens.flatMap((s) => s.children).find((x) => x.id === componentId);
  return c && 'label' in c && typeof c.label === 'string' && c.label ? c.label : COPY.thisNumber;
};

/** What "Use this" sends to the editor: the existing set-property op and a one-line history summary. */
export function editForUse(spec: KalamSpec, componentId: string, result: FormulaAssistResult | undefined): { ops: SpecPatchOp[]; summary: string } | undefined {
  if (!result?.ok) return undefined;
  return { ops: formulaEditOps(componentId, result.formula), summary: COPY.summary(statLabel(spec, componentId)) };
}

export interface StatChoice { id: string; label: string; screen: string; expr: string }

/** Every stat in the app, in screen order, for choosing which number to change. */
export function statChoices(spec: KalamSpec): StatChoice[] {
  return spec.screens.flatMap((s) => s.children.flatMap((c) => (c.type === 'stat' ? [{ id: c.id, label: c.label, screen: s.title, expr: c.expr }] : [])));
}

/**
 * Example values the person typed, as numbers by field id. Commas and spaces are allowed ("1,000").
 * Text that is not a plain number is left out, so that value keeps its made-up sample.
 */
export function parseTyped(texts: Readonly<Record<string, string>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, text] of Object.entries(texts)) {
    const cleaned = text.replace(/[,\s]/g, '');
    if (/^-?\d+(?:\.\d+)?$/.test(cleaned) && Number.isFinite(Number(cleaned))) out[id] = Number(cleaned);
  }
  return out;
}
