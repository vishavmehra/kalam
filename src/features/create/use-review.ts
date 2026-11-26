/**
 * Hook for the editable Understanding Review (C2, docs/03 §13): the draft spec as a pure reducer from
 * src/core/review, plus what the screen shows. Every edit returns a validated spec or a plain message,
 * so the draft never holds an invalid app. `dispatch` answers at once whether the change was made, so a
 * field can put back its old value when an edit is refused.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import type { CreationResult } from '@/core/contracts';
import {
  finalizeReview, initReview, listUncertainItems, reviewModel, reviewReducer, reviewSummary, type ReviewAction,
} from '@/core/review';
import type { KalamSpec } from '@/core/spec/schema';

export function useReview(result: CreationResult, built: KalamSpec) {
  const [state, setState] = useState(() => initReview(built));
  // The latest state, so two dispatches in one event both build on each other (as useReducer would).
  const latest = useRef(state);
  const dispatch = useCallback((action: ReviewAction): boolean => {
    const next = reviewReducer(latest.current, action);
    latest.current = next;
    setState(next);
    return next.error === undefined;
  }, []);
  const model = useMemo(() => reviewModel(state.spec), [state.spec]); // ids for the controls, never shown
  const summary = useMemo(() => reviewSummary(state.spec, result), [state.spec, result]);
  const uncertain = useMemo(() => listUncertainItems(state.spec, result, state.resolved), [state.spec, state.resolved, result]);
  return { state, dispatch, model, summary, uncertain, finalize: () => finalizeReview(state) };
}

export type ReviewHandle = ReturnType<typeof useReview>;
