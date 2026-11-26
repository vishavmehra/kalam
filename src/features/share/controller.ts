/**
 * The sharing screens' state, without React: which links the app has, which other apps could be linked,
 * and the actions that change them. A thin hook (`use-share.ts`) puts this on screen. Every rule about
 * what is allowed stays in `src/core/share`; this file only loads, refreshes and passes choices on.
 */
import type { StoredApp } from '@/core/contracts';
import type { CreateResult, LinkView, SendableResult, SendOutcome, ShareService } from '@/core/share';
import type { KalamSpec } from '@/core/spec/schema';
import { SHARE_UI } from './copy';
import { sidesOf, collectionsOf, toCreateInput, type Draft, type OtherApp } from './model';

export type SharePhase = 'loading' | 'ready' | 'failed';

export interface ShareState {
  phase: SharePhase;
  /** Links that involve this app, newest first. */
  views: LinkView[];
  /** Other apps on this device that a link could name. */
  others: OtherApp[];
}

export interface ShareControllerDeps {
  service: ShareService;
  appId: string;
  /** Every app on this device. */
  listApps: () => Promise<StoredApp[]>;
  /** Called whenever links change anywhere (the store's subscribe). Returns unsubscribe. */
  onLinksChanged: (listener: () => void) => () => void;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export interface ShareController {
  getState(): ShareState;
  subscribe(listener: () => void): () => void;
  /** Starts listening for link changes and reads everything once. Safe to call again after `stop`. */
  start(): void;
  /** Stops listening. State stays as it was. */
  stop(): void;
  /** Reads links and apps again. Never throws; a failure shows as `phase: 'failed'`. */
  refresh(): Promise<void>;
  create(draft: Draft, thisSpec: KalamSpec): Promise<CreateResult>;
  revoke(linkId: string): Promise<ActionResult>;
  forget(linkId: string): Promise<ActionResult>;
  sendable(linkId: string): Promise<SendableResult>;
  send(linkId: string, recordIds: readonly string[], updateExisting: boolean): Promise<SendOutcome>;
}

const NOT_READY = SHARE_UI.actionFailed;

export function createShareController(deps: ShareControllerDeps): ShareController {
  let state: ShareState = { phase: 'loading', views: [], others: [] };
  const listeners = new Set<() => void>();
  let disposed = false;
  let off: (() => void) | undefined;
  let latest = 0;
  const set = (next: ShareState) => {
    state = next;
    for (const l of [...listeners]) l();
  };

  async function refresh(): Promise<void> {
    const mine = ++latest;
    try {
      const [views, apps] = await Promise.all([deps.service.list(deps.appId), deps.listApps()]);
      if (disposed || mine !== latest) return;
      set({
        phase: 'ready',
        views,
        others: apps.filter((a) => a.id !== deps.appId).map((a) => ({ id: a.id, spec: a.spec })),
      });
    } catch {
      if (disposed || mine !== latest) return;
      set({ ...state, phase: 'failed' });
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    start() {
      disposed = false;
      off?.();
      off = deps.onLinksChanged(() => void refresh());
      void refresh();
    },
    stop() {
      disposed = true;
      off?.();
      off = undefined;
    },
    refresh,

    async create(draft, thisSpec) {
      const other = state.others.find((o) => o.id === draft.otherAppId);
      const sides = sidesOf(draft, thisSpec, other?.spec);
      const input = toCreateInput(draft, deps.appId, sides, collectionsOf(draft, sides).from);
      if (!input) return { ok: false, reason: 'app_missing', message: SHARE_UI.form.blockers.pickApp };
      const result = await deps.service.create(input).catch((): CreateResult => ({ ok: false, reason: 'not_stored', message: NOT_READY }));
      void refresh();
      return result;
    },

    async revoke(linkId) {
      const r = await deps.service.revoke(linkId).catch(() => ({ ok: false, message: NOT_READY }));
      void refresh();
      return r;
    },

    async forget(linkId) {
      const ok = await deps.service.forget(linkId).catch(() => false);
      void refresh();
      return { ok, message: ok ? SHARE_UI.removed : NOT_READY };
    },

    sendable: (linkId) =>
      deps.service.sendable(linkId).catch((): SendableResult => ({ ok: false, reason: 'no_link', message: SHARE_UI.send.failed })),

    async send(linkId, recordIds, updateExisting) {
      // The person confirmed in the review step before this is called. Nothing else in the app sets `confirmed`.
      const out = await deps.service.send(linkId, { recordIds, confirmed: true, updateExisting }).catch(
        (): SendOutcome => ({ ok: false, reason: 'broken', created: 0, updated: 0, skipped: [], failed: [], recorded: true, message: NOT_READY }),
      );
      void refresh();
      return out;
    },
  };
}
