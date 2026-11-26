/**
 * The one message the app hands to the home screen (docs/14 §18.3: a restricted interface to the data layer).
 *
 * It holds finished text only: titles, numbers and rows the person chose, already formatted. No record ids, no
 * field ids, no formulas, no other fields of an entry. The native widget stores it as it is, draws it, and
 * opens the link when tapped. It cannot ask the app for anything else.
 */
import { z } from 'zod';
import { WIDGET_BROKEN_NOTE, WIDGET_HOME_LABELS, type WidgetHomeLabels } from './copy';
import {
  WIDGET_ID, WIDGET_LIMITS, WIDGET_SIZES, widgetLink, type WidgetDefinition,
} from './model';
import type { WidgetProblemCode } from './sources';
import { checkWidget } from './sources';
import { buildTimeline, HEADLINE_MAX, ROW_DETAIL_MAX, ROW_TEXT_MAX, type WidgetData, type WidgetEngine } from './snapshot';
import type { KalamSpec } from '../spec/schema';

export const PAYLOAD_VERSION = 1;
export const MAX_PAYLOAD_BYTES = 256 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

const rowSchema = z
  .object({ text: z.string().max(ROW_TEXT_MAX), detail: z.string().max(ROW_DETAIL_MAX).optional(), done: z.boolean().optional() })
  .strict();
const entrySchema = z
  .object({
    from: z.number().int().nonnegative(),
    headline: z.string().max(HEADLINE_MAX).optional(),
    rows: z.array(rowSchema).max(WIDGET_LIMITS.rows),
    note: z.string().max(160).optional(),
  })
  .strict();

/** `kalam://`, `kalam://app/<id>` or `kalam://app/<id>?screen=<id>`: the only places a widget can open. */
export const WIDGET_LINK = /^kalam:\/\/(app\/[a-z][a-z0-9_-]{2,63}(\?screen=[a-z][a-z0-9_]{0,47})?)?$/;

const renderSchema = z
  .object({
    id: z.string().regex(WIDGET_ID),
    appName: z.string().max(60),
    title: z.string().min(1).max(WIDGET_LIMITS.titleLength),
    kind: z.enum(['stat', 'list', 'count']),
    size: z.enum(WIDGET_SIZES),
    hideWhenLocked: z.boolean(),
    link: z.string().regex(WIDGET_LINK),
    /** After this time the widget says it needs Kalam, instead of showing the last entry as current. */
    validUntil: z.number().int().nonnegative(),
    entries: z.array(entrySchema).min(1).max(WIDGET_LIMITS.timelineDays + 1),
  })
  .strict();
export type WidgetRender = z.infer<typeof renderSchema>;

const label = z.string().min(1).max(80);
/** The words the home screen prints itself. The sender may translate them (`WidgetDeps.labels`). */
export const widgetLabelsSchema = z
  .object({ empty: label, stale: label, locked: label, unboundAndroid: label, unboundIos: label, done: label, notDone: label })
  .strict();

export const widgetPayloadSchema = z
  .object({
    v: z.literal(PAYLOAD_VERSION),
    generatedAt: z.number().int().nonnegative(),
    labels: widgetLabelsSchema,
    widgets: z.array(renderSchema).max(WIDGET_LIMITS.perDevice),
  })
  .strict();
export type WidgetPayload = z.infer<typeof widgetPayloadSchema>;

/** One saved widget with what it needs: the app's design and entries, or nothing when the app is gone. */
export interface PayloadInput {
  def: WidgetDefinition;
  spec?: KalamSpec;
  data?: WidgetData;
}

export interface PayloadResult {
  payload: WidgetPayload;
  /** Widgets that point at something that is gone, by id. They are still in the payload, as a plain note. */
  broken: Array<{ id: string; problem: WidgetProblemCode }>;
}

function brokenRender(def: WidgetDefinition, appName: string, problem: WidgetProblemCode, now: number): WidgetRender {
  return {
    id: def.id, appName, title: def.title, kind: def.source.kind, size: def.size, hideWhenLocked: true,
    link: 'kalam://', validUntil: now + DAY_MS * WIDGET_LIMITS.timelineDays,
    entries: [{ from: 0, rows: [], note: WIDGET_BROKEN_NOTE[problem] }],
  };
}

/**
 * Builds the payload for every widget. A widget whose app or source is gone shows a note, never an old number.
 * The first `WIDGET_LIMITS.perDevice` widgets are used.
 */
export function buildPayload(inputs: readonly PayloadInput[], engine: WidgetEngine, now: Date, labels: WidgetHomeLabels = WIDGET_HOME_LABELS): PayloadResult {
  const broken: PayloadResult['broken'] = [];
  const t = now.getTime();
  const widgets: WidgetRender[] = [];
  for (const { def, spec, data } of inputs.slice(0, WIDGET_LIMITS.perDevice)) {
    const appName = spec?.name ?? '';
    const health = checkWidget(spec, def);
    if (!spec || !data || !health.ok) {
      const problem = health.ok ? 'source_missing' : health.problem;
      broken.push({ id: def.id, problem });
      widgets.push(brokenRender(def, appName, problem, t));
      continue;
    }
    const timeline = buildTimeline(spec, def, data, engine, now);
    if (!timeline.ok) {
      broken.push({ id: def.id, problem: timeline.problem });
      widgets.push(brokenRender(def, appName, timeline.problem, t));
      continue;
    }
    widgets.push({
      id: def.id, appName, title: def.title, kind: def.source.kind, size: def.size, hideWhenLocked: def.hideWhenLocked,
      link: widgetLink(def.appId, def.tap), validUntil: t + DAY_MS * WIDGET_LIMITS.timelineDays, entries: timeline.entries,
    });
  }
  return { payload: { v: PAYLOAD_VERSION, generatedAt: t, labels: { ...labels }, widgets }, broken };
}

/** The text handed to the platform. Validated first, so a bug can never send the home screen something it cannot read. */
export function encodePayload(payload: WidgetPayload): string {
  const text = JSON.stringify(widgetPayloadSchema.parse(payload));
  if (text.length > MAX_PAYLOAD_BYTES) throw new Error('The widget message is too large.');
  return text;
}
