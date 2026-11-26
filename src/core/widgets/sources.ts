/**
 * What an app offers a widget (docs/14 §18.2), and whether a saved widget still points at something real.
 *
 * A widget never carries its own formula. It points at a stat or list the app already has, so the widget and
 * the app cannot disagree, and a number the app has no screen for cannot appear on a home screen.
 */
import type { ComponentOf, KalamCollection, KalamField, KalamScreen, KalamSpec } from '../spec/schema';
import { WIDGET_BROKEN_NOTE } from './copy';
import { WIDGET_LIMITS, type WidgetDefinition, type WidgetSourceRef } from './model';

export type WidgetProblemCode = 'app_missing' | 'source_missing' | 'field_missing' | 'screen_missing' | 'collection_missing';

export interface CandidateField {
  id: string;
  label: string;
  type: KalamField['type'];
  /** The list's tick box. Shown as a check mark, not as text. */
  isCheck: boolean;
}

export interface WidgetCandidate {
  /** Stable key for lists on screen. */
  key: string;
  kind: WidgetSourceRef['kind'];
  label: string;
  screenId?: string;
  screenTitle?: string;
  collectionId?: string;
  /** For a list: every field that may appear, the list's own first. */
  fields: CandidateField[];
  /** What a new widget of this kind starts with. */
  ref: WidgetSourceRef;
}

/** Field types a home screen can print as text. A photo is a private reference on this device, never shown. */
const SHOWABLE = new Set<KalamField['type']>(['text', 'number', 'date', 'boolean', 'enum']);

const collectionName = (id: string, c: KalamCollection | undefined): string => c?.label?.trim() || id;

/**
 * A formula that reads what is typed on a screen (`form.x`) or the entry that screen is about (`selected`) has no
 * answer on a home screen, where nothing is typed or opened. Such stats and lists are not offered.
 */
export const readsScreenInput = (formula: string | undefined): boolean => !!formula && /\bform\s*\.|\bselected\b/.test(formula);

function listFields(list: ComponentOf<'list'>, collection: KalamCollection): CandidateField[] {
  const first = [list.primary, list.secondary, list.toggleField].filter((f): f is string => !!f);
  const order = [...new Set([...first, ...Object.keys(collection.fields)])];
  return order.flatMap((id) => {
    const def = collection.fields[id];
    if (!def || !SHOWABLE.has(def.type)) return [];
    return [{ id, label: def.label?.trim() || id, type: def.type, isCheck: id === list.toggleField && def.type === 'boolean' }];
  });
}

/**
 * Every stat and list on the app's screens, then one entry count per list of entries. Components the app hides
 * are left out. Capped, so a large app cannot flood the sheet.
 */
export function widgetSources(spec: KalamSpec): WidgetCandidate[] {
  const out: WidgetCandidate[] = [];
  for (const screen of spec.screens) {
    for (const c of screen.children) {
      if (c.visible === false) continue;
      if (c.type === 'stat') {
        if (readsScreenInput(c.expr)) continue;
        out.push({
          key: `stat:${screen.id}:${c.id}`, kind: 'stat', label: c.label, screenId: screen.id, screenTitle: screen.title, fields: [],
          ref: { kind: 'stat', screen: screen.id, component: c.id },
        });
      } else if (c.type === 'list') {
        const collection = spec.collections[c.source];
        if (!collection || readsScreenInput(c.filter)) continue;
        const fields = listFields(c, collection);
        const text = fields.filter((f) => !f.isCheck).slice(0, 2).map((f) => f.id);
        const check = fields.find((f) => f.isCheck)?.id;
        const picked = [...text, ...(check ? [check] : [])];
        if (!picked.length) continue;
        out.push({
          key: `list:${screen.id}:${c.id}`, kind: 'list', label: c.label?.trim() || collectionName(c.source, collection), screenId: screen.id,
          screenTitle: screen.title, collectionId: c.source, fields,
          ref: { kind: 'list', screen: screen.id, component: c.id, rows: 3, fields: picked },
        });
      }
    }
  }
  for (const [id, collection] of Object.entries(spec.collections)) {
    out.push({
      key: `count:${id}`, kind: 'count', label: `Number of entries in ${collectionName(id, collection)}`, collectionId: id, fields: [],
      ref: { kind: 'count', collection: id },
    });
  }
  return out.slice(0, 40);
}

