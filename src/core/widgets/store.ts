/**
 * Where widget definitions live. The device implements this (`src/features/widgets/device-store.ts`); the
 * in-memory version below is for tests and previews. Both validate every definition on the way in and out.
 *
 * Widgets belong to this device, not to an app: where a widget sits on a home screen is a fact about one
 * phone, so definitions are not part of an app's backup or of anything published.
 *
 * A row this build cannot read (a newer build wrote it) is left out of the lists but kept in storage and written back
 * as it was, and a value written by a newer build is never overwritten. Going back to an older Kalam must not erase widgets.
 */
import { DEFAULT_WIDGET_PREFS, parsePrefs, parseWidget, type WidgetDefinition, type WidgetPrefs } from './model';

export class WidgetStoreError extends Error {
  readonly code = 'widget_store';
  /** `newer`: the stored widgets were written by a newer Kalam, so this one must not overwrite them. */
  readonly kind: 'invalid' | 'newer';
  constructor(message = 'This widget is not in a form Kalam can keep.', kind: 'invalid' | 'newer' = 'invalid') {
    super(message);
    this.name = 'WidgetStoreError';
    this.kind = kind;
  }
}

/** The version of what a store keeps. A store never writes over a value that has a higher one. */
export const STORE_VERSION = 1;

export interface WidgetStore {
  /** Every valid widget, oldest first. Rows this build cannot read are left out of the list but kept in storage. */
  list(): Promise<WidgetDefinition[]>;
  get(id: string): Promise<WidgetDefinition | undefined>;
  /** Validates, then stores (adds or replaces). Throws a `WidgetStoreError` for a definition that is malformed. */
  put(widget: WidgetDefinition): Promise<void>;
  remove(id: string): Promise<void>;
  /** Deletes every widget of `appId`. Returns how many were removed. */
  removeForApp(appId: string): Promise<number>;
  /** Deletes everything this feature keeps, settings included. */
  clear(): Promise<void>;
  prefs(): Promise<WidgetPrefs>;
  setPrefs(prefs: WidgetPrefs): Promise<void>;
  /** Called after any change. Returns unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export const oldestFirst = (a: WidgetDefinition, b: WidgetDefinition): number => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/** What a store keeps: the definitions and the settings, as plain JSON. */
export interface WidgetStoreData {
  /** Version of this value. Missing means 1 (written before versions were added). */
  v?: number;
  widgets: unknown[];
  prefs: unknown;
}

/**
 * Reads stored data. `widgets` is what validates (each id once). `rest` is every row that does not: a newer build may have
 * written it, so it is kept and written back unchanged instead of being dropped.
 */
export function readStoreData(
  data: Pick<WidgetStoreData, 'widgets' | 'prefs'> | undefined,
): { widgets: WidgetDefinition[]; prefs: WidgetPrefs; rest: unknown[] } {
  const widgets: WidgetDefinition[] = [];
  const rest: unknown[] = [];
  const seen = new Set<string>();
  for (const row of data?.widgets ?? []) {
    const p = parseWidget(row);
    if (!p.ok) rest.push(row);
    else if (!seen.has(p.widget.id)) {
      seen.add(p.widget.id);
      widgets.push(p.widget);
    }
  }
  return { widgets: widgets.sort(oldestFirst), prefs: parsePrefs(data?.prefs), rest };
}

const fieldOf = (row: unknown, key: string): unknown => (row && typeof row === 'object' ? (row as Record<string, unknown>)[key] : undefined);

/**
 * A store over any place that can keep one JSON value (`load` and `save`): the device's key-value storage, or
 * a plain variable in a test. One value means one write, so a widget and the settings never disagree.
 */
export function createBlobWidgetStore(io: { load(): Promise<unknown>; save(data: WidgetStoreData): Promise<void>; erase?(): Promise<void> }): WidgetStore {
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of [...listeners]) l();
  };
  const read = async () => {
    const raw = await io.load();
    const data = raw && typeof raw === 'object' ? (raw as Partial<WidgetStoreData>) : undefined;
    const parsed = readStoreData(data ? { widgets: Array.isArray(data.widgets) ? data.widgets : [], prefs: data.prefs } : undefined);
    return { ...parsed, blobV: Number.isInteger(data?.v) ? (data?.v as number) : STORE_VERSION };
  };
  type Current = Awaited<ReturnType<typeof read>>;
  /** Writes the valid widgets, then the rows this build cannot read as they were. Refuses to touch a newer build's value. */
  const write = async (cur: Current, widgets: WidgetDefinition[], prefs: WidgetPrefs, rest: unknown[] = cur.rest) => {
    if (cur.blobV > STORE_VERSION) throw new WidgetStoreError('These widgets were made by a newer Kalam. Update Kalam to change them.', 'newer');
    await io.save({ v: STORE_VERSION, widgets: [...(JSON.parse(JSON.stringify(widgets)) as unknown[]), ...rest], prefs });
    changed();
  };
  // One write at a time, so two quick changes cannot overwrite each other.
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
  return {
    list: async () => (await read()).widgets,
    get: async (id) => (await read()).widgets.find((w) => w.id === id),
    put: (widget) =>
      serial(async () => {
        const p = parseWidget(widget);
        if (!p.ok) throw new WidgetStoreError();
        const cur = await read();
        const rest = cur.rest.filter((r) => fieldOf(r, 'id') !== p.widget.id);
        await write(cur, [...cur.widgets.filter((w) => w.id !== p.widget.id), p.widget].sort(oldestFirst), cur.prefs, rest);
      }),
    remove: (id) =>
      serial(async () => {
        const cur = await read();
        if (cur.widgets.some((w) => w.id === id) || cur.rest.some((r) => fieldOf(r, 'id') === id)) {
          await write(cur, cur.widgets.filter((w) => w.id !== id), cur.prefs, cur.rest.filter((r) => fieldOf(r, 'id') !== id));
        }
      }),
    removeForApp: (appId) =>
      serial(async () => {
        const cur = await read();
        const keep = cur.widgets.filter((w) => w.appId !== appId);
        const rest = cur.rest.filter((r) => fieldOf(r, 'appId') !== appId);
        if (keep.length !== cur.widgets.length || rest.length !== cur.rest.length) await write(cur, keep, cur.prefs, rest);
        return cur.widgets.length - keep.length;
      }),
    // "Delete everything" always works, whoever wrote the value.
    clear: () =>
      serial(async () => {
        if (io.erase) await io.erase();
        else await io.save({ v: STORE_VERSION, widgets: [], prefs: { ...DEFAULT_WIDGET_PREFS } });
        changed();
      }),
    prefs: async () => (await read()).prefs,
    setPrefs: (prefs) =>
      serial(async () => {
        const next = parsePrefs(prefs);
        if (JSON.stringify(next) !== JSON.stringify(prefs)) throw new WidgetStoreError('These settings are not in a form Kalam can keep.');
        const cur = await read();
        await write(cur, cur.widgets, next);
      }),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export function createMemoryWidgetStore(initial: readonly WidgetDefinition[] = []): WidgetStore {
  let data: WidgetStoreData = { v: STORE_VERSION, widgets: JSON.parse(JSON.stringify(initial)) as unknown[], prefs: { ...DEFAULT_WIDGET_PREFS } };
  return createBlobWidgetStore({
    load: async () => data,
    save: async (next) => {
      data = next;
    },
  });
}
