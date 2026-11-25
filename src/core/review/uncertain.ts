/**
 * Uncertain items in the Understanding Review (docs/03 §13.4, docs/06 §11.5 and §20, docs/08 §15.8,
 * docs/10 §10.5): what Kalam is unsure about, each with the actions the person can take. Sources are
 * the compiler's own output (its assumptions and open questions), the checks on the current draft
 * (screens nobody can reach, unused data, unchecked AI steps) and the build-time AI-step reports.
 * Trivial visual details such as long labels are left out on purpose (docs/03 §13.4).
 */
import type { CreationResult, SpecIssue } from '../contracts';
import { describeSpec } from '../spec/describe';
import type { KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { REVIEW_COPY } from './copy';
import { applyReviewEdit, locateIssue, type ReviewEdit, type ReviewResult } from './edits';

export type UncertainAction = 'accept' | 'change' | 'remove';

export interface UncertainItem {
  /** Stable key for the UI and for remembering what the person already answered. */
  id: string;
  /** 'check': found in the app itself. 'assumption' and 'question': the compiler's own words. */
  kind: 'check' | 'assumption' | 'question';
  /** Plain sentence for the person: no ids, no schema paths. */
  message: string;
  /** The one part of the app the item is about, when there is one. */
  target?: { type: 'screen' | 'component' | 'collection' | 'aiBlock'; id: string };
  actions: UncertainAction[];
  /** The fix behind 'change' when Kalam can make it here. Without it, 'change' asks for words and a rebuild. */
  change?: ReviewEdit;
  /** The edit behind 'remove'. */
  remove?: ReviewEdit;
}

/** The build result the review starts from. */
export type ReviewSource = Pick<CreationResult, 'route' | 'spec' | 'warnings' | 'understanding' | 'clarifications' | 'verification'>;

/** The compiler's own assumptions: the review summary minus what describeSpec says about every app. */
function modelAssumptions(source?: ReviewSource): string[] {
  if (!source?.spec || !source.understanding || source.route.startsWith('template')) return [];
  const general = new Set(describeSpec(source.spec).assumptions);
  return [...new Set(source.understanding.assumptions.filter((a) => !general.has(a)))];
}

function fromCheck(spec: KalamSpec, w: SpecIssue, source?: ReviewSource): UncertainItem | undefined {
  const at = locateIssue(spec, w.path);
  if (!at) return undefined;
  switch (w.code) {
    case 'UNREACHABLE_SCREEN': {
      const screen = spec.screens.find((s) => s.id === at.id);
      if (!screen || at.type !== 'screen') return undefined;
      return {
        id: `check:unreachable:${screen.id}`, kind: 'check', message: REVIEW_COPY.items.unreachable(screen.title), target: at,
        actions: ['accept', 'change', 'remove'],
        change: { kind: 'linkScreen', screenId: screen.id }, remove: { kind: 'removeScreen', screenId: screen.id },
      };
    }
    case 'UNUSED_COLLECTION': {
      const col = spec.collections[at.id];
      if (!col || at.type !== 'collection') return undefined;
      return {
        id: `check:unused:${at.id}`, kind: 'check', message: REVIEW_COPY.items.unused(col.label || at.id.replace(/_+/g, ' ')), target: at,
        actions: ['accept', 'remove'], remove: { kind: 'removeCollection', collectionId: at.id },
      };
    }
    case 'NO_SELECTED_RECORD':
    case 'FORM_MISMATCH': {
      const button = spec.screens.flatMap((s) => s.children).find((c) => c.id === at.id);
      if (button?.type !== 'bigButton') return undefined;
      const message = w.code === 'FORM_MISMATCH' ? REVIEW_COPY.items.formMismatch(button.label) : REVIEW_COPY.items.noSelected(button.label);
      return {
        id: `check:${w.code === 'FORM_MISMATCH' ? 'form' : 'selected'}:${button.id}`, kind: 'check', message, target: at,
        actions: ['accept', 'remove'], remove: { kind: 'removeComponent', componentId: button.id },
      };
    }
    case 'UNVERIFIED_AI_BLOCK': {
      if (at.type !== 'aiBlock' || !spec.aiBlocks[at.id]) return undefined;
      const report = source?.verification?.find((r) => r.blockId === at.id);
      return {
        id: `check:untested:${at.id}`, kind: 'check', message: report?.message || REVIEW_COPY.items.untested, target: at,
        actions: ['accept', 'remove'], remove: { kind: 'removeAIBlock', blockId: at.id },
      };
    }
    default:
      return undefined;
  }
}

/**
 * Everything Kalam is unsure about in the current draft, minus what the person already answered.
 * Checks are re-run on `spec`, so fixing something in the review makes its item go away.
 */
export function listUncertainItems(spec: KalamSpec, source?: ReviewSource, resolved: readonly string[] = []): UncertainItem[] {
  const items: UncertainItem[] = [];
  for (const w of validateSpec(spec).warnings) {
    const item = fromCheck(spec, w, source);
    if (item && !items.some((x) => x.id === item.id)) items.push(item);
  }
  if (source?.warnings.some((w) => w.code === 'generated_on_device')) {
    const w = source.warnings.find((x) => x.code === 'generated_on_device');
    items.push({ id: 'check:generated_on_device', kind: 'check', message: w?.message ?? '', actions: ['accept'] });
  }
  modelAssumptions(source).forEach((a, i) => items.push({ id: `assumption:${i}`, kind: 'assumption', message: a, actions: ['accept', 'change'] }));
  (source?.clarifications ?? []).forEach((q, i) => items.push({ id: `question:${i}`, kind: 'question', message: q, actions: ['accept', 'change'] }));
  const done = new Set(resolved);
  return items.filter((x) => !done.has(x.id));
}

export type ResolveResult = (ReviewResult & { ok: false }) | { ok: true; spec: KalamSpec; rebuild?: string };

/**
 * Applies the person's answer to one item. 'accept' keeps the app as it is. 'remove' and a local
 * 'change' return a new validated spec. A 'change' Kalam cannot make here (an assumption or open
 * question) turns the person's words into an instruction for a rebuild (docs/06 §11.5).
 */
export function resolveUncertainItem(spec: KalamSpec, item: UncertainItem, action: UncertainAction, answer?: string): ResolveResult {
  if (!item.actions.includes(action)) {
    return { ok: false, error: action === 'remove' ? REVIEW_COPY.cannotRemove : REVIEW_COPY.unchanged, issues: [] };
  }
  if (action === 'accept') return { ok: true, spec };
  const edit = action === 'remove' ? item.remove : item.change;
  if (edit) return applyReviewEdit(spec, edit);
  const words = answer?.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!words) return { ok: false, error: REVIEW_COPY.needAnswer, issues: [] };
  const rebuild = item.kind === 'question'
    ? REVIEW_COPY.correction.question(item.message, words)
    : REVIEW_COPY.correction.assumption(item.message, words);
  return { ok: true, spec, rebuild };
}