export type ResolvedSource =
  | { ok: true; kind: 'stat'; stat: ComponentOf<'stat'>; screen: KalamScreen }
  | { ok: true; kind: 'count'; stat: ComponentOf<'stat'>; collectionId: string; collection: KalamCollection }
  | { ok: true; kind: 'list'; list: ComponentOf<'list'>; screen: KalamScreen; collectionId: string; collection: KalamCollection; fields: CandidateField[] }
  | { ok: false; problem: WidgetProblemCode };

/** The stat a count widget evaluates: the same `count()` any app formula uses, so the number is the app's own. */
function countStat(collectionId: string, collection: KalamCollection): ComponentOf<'stat'> {
  return { id: 'widget_count', type: 'stat', label: collectionName(collectionId, collection), expr: `count(${collectionId})`, format: 'integer' };
}

/** Finds what `source` points at in the app as it is now. */
export function resolveSource(spec: KalamSpec, source: WidgetSourceRef): ResolvedSource {
  if (source.kind === 'count') {
    const collection = Object.prototype.hasOwnProperty.call(spec.collections, source.collection) ? spec.collections[source.collection] : undefined;
    if (!collection) return { ok: false, problem: 'collection_missing' };
    return { ok: true, kind: 'count', stat: countStat(source.collection, collection), collectionId: source.collection, collection };
  }
  const screen = spec.screens.find((s) => s.id === source.screen);
  const component = screen?.children.find((c) => c.id === source.component);
  if (!screen || !component) return { ok: false, problem: 'source_missing' };
  if (source.kind === 'stat') {
    return component.type === 'stat' && !readsScreenInput(component.expr)
      ? { ok: true, kind: 'stat', stat: component, screen }
      : { ok: false, problem: 'source_missing' };
  }
  if (component.type !== 'list' || readsScreenInput(component.filter)) return { ok: false, problem: 'source_missing' };
  const collection = Object.prototype.hasOwnProperty.call(spec.collections, component.source) ? spec.collections[component.source] : undefined;
  if (!collection) return { ok: false, problem: 'collection_missing' };
  const allowed = new Map(listFields(component, collection).map((f) => [f.id, f]));
  const fields: CandidateField[] = [];
  for (const id of source.fields) {
    const f = allowed.get(id);
    if (!f) return { ok: false, problem: 'field_missing' };
    fields.push(f);
  }
  return { ok: true, kind: 'list', list: component, screen, collectionId: component.source, collection, fields };
}

export type WidgetHealth = { ok: true } | { ok: false; problem: WidgetProblemCode; message: string };

/** Whether a saved widget still points at something that exists. `spec` is undefined when the app is gone. */
export function checkWidget(spec: KalamSpec | undefined, def: Pick<WidgetDefinition, 'source' | 'tap'>): WidgetHealth {
  const fail = (problem: WidgetProblemCode): WidgetHealth => ({ ok: false, problem, message: WIDGET_BROKEN_NOTE[problem] });
  if (!spec) return fail('app_missing');
  const r = resolveSource(spec, def.source);
  if (!r.ok) return fail(r.problem);
  if (def.tap.type === 'open_screen') {
    const screen = def.tap.screen;
    if (!spec.screens.some((s) => s.id === screen)) return fail('screen_missing');
  }
  return { ok: true };
}

/** A short title to start from: the stat's label, the list's name, or what a count counts. The app's name is printed on the widget separately. */
export function suggestedTitle(candidate: WidgetCandidate): string {
  return candidate.label.slice(0, WIDGET_LIMITS.titleLength);
}
