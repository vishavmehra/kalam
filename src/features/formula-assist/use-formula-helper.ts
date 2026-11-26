import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { SpecPatchOp } from '@/core/contracts';
import {
  checkFormula, FORMULA_ASSIST_COPY, type FormulaAssistResult, type FormulaFailure, suggestFormula,
} from '@/core/formula-assist';
import type { KalamSpec } from '@/core/spec/schema';
import { getServices } from '@/services';

import { editForUse, helperReducer, parseTyped } from './model';

const FAILED: FormulaFailure = {
  ok: false, reason: 'error', message: FORMULA_ASSIST_COPY.reasons.error, source: 'deterministic', warnings: [],
};

export interface UseFormulaHelper {
  request: string;
  setRequest(text: string): void;
  busy: boolean;
  result?: FormulaAssistResult;
  /** Why the last hand-edited formula was refused. The suggestion stays on screen. */
  problem?: FormulaFailure;
  /** Changes with every new suggestion and every accepted hand edit, so the editable text can start again from the checked formula. */
  revision: string;
  suggest(): void;
  /** Checks a formula the person edited by hand. */
  check(formula: string): void;
  /** Works the shown formula out again on example values the person typed, by field id. */
  tryValues(texts: Readonly<Record<string, string>>): void;
  /** Forgets the last refusal, for when the person keeps editing. */
  clearProblem(): void;
  /** Sends the edit to the editor. Does nothing without a good suggestion. */
  use(): void;
  clear(): void;
}

/**
 * State for the formula helper of one stat. Built lazily from getServices(), so the screen that
 * mounts it needs no setup. Nothing is saved until the person taps "Use this".
 */
export function useFormulaHelper(opts: {
  spec: KalamSpec;
  appId: string;
  componentId: string;
  onUse(ops: SpecPatchOp[], summary: string): void;
}): UseFormulaHelper {
  const { spec, appId, componentId, onUse } = opts;
  const [request, setRequest] = useState('');
  const [problem, setProblem] = useState<FormulaFailure | undefined>(undefined);
  const [edits, setEdits] = useState(0);
  const [state, dispatch] = useReducer(helperReducer, { phase: 'idle' });
  const abort = useRef<AbortController | undefined>(undefined);
  const nextId = useRef(1);
  /** Counts checks. An answer from an older check, or from before a new suggestion, is dropped. */
  const checks = useRef(0);
  useEffect(() => () => abort.current?.abort(), []);

  const suggest = useCallback(() => {
    const text = request.trim();
    if (!text) return;
    abort.current?.abort();
    checks.current += 1;
    const controller = new AbortController();
    abort.current = controller;
    const id = nextId.current++;
    setProblem(undefined);
    dispatch({ type: 'start', id });
    const { ai, db } = getServices();
    void suggestFormula(spec, text, { ai, records: db.records, state: db.state, appId, componentId, now: new Date(), signal: controller.signal })
      .catch((): FormulaAssistResult => FAILED)
      .then((result) => {
        if (!controller.signal.aborted) dispatch({ type: 'finish', id, request: text, result });
      });
  }, [request, spec, appId, componentId]);

  const doneId = state.phase === 'done' ? state.id : undefined;
  const result = state.phase === 'done' ? state.result : undefined;

  /** Checks a formula, with or without example values, for the suggestion that is on screen now. */
  const recheck = useCallback((formula: string, typed?: Record<string, number>) => {
    if (doneId === undefined) return;
    const mine = ++checks.current;
    const { db } = getServices();
    void checkFormula(spec, formula, { records: db.records, state: db.state, appId, componentId, now: new Date(), typed })
      .catch((): FormulaAssistResult => FAILED)
      .then((checked) => {
        if (mine !== checks.current) return;
        if (checked.ok) {
          setProblem(undefined);
          // New text starts from the cleaned formula. New example values leave the text alone.
          if (!typed) setEdits((n) => n + 1);
          dispatch({ type: 'replace', id: doneId, result: checked });
        } else if (!typed) {
          setProblem(checked);
        }
      });
  }, [spec, appId, componentId, doneId]);

  const check = useCallback((formula: string) => recheck(formula), [recheck]);
  const tryValues = useCallback((texts: Readonly<Record<string, string>>) => {
    if (result?.ok) recheck(result.formula, parseTyped(texts));
  }, [recheck, result]);
  const clearProblem = useCallback(() => setProblem(undefined), []);

  const use = useCallback(() => {
    const edit = editForUse(spec, componentId, result);
    if (edit) onUse(edit.ops, edit.summary);
  }, [spec, componentId, result, onUse]);

  const clear = useCallback(() => {
    abort.current?.abort();
    checks.current += 1;
    setProblem(undefined);
    dispatch({ type: 'clear' });
    setRequest('');
  }, []);

  return {
    request, setRequest, busy: state.phase === 'working', result, problem, revision: `${doneId ?? 0}:${edits}`,
    suggest, check, tryValues, clearProblem, use, clear,
  };
}
