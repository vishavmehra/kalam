/**
 * The "New widget" form, without React: what the person has filled in, how it becomes a widget draft, and what is still
 * missing. The rules about what a widget may point at stay in `src/core/widgets`; this only turns choices into a draft.
 */
import {
  newDraft, suggestedTitle, WIDGET_LIMITS,
  type WidgetCandidate, type WidgetDefinition, type WidgetDraft, type WidgetRefresh, type WidgetSize, type WidgetSourceRef,
} from '@/core/widgets';
import { WIDGET_UI } from './copy';

export interface WidgetForm {
  /** Key of the chosen candidate (`stat:home:total`). */
  key: string | undefined;
  title: string;
  /** The person typed their own name, so choosing something else no longer renames it. */
  titleEdited: boolean;
  rows: number;
  /** Field ids allowed to appear, in the list's own order. */
  fields: string[];
  size: WidgetSize;
  refresh: WidgetRefresh;
  hideWhenLocked: boolean;
  /** Screen a tap opens, or undefined for the app. */
  tapScreen: string | undefined;
}

export const emptyForm = (): WidgetForm => ({
  key: undefined, title: '', titleEdited: false, rows: 3, fields: [], size: 'small', refresh: 'live', hideWhenLocked: true, tapScreen: undefined,
});

export const keyOfSource = (s: WidgetSourceRef): string =>
  s.kind === 'count' ? `count:${s.collection}` : `${s.kind}:${s.screen}:${s.component}`;

/** The form after the person picks one thing to show. Starts from safe defaults and keeps a name they typed. */
export function chooseCandidate(form: WidgetForm, c: WidgetCandidate): WidgetForm {
  const base = newDraft('x', suggestedTitle(c), c.ref);
  return {
    ...form,
    key: c.key,
    title: form.titleEdited ? form.title : base.title,
    rows: c.ref.kind === 'list' ? c.ref.rows : 3,
    fields: c.ref.kind === 'list' ? [...c.ref.fields] : [],
    size: base.size,
  };
}

/** The form that edits a saved widget. A widget whose source is gone starts with nothing chosen. */
export function formFromWidget(w: WidgetDefinition, candidates: readonly WidgetCandidate[]): WidgetForm {
  const key = keyOfSource(w.source);
  const there = candidates.some((c) => c.key === key);
  return {
    key: there ? key : undefined, title: w.title, titleEdited: true,
    rows: w.source.kind === 'list' ? w.source.rows : 3, fields: w.source.kind === 'list' ? [...w.source.fields] : [],
    size: w.size, refresh: w.refresh, hideWhenLocked: w.hideWhenLocked, tapScreen: w.tap.type === 'open_screen' ? w.tap.screen : undefined,
  };
}

/**
 * Adds or removes a field. At most two text fields and one tick: choosing a third text field lets the oldest go, so
 * the person is never stopped with an error.
 */
export function toggleField(form: WidgetForm, candidate: WidgetCandidate, fieldId: string): WidgetForm {
  if (form.fields.includes(fieldId)) return { ...form, fields: form.fields.filter((f) => f !== fieldId) };
  const field = candidate.fields.find((f) => f.id === fieldId);
  if (!field) return form;
  const isCheck = (id: string) => candidate.fields.find((f) => f.id === id)?.isCheck === true;
  let next = [...form.fields, fieldId];
  const same = next.filter((id) => isCheck(id) === field.isCheck);
  const limit = field.isCheck ? 1 : WIDGET_LIMITS.fields - 1;
  if (same.length > limit) next = next.filter((id) => id !== same[0]);
  // The list's own order, so the first field stays the row's text.
  const order = candidate.fields.map((f) => f.id);
  next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  // A tick shows after the text, wherever it sits in the list.
  next = [...next.filter((id) => !isCheck(id)), ...next.filter((id) => isCheck(id))];
  return { ...form, fields: next };
}

export type FormProblem = { field: 'key' | 'title' | 'fields'; message: string };

/** What is still missing, in the order the form asks for it. Empty means the draft can be saved. */
export function formProblems(form: WidgetForm, candidates: readonly WidgetCandidate[]): FormProblem[] {
  const out: FormProblem[] = [];
  const c = candidates.find((x) => x.key === form.key);
  if (!c) out.push({ field: 'key', message: WIDGET_UI.form.showHint });
  if (!form.title.trim()) out.push({ field: 'title', message: WIDGET_UI.form.nameRequired });
  if (c?.kind === 'list' && form.fields.length === 0) out.push({ field: 'fields', message: WIDGET_UI.form.fieldsNone });
  return out;
}

/** The draft the form describes, or undefined while something is missing. */
export function draftFromForm(appId: string, form: WidgetForm, candidates: readonly WidgetCandidate[]): WidgetDraft | undefined {
  if (formProblems(form, candidates).length) return undefined;
  const c = candidates.find((x) => x.key === form.key);
  if (!c) return undefined;
  const source: WidgetSourceRef = c.ref.kind === 'list' ? { ...c.ref, rows: form.rows, fields: form.fields } : c.ref;
  return {
    appId, title: form.title.trim().slice(0, WIDGET_LIMITS.titleLength), source, size: form.size, refresh: form.refresh,
    hideWhenLocked: form.hideWhenLocked, tap: form.tapScreen ? { type: 'open_screen', screen: form.tapScreen } : { type: 'open_app' },
  };
}
