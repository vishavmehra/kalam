/**
 * Understanding Review state as a pure reducer, so the screen's hook is `useReducer(reviewReducer,
 * spec, initReview)`. The draft is always a validated spec; a rejected edit leaves it unchanged and
 * sets a plain message. Continue (docs/03 §13.5) validates once more and names the item to fix.
 */
import type { SpecIssue, UnderstandingSummary } from '../contracts';
import { withCheckMessages } from '../pipeline/verify-blocks';
import { describeSpec } from '../spec/describe';
import type { KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { applyReviewEdit, explainIssues, locateIssue, type ReviewEdit } from './edits';
import { resolveUncertainItem, type ReviewSource, type UncertainAction, type UncertainItem } from './uncertain';

/**
 * The plain-language summary of the current draft, with the build-time check words for AI steps
 * that are not checked yet. The compiler's own assumptions are not repeated here: they are
 * uncertain items with their own actions (listUncertainItems).
 */
export function reviewSummary(spec: KalamSpec, source?: Pick<ReviewSource, 'verification'>): UnderstandingSummary {
  return withCheckMessages(describeSpec(spec), source?.verification ?? []);
}

export interface ReviewState {
  /** The app as Kalam built it; Reset goes back to this. */
  original: KalamSpec;
  /** The draft the person is correcting. Always valid. */
  spec: KalamSpec;
  /** Uncertain item ids the person answered. */
  resolved: string[];
  /** Answers that need a rebuild with the cloud compiler, in the order given. */
  rebuild: string[];
  /** Plain message for the last change that could not be made. */
  error?: string;
  /** Number of changes made; 0 means the draft is the app as built. */
  edits: number;
}

export type ReviewAction =
  | { type: 'edit'; edit: ReviewEdit }
  | { type: 'resolve'; item: UncertainItem; action: UncertainAction; answer?: string }
  | { type: 'reset' }
  | { type: 'clearError' };

export function initReview(spec: KalamSpec): ReviewState {
  return { original: spec, spec, resolved: [], rebuild: [], edits: 0 };
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'edit': {
      const r = applyReviewEdit(state.spec, action.edit);
      return r.ok ? { ...state, spec: r.spec, error: undefined, edits: state.edits + 1 } : { ...state, error: r.error };
    }
    case 'resolve': {
      const r = resolveUncertainItem(state.spec, action.item, action.action, action.answer);
      if (!r.ok) return { ...state, error: r.error };
      return {
        ...state,
        spec: r.spec,
        error: undefined,
        resolved: state.resolved.includes(action.item.id) ? state.resolved : [...state.resolved, action.item.id],
        rebuild: r.rebuild ? [...state.rebuild, r.rebuild] : state.rebuild,
        edits: r.spec === state.spec ? state.edits : state.edits + 1,
      };
    }
    case 'reset':
      return initReview(state.original);
    case 'clearError':
      return state.error === undefined ? state : { ...state, error: undefined };
  }
}

export type ReviewFinal =
  | { ok: true; spec: KalamSpec }
  | { ok: false; error: string; issues: SpecIssue[]; target?: ReturnType<typeof locateIssue> };

/** Continue: validate the corrected app once more; on failure, say what is wrong and where (docs/03 §13.5). */
export function finalizeReview(state: ReviewState): ReviewFinal {
  const v = validateSpec(state.spec);
  if (v.ok && v.spec) return { ok: true, spec: v.spec };
  const first = v.errors[0];
  return { ok: false, error: explainIssues(v.errors), issues: v.errors, target: first ? locateIssue(state.spec, first.path) : undefined };
}
