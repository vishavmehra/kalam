/**
 * Home-screen widgets (docs/14 §18). Pure TypeScript, no React, no native code.
 *
 *   model      definitions, limits, links, settings           (model.ts)
 *   sources    what an app offers, and whether a widget still points at it   (sources.ts)
 *   snapshot   what one widget shows, now and at each midnight ahead (snapshot.ts)
 *   payload    the one message handed to the home screen       (payload.ts)
 *   service    make, change, remove, sync                      (service.ts)
 *   shortcuts  install-menu shortcuts for the web app          (shortcuts.ts)
 */
export {
  DEFAULT_WIDGET_PREFS, newDraft, parsePrefs, parseWidget, parseWidgetLink, SHORTCUT_NAME_MAX, startStack, WIDGET_ID, WIDGET_LIMITS,
  WIDGET_LINK_PREFIX, WIDGET_REFRESH, WIDGET_SCHEMA_VERSION, WIDGET_SIZES, widgetDefinitionSchema, widgetLink, widgetPrefsSchema,
  widgetSourceSchema, widgetTapSchema,
  type ParsedWidget, type ParsedWidgetLink, type WidgetDefinition, type WidgetDraft, type WidgetPrefs, type WidgetRefresh, type WidgetSize,
  type WidgetSourceRef, type WidgetTap,
} from './model';
export {
  checkWidget, readsScreenInput, resolveSource, suggestedTitle, widgetSources,
  type CandidateField, type ResolvedSource, type WidgetCandidate, type WidgetHealth, type WidgetProblemCode,
} from './sources';
export { joinList, WIDGET_BROKEN_NOTE, WIDGET_COPY, WIDGET_HOME_LABELS, type WidgetHomeLabels } from './copy';
export { describeWidget } from './describe';
export {
  buildBody, buildTimeline, HEADLINE_MAX, midnightAfter, ROW_DETAIL_MAX, ROW_TEXT_MAX,
  type BodyResult, type TimelineResult, type WidgetData, type WidgetEngine, type WidgetEntry, type WidgetEntryBody, type WidgetRow,
} from './snapshot';
export {
  buildPayload, encodePayload, MAX_PAYLOAD_BYTES, PAYLOAD_VERSION, WIDGET_LINK, widgetLabelsSchema, widgetPayloadSchema,
  type PayloadInput, type PayloadResult, type WidgetPayload, type WidgetRender,
} from './payload';
export { pinnedShortcuts, SHORTCUT_NAME, SHORTCUT_URL, type WebShortcut } from './shortcuts';
export {
  createBlobWidgetStore, createMemoryWidgetStore, oldestFirst, readStoreData, STORE_VERSION, WidgetStoreError,
  type WidgetStore, type WidgetStoreData,
} from './store';
export {
  createWidgetService,
  type MakeRefusal, type MakeResult, type PinOutcome, type PreviewResult, type SyncReason, type SyncResult, type WidgetAvailability,
  type WidgetDeps, type WidgetPlatform, type WidgetPlatformName, type WidgetService, type WidgetView,
} from './service';
