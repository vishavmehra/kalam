/**
 * Home-screen widgets: the definition model (docs/14 §18, data concept `widgets` in §24).
 *
 * A widget is plain data the person chose, never code. It names one app, one thing in it to show (a stat, a
 * list or an entry count), which fields of a list may appear, how it refreshes, whether its numbers hide on a
 * locked device, and what a tap does. The numbers themselves are worked out on this device from the app's own
 * entries and handed to the home screen as ready-made text (see `payload.ts`). Nothing here leaves the device.
 *
 * Definitions are validated here before they are stored and again every time they are read back.
 */
import { z } from 'zod';
import { appIdSchema, idSchema, LIMITS, RESERVED_IDS } from '../spec/schema';

export const WIDGET_LIMITS = {
  /** Widgets one device keeps, across all apps. */
  perDevice: 12,
  perApp: 4,
  titleLength: 40,
  /** Rows a list widget shows. */
  rows: 5,
  /** Fields a list widget may show: two as text, plus the tick of a checklist. */
  fields: 3,
  /** Days ahead the home screen can follow on its own (midnight changes, such as "due today"). */
  timelineDays: 7,
  /** Pinned apps offered as install shortcuts on the web. Browsers show about four. */
  shortcuts: 4,
} as const;

export const WIDGET_SCHEMA_VERSION = 1;
export const WIDGET_SIZES = ['small', 'medium'] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];
/** `live`: the widget follows the app's entries and the calendar. `on_open`: it changes only when Kalam is opened. */
export const WIDGET_REFRESH = ['live', 'on_open'] as const;
export type WidgetRefresh = (typeof WIDGET_REFRESH)[number];

const RESERVED = new Set<string>(RESERVED_IDS);
const timestamp = z.number().int().nonnegative();
const safeId = idSchema.refine((v) => !RESERVED.has(v), 'This name is reserved');

export const widgetSourceSchema = z.discriminatedUnion('kind', [
  /** A stat component of the app: same formula, same format, same words as on its screen. */
  z.object({ kind: z.literal('stat'), screen: idSchema, component: idSchema }).strict(),
  /** A list component of the app: its filter, order and limit, cut down to a few rows. */
  z
    .object({
      kind: z.literal('list'),
      screen: idSchema,
      component: idSchema,
      rows: z.number().int().min(1).max(WIDGET_LIMITS.rows),
      /** The only fields that may appear. The first is the row's text, the second its detail. */
      fields: z.array(safeId).min(1).max(WIDGET_LIMITS.fields).refine((f) => new Set(f).size === f.length, 'Each field once'),
    })
    .strict(),
  /** How many entries a list in the app holds. Every app has one. */
  z.object({ kind: z.literal('count'), collection: idSchema }).strict(),
]);
export type WidgetSourceRef = z.infer<typeof widgetSourceSchema>;

/** What a tap does. A closed set of typed actions, never a link the person or a model typed. */
export const widgetTapSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open_app') }).strict(),
  z.object({ type: z.literal('open_screen'), screen: idSchema }).strict(),
]);
export type WidgetTap = z.infer<typeof widgetTapSchema>;

export const WIDGET_ID = /^wgt_[a-z0-9]{8,32}$/;

export const widgetDefinitionSchema = z
  .object({
    id: z.string().regex(WIDGET_ID),
    v: z.literal(WIDGET_SCHEMA_VERSION),
    appId: appIdSchema,
    /** Shown on the widget. The person's own words, so keep names and amounts out of the default. */
    title: z.string().trim().min(1).max(WIDGET_LIMITS.titleLength),
    source: widgetSourceSchema,
    size: z.enum(WIDGET_SIZES),
    refresh: z.enum(WIDGET_REFRESH),
    /** Numbers and names show only after the device is unlocked. On by default. */
    hideWhenLocked: z.boolean(),
    tap: widgetTapSchema,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();
export type WidgetDefinition = z.infer<typeof widgetDefinitionSchema>;

/** What the person fills in. The rest (id, times, version) is added when it is saved. */
export type WidgetDraft = Pick<WidgetDefinition, 'appId' | 'title' | 'source' | 'size' | 'refresh' | 'hideWhenLocked' | 'tap'>;

/** Settings for all widgets on this device. */
export const widgetPrefsSchema = z
  .object({
    /** Show pinned apps in the install menu of the web app (a long press or right click on its icon). Off until chosen. */
    webShortcuts: z.boolean(),
  })
  .strict();
export type WidgetPrefs = z.infer<typeof widgetPrefsSchema>;
export const DEFAULT_WIDGET_PREFS: WidgetPrefs = { webShortcuts: false };

export type ParsedWidget = { ok: true; widget: WidgetDefinition } | { ok: false };

/** Reads one stored definition. Anything that does not pass is dropped, never repaired. */
export function parseWidget(input: unknown): ParsedWidget {
  const r = widgetDefinitionSchema.safeParse(input);
  return r.success ? { ok: true, widget: r.data } : { ok: false };
}

/** Reads stored settings; anything that does not pass becomes the defaults. */
export function parsePrefs(input: unknown): WidgetPrefs {
  const r = widgetPrefsSchema.safeParse(input);
  return r.success ? r.data : { ...DEFAULT_WIDGET_PREFS };
}

/** Safe defaults for a new widget: numbers hidden on a locked device, follows the app, a tap opens the app. */
export function newDraft(appId: string, title: string, source: WidgetSourceRef): WidgetDraft {
  return {
    appId,
    title: title.trim().slice(0, WIDGET_LIMITS.titleLength) || 'Widget',
    source,
    size: source.kind === 'list' ? 'medium' : 'small',
    refresh: 'live',
    hideWhenLocked: true,
    tap: { type: 'open_app' },
  };
}

// ─── Links: what a tap opens ──────────────────────────────────────────────────
export const WIDGET_LINK_PREFIX = 'kalam://app/';

/** The link the home screen opens. Built from validated parts only, so there is nothing to inject. */
export function widgetLink(appId: string, tap: WidgetTap): string {
  const base = `${WIDGET_LINK_PREFIX}${appId}`;
  return tap.type === 'open_screen' ? `${base}?screen=${tap.screen}` : base;
}

export interface ParsedWidgetLink {
  appId: string;
  screen?: string;
}

/** Reads a link the home screen opened (kalam://app/<id>[?screen=<id>], or the same as a /app path). Anything else is refused. */
export function parseWidgetLink(url: string): ParsedWidgetLink | undefined {
  const m = /^(?:kalam:\/\/|\/)?app\/([a-z][a-z0-9_-]{2,63})(?:\?screen=([a-z][a-z0-9_]{0,47}))?$/.exec(url.trim());
  if (!m) return undefined;
  return m[2] ? { appId: m[1], screen: m[2] } : { appId: m[1] };
}

/**
 * The screens the runtime starts on after a widget tap: the app's first screen, then the requested one, so Back
 * goes to the first screen. An unknown screen is ignored. Needs `spec.screens` and `spec.initialScreen` only.
 */
export function startStack(spec: { screens: ReadonlyArray<{ id: string }>; initialScreen: string }, screen?: string): string[] {
  const first = spec.screens.some((s) => s.id === spec.initialScreen) ? spec.initialScreen : spec.screens[0]?.id;
  if (!first) return [];
  if (!screen || screen === first || !spec.screens.some((s) => s.id === screen)) return [first];
  return [first, screen];
}

/** Longest label that fits an install shortcut. */
export const SHORTCUT_NAME_MAX = LIMITS.nameLength;
