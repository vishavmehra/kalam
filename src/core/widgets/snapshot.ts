/**
 * Works out what one widget shows (docs/14 §18.5: widget data matches the source app).
 *
 * Everything is computed here, on the device, from the app's own entries, and handed to the home screen as
 * finished text. The home screen never reads the app's database and never runs a formula. The same engine the
 * app's screens use does the formatting (`WidgetEngine`), so a widget cannot print a different number.
 *
 * A widget cannot run while Kalam is closed, so a timeline is worked out ahead: one entry now and one for each
 * midnight in the next days. Entries that would print the same are dropped. Only the calendar can change what a
 * widget shows between two visits to Kalam, because only Kalam changes the entries.
 */
import type { FormulaContext, KalamRecord, RecordValue } from '../contracts';
import type { ComponentOf, KalamSpec } from '../spec/schema';
import { WIDGET_HOME_LABELS } from './copy';
import { WIDGET_LIMITS, type WidgetDefinition } from './model';
import { resolveSource, type ResolvedSource, type WidgetProblemCode } from './sources';

/** The app's own formatting and list rules, injected so core stays free of the runtime. `src/features/widgets/engine.ts` supplies the real one. */
export interface WidgetEngine {
  /** The stat as the app prints it: formula, format, currency, prefix and suffix. An error reads as the app's empty mark. */
  statText(spec: KalamSpec, stat: ComponentOf<'stat'>, ctx: FormulaContext): string;
  /** The list's records after its own filter, order and limit. */
  listRows(list: ComponentOf<'list'>, records: readonly KalamRecord[], ctx: FormulaContext, lang: string): KalamRecord[];
  /** One value as the app prints it in a list row. */
  fieldText(spec: KalamSpec, collectionId: string, fieldId: string, value: RecordValue | undefined, lang: string): string;
}

/** The app's entries and state at the moment the widget is worked out. */
export interface WidgetData {
  records: Readonly<Record<string, readonly KalamRecord[]>>;
  state: Readonly<Record<string, RecordValue>>;
}

export interface WidgetRow {
  text: string;
  detail?: string;
  /** Checklist tick. Present only when the person allowed the list's tick field. */
  done?: boolean;
}

export interface WidgetEntryBody {
  headline?: string;
  rows: WidgetRow[];
  /** A sentence under the rows: the list is empty, or the widget is broken. */
  note?: string;
}
export interface WidgetEntry extends WidgetEntryBody {
  /** The widget shows this entry from this time (ms since 1970). The first entry is from 0. */
  from: number;
}

export const ROW_TEXT_MAX = 80;
export const ROW_DETAIL_MAX = 60;
export const HEADLINE_MAX = 24;

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function contextAt(spec: KalamSpec, data: WidgetData, at: Date): FormulaContext {
  const collections: Record<string, ReadonlyArray<Readonly<Record<string, RecordValue>>>> = {};
  for (const id of Object.keys(spec.collections)) collections[id] = (data.records[id] ?? []).map((r) => r.values);
  return { collections, form: {}, state: data.state, now: at, selected: null };
}

export type BodyResult = { ok: true; body: WidgetEntryBody } | { ok: false; problem: WidgetProblemCode };

function bodyOf(spec: KalamSpec, r: Extract<ResolvedSource, { ok: true }>, def: WidgetDefinition, data: WidgetData, engine: WidgetEngine, at: Date): WidgetEntryBody {
  const ctx = contextAt(spec, data, at);
  if (r.kind !== 'list') return { headline: clip(engine.statText(spec, r.stat, ctx), HEADLINE_MAX), rows: [] };
  const limit = def.source.kind === 'list' ? def.source.rows : WIDGET_LIMITS.rows;
  const picked = engine.listRows(r.list, data.records[r.collectionId] ?? [], ctx, spec.lang).slice(0, limit);
  const textFields = r.fields.filter((f) => !f.isCheck);
  const check = r.fields.find((f) => f.isCheck);
  const rows: WidgetRow[] = [];
  for (const rec of picked) {
    const cells = textFields.map((f) => engine.fieldText(spec, r.collectionId, f.id, rec.values[f.id], spec.lang).trim()).filter(Boolean);
    if (!cells.length && !check) continue;
    const row: WidgetRow = { text: clip(cells[0] ?? '', ROW_TEXT_MAX) };
    if (cells[1]) row.detail = clip(cells[1], ROW_DETAIL_MAX);
    if (check) row.done = rec.values[check.id] === true;
    if (!row.text && !row.detail && !check) continue;
    rows.push(row);
  }
  if (rows.length) return { rows };
  return { rows, note: r.list.emptyText?.trim() || WIDGET_HOME_LABELS.empty };
}

/** What the widget shows at time `at`, or why it cannot show anything. */
export function buildBody(spec: KalamSpec, def: WidgetDefinition, data: WidgetData, engine: WidgetEngine, at: Date): BodyResult {
  const resolved = resolveSource(spec, def.source);
  if (!resolved.ok) return { ok: false, problem: resolved.problem };
  try {
    return { ok: true, body: bodyOf(spec, resolved, def, data, engine, at) };
  } catch {
    // The app's own engine should not throw. If it does, this widget says so instead of breaking the others.
    return { ok: false, problem: 'source_missing' };
  }
}

export type TimelineResult = { ok: true; entries: WidgetEntry[] } | { ok: false; problem: WidgetProblemCode };

const sameBody = (a: WidgetEntryBody, b: WidgetEntryBody): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Local midnight `days` days after the day of `now`. */
export function midnightAfter(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 0, 0, 0, 0);
}

/**
 * Entries for now and for each midnight of the next days, so "due today" turns over on its own. A widget that
 * follows the app only when Kalam opens (`on_open`) gets the first entry alone.
 */
export function buildTimeline(spec: KalamSpec, def: WidgetDefinition, data: WidgetData, engine: WidgetEngine, now: Date): TimelineResult {
  const first = buildBody(spec, def, data, engine, now);
  if (!first.ok) return first;
  const entries: WidgetEntry[] = [{ from: 0, ...first.body }];
  if (def.refresh === 'on_open') return { ok: true, entries };
  let last = first.body;
  for (let d = 1; d <= WIDGET_LIMITS.timelineDays; d++) {
    const at = midnightAfter(now, d);
    const next = buildBody(spec, def, data, engine, at);
    if (!next.ok || sameBody(last, next.body)) continue;
    entries.push({ from: at.getTime(), ...next.body });
    last = next.body;
  }
  return { ok: true, entries };
}
