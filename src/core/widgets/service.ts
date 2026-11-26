/**
 * The widget service: makes, changes and removes widgets, and keeps the home screen in step with the apps.
 *
 * Everything stays on the device. The only thing that ever reaches the platform is the payload from
 * `payload.ts`: finished text for the widgets the person made. It never logs: nothing here should leave a
 * trace of what a widget shows.
 */
import type { KeyValueRepository, RecordRepository, StoredApp } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { WIDGET_COPY, type WidgetHomeLabels } from './copy';
import { describeWidget } from './describe';
import {
  WIDGET_ID, WIDGET_LIMITS, WIDGET_SCHEMA_VERSION, parseWidget, widgetDefinitionSchema,
  type WidgetDefinition, type WidgetDraft, type WidgetPrefs,
} from './model';
import { buildPayload, encodePayload, widgetLabelsSchema, type PayloadInput } from './payload';
import { buildBody, type WidgetData, type WidgetEngine, type WidgetEntryBody } from './snapshot';
import { checkWidget, widgetSources, type WidgetCandidate, type WidgetHealth, type WidgetProblemCode } from './sources';
import { pinnedShortcuts, type WebShortcut } from './shortcuts';
import { WidgetStoreError, type WidgetStore } from './store';

export type WidgetPlatformName = 'android' | 'ios' | 'web' | 'none';

export type WidgetAvailability =
  | { supported: false; platform: WidgetPlatformName; reason: string }
  | {
      supported: true;
      platform: Extract<WidgetPlatformName, 'android' | 'ios'>;
      /** The app can ask the system to add a widget to the home screen. iOS gives apps no way to. */
      canPin: boolean;
      /** The platform can say how many of each widget are on the home screen. */
      canCount: boolean;
    };

/** `not_published`: the widget is saved, but the home screen did not take its text, so the system was not asked. */
export type PinOutcome =
  | { ok: true; requested: true }
  | { ok: false; reason: 'unsupported' | 'unknown_widget' | 'failed' | 'not_published'; message: string };

/** The part of the system this device offers. Native on Android and iOS, a no-op or the install menu on the web. */
export interface WidgetPlatform {
  availability(): Promise<WidgetAvailability>;
  /** Replaces what the home screen holds with this payload (already validated JSON text). */
  publish(payloadJson: string): Promise<void>;
  /** Empties what the home screen holds. Placed widgets stay on the home screen and say they have nothing to show. */
  clear(): Promise<void>;
  /** Asks the system to add this widget to the home screen. The person answers in a system dialog. */
  requestPin(widgetId: string): Promise<PinOutcome>;
  /** Widget id to the number on the home screen. Empty where the platform cannot tell. */
  placed(): Promise<Record<string, number>>;
  /** Web only: the install-menu shortcuts for pinned apps. Empty list removes them. */
  setShortcuts(shortcuts: readonly WebShortcut[]): Promise<void>;
}

export interface WidgetDeps {
  store: WidgetStore;
  apps: { list(): Promise<StoredApp[]> };
  records: Pick<RecordRepository, 'listAll'>;
  state: Pick<KeyValueRepository, 'all'>;
  platform: WidgetPlatform;
  engine: WidgetEngine;
  /** 8 to 32 random lowercase hex characters. Must come from a secure random source. */
  newId: () => string;
  now?: () => number;
  /** The words the home screen prints itself, in the person's language. Leave out for the English defaults. */
  labels?: () => WidgetHomeLabels | Promise<WidgetHomeLabels>;
}

export type MakeRefusal =
  | { ok: false; reason: 'invalid' | 'no_fields' | 'store'; message: string }
  | { ok: false; reason: 'too_many'; message: string }
  | { ok: false; reason: WidgetProblemCode | 'not_found'; message: string };
/** `sync` says whether the home screen took the new text (`platform: 'failed'`: the widget is saved but not shown yet). */
export type MakeResult = { ok: true; widget: WidgetDefinition; sync: SyncResult } | MakeRefusal;

export interface WidgetView {
  widget: WidgetDefinition;
  appName: string;
  health: WidgetHealth;
  /** What it shows and does, one fact per line. */
  lines: string[];
  /** How many are on the home screen. Undefined where the platform cannot tell. */
  placed?: number;
}

export type PreviewResult = { ok: true; body: WidgetEntryBody; appName: string } | { ok: false; message: string };

export type SyncReason = 'open' | 'change';
export interface SyncResult {
  /** Widgets handed to the platform. */
  published: number;
  /** Widgets removed because their app is gone. */
  removed: number;
  /** Widgets that point at something that is gone. They show a note on the home screen. */
  broken: number;
  /** `unsupported`: this device has no widgets. `failed`: the platform refused or threw. */
  platform: 'ok' | 'unsupported' | 'failed';
}

