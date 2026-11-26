/**
 * The runtime context (docs/09 §6): one typed object made once per running app instance that carries what every
 * part of the runtime needs, so no component builds its own services, caches or snapshots.
 *
 *   appId, spec (swappable on a live edit), services, accessibility modes, the resolved theme,
 *   the data snapshot (records and counters), the formula cache for this app and spec version,
 *   `env()` for engine calls, `dispatch()` for actions, `evaluate()` for formulas, `idle()` to wait for work.
 *
 * Navigation and form state stay in RuntimeState (they change on every tap); the context holds what does not.
 * Pure TypeScript, no React: KalamRuntime holds it in a ref or a useMemo (see RuntimeContext.tsx).
 */
import type { AccessModes, FormulaResult, KalamRecord, RecordValue, RuntimeServices } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { collectionValues, formulaContext, type CollectionValues } from './data';
import { dispatchAction } from './dispatch';
import { lenientForm, screenFieldDefs } from './fields';
import { formulaCacheFor, type FormulaCache } from './formula-cache';
import { currentScreen, getForm, selectedId } from './state';
import { resolveAppTheme, type RuntimeTheme } from './theme';
import type { ActionResult, DataSnapshot, EngineEnv, RuntimeState } from './types';

export interface RuntimeContextValue {
  readonly appId: string;
  readonly services: RuntimeServices;
  readonly accessibility: AccessModes;
  spec(): KalamSpec;
  /** The design changed (a live edit, a restore). Swaps the spec, the theme and the formula cache together. */
  setSpec(next: KalamSpec): void;
  theme(): RuntimeTheme;
  formulas(): FormulaCache;
  data(): DataSnapshot;
  /** Merges a fresh load of records and/or counters. Returns the new snapshot. */
  patchData(patch: Partial<DataSnapshot>): DataSnapshot;
  /** Records as formulas see them, rebuilt only when the records change. */
  collections(): CollectionValues;
  /** What the engine functions take. `overrides` replaces some services for one call (a themed confirm dialog). */
  env(overrides?: Partial<RuntimeServices>): EngineEnv;
  /**
   * Runs any engine operation (an action, a save, a delete) with this context's env. It is in flight until it
   * settles, so `idle()` waits for it, and the counter writes it made are merged into the data snapshot, so
   * `evaluate()` sees them. KalamRuntime runs every operation through here.
   */
  run<R extends { kvWrites?: Record<string, RecordValue> }>(op: (env: EngineEnv) => R | Promise<R>, overrides?: Partial<RuntimeServices>): Promise<R>;
  /** Runs an action through `run`. */
  dispatch(state: RuntimeState, actionId: string, overrides?: Partial<RuntimeServices>): Promise<ActionResult>;
  /** A formula over this app's data and the screen's typed values, through the cache. */
  evaluate(expr: string, state: RuntimeState): FormulaResult;
  /** Resolves when every dispatch started so far has finished. What a lifecycle flush waits for. */
  idle(): Promise<void>;
}

export interface RuntimeContextInit {
  spec: KalamSpec;
  appId: string;
  services: RuntimeServices;
  accessibility: AccessModes;
  /** Seed data, for a preview that starts with records. */
  data?: DataSnapshot;
  now?: () => Date;
}

export function createRuntimeContext(init: RuntimeContextInit): RuntimeContextValue {
  const { appId, services, accessibility } = init;
  const now = init.now ?? (() => new Date());
  let spec = init.spec;
  let theme = resolveAppTheme(spec.theme, accessibility);
  let cache = formulaCacheFor(appId, spec.version);
  let data: DataSnapshot = init.data ?? { records: {}, state: {} };
  let built: { spec: KalamSpec; records: Record<string, KalamRecord[]>; values: CollectionValues } | undefined;
  const inFlight = new Set<Promise<unknown>>();

  const collections = (): CollectionValues => {
    if (!built || built.spec !== spec || built.records !== data.records) {
      built = { spec, records: data.records, values: collectionValues(spec, data.records) };
    }
    return built.values;
  };
  const env = (overrides?: Partial<RuntimeServices>): EngineEnv => ({
    spec, appId, services: overrides ? { ...services, ...overrides } : services, data, now: now(),
  });

  const run: RuntimeContextValue['run'] = (op, overrides) => {
    // Starts now (env is taken at the call); a synchronous throw from `op` becomes a rejection like an async one.
    const work = (async () => {
      const res = await op(env(overrides));
      if (res.kvWrites) data = { ...data, state: { ...data.state, ...res.kvWrites } };
      return res;
    })();
    inFlight.add(work);
    const forget = () => void inFlight.delete(work);
    work.then(forget, forget);
    return work;
  };

  return {
    appId,
    services,
    accessibility,
    spec: () => spec,
    setSpec(next) {
      spec = next;
      theme = resolveAppTheme(next.theme, accessibility);
      cache = formulaCacheFor(appId, next.version);
    },
    theme: () => theme,
    formulas: () => cache,
    data: () => data,
    patchData(patch) {
      data = { ...data, ...patch };
      return data;
    },
    collections,
    env,
    run,
    dispatch: (state, actionId, overrides) => run((e) => dispatchAction(e, state, actionId), overrides),
    evaluate(expr, state) {
      const screen = currentScreen(spec, state);
      const at = now();
      const form = lenientForm(screenFieldDefs(spec, screen), getForm(spec, state, screen, at));
      return cache.evaluate(expr, formulaContext(collections(), form, data.state, at, selectedId(spec, state)), spec.lang);
    },
    async idle() {
      await Promise.allSettled([...inFlight]);
    },
  };
}
