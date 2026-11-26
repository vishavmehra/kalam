/**
 * The widget screens' state, without React: which widgets exist, what the app could show, what this device can do, and the
 * actions that change them. A thin hook (`use-widgets.ts`) puts this on screen. Every rule about what is allowed stays in
 * `src/core/widgets`; this file only loads, refreshes and passes choices on.
 */
import type {
  MakeResult, PinOutcome, PreviewResult, WidgetAvailability, WidgetCandidate, WidgetDraft, WidgetPrefs, WidgetService, WidgetView,
} from '@/core/widgets';
import { WIDGET_UI } from './copy';

export type WidgetsPhase = 'loading' | 'ready' | 'failed';

export interface WidgetsState {
  phase: WidgetsPhase;
  /** The widgets to list: this app's when the controller has an app, otherwise every widget on the device. */
  views: WidgetView[];
  /** What the app could show. Empty without an app. */
  candidates: WidgetCandidate[];
  availability: WidgetAvailability | undefined;
  prefs: WidgetPrefs | undefined;
}

export interface WidgetsControllerDeps {
  service: WidgetService;
  /** Only this app's widgets and candidates. Leave out for the device-wide settings. */
  appId?: string;
  /** Called whenever a widget changes anywhere (the store's subscribe). Returns unsubscribe. */
  onChanged: (listener: () => void) => () => void;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export interface WidgetsController {
  getState(): WidgetsState;
  subscribe(listener: () => void): () => void;
  /** Starts listening for changes and reads everything once. Safe to call again after `stop`. */
  start(): void;
  stop(): void;
  /** Reads everything again. Never throws; a failure shows as `phase: 'failed'`. */
  refresh(): Promise<void>;
  preview(draft: WidgetDraft): Promise<PreviewResult>;
  create(draft: WidgetDraft): Promise<MakeResult>;
  update(id: string, change: Partial<Omit<WidgetDraft, 'appId'>>): Promise<MakeResult>;
  remove(id: string): Promise<ActionResult>;
  /** Asks the system to add the widget, and says in plain words what happened. */
  addToHomeScreen(id: string): Promise<ActionResult & { outcome: PinOutcome }>;
  setPrefs(change: Partial<WidgetPrefs>): Promise<ActionResult>;
  clearAll(): Promise<ActionResult>;
}

export function createWidgetsController(deps: WidgetsControllerDeps): WidgetsController {
  const { service, appId } = deps;
  let state: WidgetsState = { phase: 'loading', views: [], candidates: [], availability: undefined, prefs: undefined };
  const listeners = new Set<() => void>();
  let stopListening: (() => void) | undefined;
  let running = false;
  /** Only the newest refresh may write, so a slow read cannot overwrite a newer one. */
  let latest = 0;

  const set = (next: WidgetsState) => {
    state = next;
    for (const l of [...listeners]) l();
  };

  async function refresh(): Promise<void> {
    const mine = ++latest;
    try {
      const [all, availability, prefs, candidates] = await Promise.all([
        service.list(), service.availability(), service.prefs(), appId ? service.candidates(appId) : Promise.resolve([] as WidgetCandidate[]),
      ]);
      if (mine !== latest || !running) return;
      set({ phase: 'ready', views: appId ? all.filter((v) => v.widget.appId === appId) : all, candidates, availability, prefs });
    } catch {
      if (mine === latest && running) set({ ...state, phase: 'failed' });
    }
  }

  const done = async <T>(job: () => Promise<T>): Promise<T> => {
    const r = await job();
    await refresh();
    return r;
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    start() {
      if (running) return;
      running = true;
      stopListening = deps.onChanged(() => void refresh());
      void refresh();
    },
    stop() {
      running = false;
      stopListening?.();
      stopListening = undefined;
    },
    refresh,
    preview: (draft) => service.preview(draft),
    create: (draft) => done(() => service.create(draft)),
    update: (id, change) => done(() => service.update(id, change)),

    async remove(id) {
      try {
        await done(() => service.remove(id));
        return { ok: true, message: WIDGET_UI.added.removed };
      } catch {
        return { ok: false, message: WIDGET_UI.status.saveFailed };
      }
    },

    async addToHomeScreen(id) {
      const outcome = await service.addToHomeScreen(id);
      await refresh();
      if (outcome.ok) return { ok: true, message: WIDGET_UI.added.asked, outcome };
      return { ok: false, message: outcome.message || WIDGET_UI.added.declined, outcome };
    },

    async setPrefs(change) {
      try {
        await done(() => service.setPrefs(change));
        return { ok: true, message: '' };
      } catch {
        return { ok: false, message: WIDGET_UI.status.saveFailed };
      }
    },

    async clearAll() {
      try {
        await done(() => service.clearAll());
        return { ok: true, message: WIDGET_UI.settings.cleared };
      } catch {
        return { ok: false, message: WIDGET_UI.status.saveFailed };
      }
    },
  };
}