export interface WidgetService {
  /** What a new widget could show from this app. Empty when the app is not on this device. */
  candidates(appId: string): Promise<WidgetCandidate[]>;
  list(): Promise<WidgetView[]>;
  /** What the widget would show right now, without saving anything. */
  preview(draft: WidgetDraft): Promise<PreviewResult>;
  create(draft: WidgetDraft): Promise<MakeResult>;
  update(id: string, change: Partial<Omit<WidgetDraft, 'appId'>>): Promise<MakeResult>;
  remove(id: string): Promise<void>;
  addToHomeScreen(id: string): Promise<PinOutcome>;
  prefs(): Promise<WidgetPrefs>;
  setPrefs(change: Partial<WidgetPrefs>): Promise<WidgetPrefs>;
  availability(): Promise<WidgetAvailability>;
  /** Brings the home screen and the install shortcuts in step with the apps. Never throws. */
  sync(reason?: SyncReason): Promise<SyncResult>;
  /** Removes every widget, its settings and everything the home screen holds. For "Delete everything". */
  clearAll(): Promise<void>;
}

const refuse = (reason: MakeRefusal['reason'], message: string): MakeRefusal => ({ ok: false, reason, message } as MakeRefusal);

export function createWidgetService(deps: WidgetDeps): WidgetService {
  const { store, platform, engine } = deps;
  const now = deps.now ?? (() => Date.now());
  /** The last body worked out per widget, so a change in one app does not redo widgets that only follow Kalam opening. */
  const lastRender = new Map<string, PayloadInput>();
  // Syncs run one after another, so an older snapshot can never overwrite a newer one on the home screen. A sync that has
  // not started yet is shared by everyone who asks meanwhile (it reads the newest data when it runs).
  let tail: Promise<unknown> = Promise.resolve();
  let waiting: { reason: SyncReason; run: Promise<SyncResult> } | undefined;

  const specOf = (apps: readonly StoredApp[], appId: string): KalamSpec | undefined => apps.find((a) => a.id === appId)?.spec;

  async function dataFor(appId: string): Promise<WidgetData> {
    const [records, state] = await Promise.all([deps.records.listAll(appId), deps.state.all(appId)]);
    return { records, state };
  }

  function validate(draft: WidgetDraft, spec: KalamSpec | undefined, others: readonly WidgetDefinition[], selfId?: string): MakeRefusal | undefined {
    if (draft.source.kind === 'list' && draft.source.fields.length === 0) return refuse('no_fields', WIDGET_COPY.refuse.no_fields);
    const health = checkWidget(spec, draft);
    if (!health.ok) return refuse(health.problem, WIDGET_COPY.refuse[health.problem]);
    const rest = others.filter((w) => w.id !== selfId);
    if (rest.length >= WIDGET_LIMITS.perDevice) return refuse('too_many', WIDGET_COPY.refuse.too_many_device(WIDGET_LIMITS.perDevice));
    if (rest.filter((w) => w.appId === draft.appId).length >= WIDGET_LIMITS.perApp) {
      return refuse('too_many', WIDGET_COPY.refuse.too_many_app(WIDGET_LIMITS.perApp));
    }
    return undefined;
  }

  async function save(def: WidgetDefinition): Promise<MakeResult> {
    const checked = widgetDefinitionSchema.safeParse(def);
    if (!checked.success) return refuse('invalid', WIDGET_COPY.refuse.invalid);
    try {
      await store.put(checked.data);
    } catch (e) {
      return refuse('store', e instanceof WidgetStoreError && e.kind === 'newer' ? WIDGET_COPY.refuse.store_newer : WIDGET_COPY.refuse.store);
    }
    // The home screen follows straight away. A platform that cannot is not an error here: the widget is saved, and the
    // result says whether the home screen took it so the screen can tell the person.
    return { ok: true, widget: checked.data, sync: await service.sync('change') };
  }

  function sync(reason: SyncReason = 'open'): Promise<SyncResult> {
    if (waiting) {
      if (reason === 'open') waiting.reason = 'open';
      return waiting.run;
    }
    const slot = { reason, run: undefined as unknown as Promise<SyncResult> };
    slot.run = tail.then(() => {
      waiting = undefined;
      return runSync(slot.reason);
    });
    waiting = slot;
    tail = slot.run;
    return slot.run;
  }

  /** The words the home screen prints. A translation that does not fit the message falls back to the English defaults. */
  async function homeLabels(): Promise<WidgetHomeLabels | undefined> {
    try {
      const given = await deps.labels?.();
      const checked = given ? widgetLabelsSchema.safeParse(given) : undefined;
      return checked?.success ? checked.data : undefined;
    } catch {
      return undefined;
    }
  }

  async function runSync(reason: SyncReason): Promise<SyncResult> {
    const out: SyncResult = { published: 0, removed: 0, broken: 0, platform: 'ok' };
    try {
      const [apps, prefs] = await Promise.all([deps.apps.list(), store.prefs()]);
      const known = new Set(apps.map((a) => a.id));
      let widgets = await store.list();
      for (const w of widgets.filter((x) => !known.has(x.appId))) await store.remove(w.id);
      out.removed = widgets.length - widgets.filter((w) => known.has(w.appId)).length;
      widgets = widgets.filter((w) => known.has(w.appId));
      for (const id of [...lastRender.keys()]) if (!widgets.some((w) => w.id === id)) lastRender.delete(id);

      const avail = await platform.availability();
      // Install shortcuts on the web follow the person's switch and the shelf's pins.
      await platform.setShortcuts(prefs.webShortcuts ? pinnedShortcuts(apps) : []).catch(() => undefined);
      if (!avail.supported) return { ...out, platform: 'unsupported' };
      if (!widgets.length) {
        await platform.clear();
        return out;
      }

      const dataCache = new Map<string, WidgetData>();
      const inputs: PayloadInput[] = [];
      for (const def of widgets) {
        const kept = lastRender.get(def.id);
        // A change in an app does not move a widget that follows Kalam opening: keep what it showed.
        if (reason === 'change' && def.refresh === 'on_open' && kept && JSON.stringify(kept.def) === JSON.stringify(def)) {
          inputs.push(kept);
          continue;
        }
        const spec = specOf(apps, def.appId);
        let data = dataCache.get(def.appId);
        if (!data && spec) {
          data = await dataFor(def.appId);
          dataCache.set(def.appId, data);
        }
        inputs.push({ def, spec, data });
      }
      const built = buildPayload(inputs, engine, new Date(now()), await homeLabels());
      out.broken = built.broken.length;
      // The next 'change' reuses these inputs for widgets that only follow Kalam opening.
      for (const i of inputs) lastRender.set(i.def.id, i);
      await platform.publish(encodePayload(built.payload));
      out.published = built.payload.widgets.length;
    } catch {
      out.platform = 'failed';
    }
    return out;
  }

  const service: WidgetService = {
    async candidates(appId) {
      const spec = specOf(await deps.apps.list(), appId);
      return spec ? widgetSources(spec) : [];
    },

    async list() {
      const [apps, widgets, avail] = await Promise.all([deps.apps.list(), store.list(), platform.availability()]);
      const placed = avail.supported && avail.canCount ? await platform.placed().catch(() => undefined) : undefined;
      return widgets.map((widget) => {
        const spec = specOf(apps, widget.appId);
        const view: WidgetView = { widget, appName: spec?.name ?? '', health: checkWidget(spec, widget), lines: describeWidget(spec, widget) };
        if (placed) view.placed = placed[widget.id] ?? 0;
        return view;
      });
    },

    async preview(draft) {
      const spec = specOf(await deps.apps.list(), draft.appId);
      if (!spec) return { ok: false, message: WIDGET_COPY.refuse.app_missing };
      const t = now();
      const def: WidgetDefinition = { ...draft, id: 'wgt_preview00', v: WIDGET_SCHEMA_VERSION, createdAt: t, updatedAt: t };
      if (!parseWidget(def).ok) return { ok: false, message: WIDGET_COPY.refuse.invalid };
      const built = buildBody(spec, def, await dataFor(draft.appId), engine, new Date(t));
      if (!built.ok) return { ok: false, message: WIDGET_COPY.refuse[built.problem] };
      return { ok: true, body: built.body, appName: spec.name };
    },

    async create(draft) {
      const [apps, existing] = await Promise.all([deps.apps.list(), store.list()]);
      const refusal = validate(draft, specOf(apps, draft.appId), existing);
      if (refusal) return refusal;
      const id = `wgt_${deps.newId()}`;
      if (!WIDGET_ID.test(id)) return refuse('invalid', WIDGET_COPY.refuse.invalid);
      const t = now();
      return save({ ...draft, id, v: WIDGET_SCHEMA_VERSION, createdAt: t, updatedAt: t });
    },

    async update(id, change) {
      const [apps, existing] = await Promise.all([deps.apps.list(), store.list()]);
      const current = existing.find((w) => w.id === id);
      if (!current) return refuse('not_found', WIDGET_COPY.refuse.not_found);
      const next: WidgetDefinition = { ...current, ...change, updatedAt: now() };
      const refusal = validate(next, specOf(apps, current.appId), existing, id);
      if (refusal) return refusal;
      return save(next);
    },

    async remove(id) {
      await store.remove(id);
      await service.sync('change');
    },

    async addToHomeScreen(id) {
      const found = (await store.list()).find((w) => w.id === id);
      if (!found) return { ok: false, reason: 'unknown_widget', message: WIDGET_COPY.refuse.not_found };
      // The home screen must already hold this widget's text when the system asks, or it would add an empty one.
      if ((await service.sync('change')).platform === 'failed') {
        return { ok: false, reason: 'not_published', message: WIDGET_COPY.status.home_not_updated };
      }
      try {
        return await platform.requestPin(id);
      } catch {
        return { ok: false, reason: 'failed', message: 'The system could not be asked to add the widget.' };
      }
    },

    prefs: () => store.prefs(),

    async setPrefs(change) {
      const next: WidgetPrefs = { ...(await store.prefs()), ...change };
      await store.setPrefs(next);
      await service.sync('change');
      return next;
    },

    availability: () => platform.availability(),
    sync,

    async clearAll() {
      lastRender.clear();
      await store.clear();
      await platform.clear().catch(() => undefined);
      await platform.setShortcuts([]).catch(() => undefined);
    },
  };
  return service;
}

