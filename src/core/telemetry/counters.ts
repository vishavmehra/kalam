/**
 * Opt-in, content-free usage counters (docs/01 §20, docs/12 §21, docs/14 §30).
 *
 * Decisions, recorded here so they are not lost:
 * - Off by default. Nothing is counted until the person turns it on, and turning it off stops counting.
 * - A counter is an event name plus one value from a closed list. There is no free text, no id, no
 *   record value, no prompt and no file name, so a count cannot carry content. An error counts by its
 *   stable code only; any other message is counted as `other`.
 * - Counts are kept on this device and shown to the person, who can export them as JSON or reset them.
 * - Nothing is sent to any server. There is no metrics backend. Sending counts would need a new
 *   consent screen, a server to receive them and an update to docs/11. Until then, the export is the
 *   only way a count leaves the device, and only when the person shares it.
 */
import { KNOWN_ERROR_CODES, toErrorCode } from '../observability/errors';

export const TELEMETRY_VOCAB = {
  /** Apps made, by what the person gave Kalam. `mixed` is more than one input. */
  apps_created: ['text', 'image', 'audio', 'video', 'drawing', 'mixed', 'template'],
  /** Which kind of work produced an AI result (contracts InferenceSource). */
  ai_source: ['on_device', 'cloud', 'deterministic'],
  /** Apps opened, with or without a connection. */
  app_opened: ['online', 'offline'],
  /** Failures, by stable code. */
  error: [...KNOWN_ERROR_CODES, 'other'],
  /** Features used, one count per use (the areas in docs/14 §30). */
  feature_used: ['visual_edit', 'report', 'photo_extract', 'voice_command', 'reminder', 'translation', 'share_link', 'assistant'],
  /**
   * Bazaar actions this person took (docs/12 §21). Listing views and purchase counts for creators need a
   * server that sees many people, so they cannot be counted on one device and are not counted here.
   */
  bazaar: ['installed', 'published'],
} as const;

export type TelemetryEvent = keyof typeof TELEMETRY_VOCAB;
export type TelemetryDimension<E extends TelemetryEvent> = (typeof TELEMETRY_VOCAB)[E][number];

export const TELEMETRY_EVENTS = Object.keys(TELEMETRY_VOCAB) as TelemetryEvent[];

const MAX_COUNT = 1_000_000_000;
const KEY_SEPARATOR = ':';

/** `apps_created` dimension for one creation: the single input kind, or `mixed`, or `template`. */
export function inputKindFor(modalities: readonly string[], options: { template?: boolean } = {}): TelemetryDimension<'apps_created'> {
  const kinds = new Set<TelemetryDimension<'apps_created'>>();
  for (const m of modalities) {
    if (m === 'text' || m === 'image' || m === 'audio' || m === 'video' || m === 'drawing') kinds.add(m);
  }
  if (kinds.size === 1) return [...kinds][0];
  if (kinds.size > 1) return 'mixed';
  return options.template ? 'template' : 'text';
}

/** The value to count, or undefined when it is not on the list. Errors fall back to `other`. */
export function normalizeDimension(event: TelemetryEvent, raw: unknown): string | undefined {
  if (!Object.hasOwn(TELEMETRY_VOCAB, event)) return undefined;
  if (event === 'error') return toErrorCode(raw);
  const list = TELEMETRY_VOCAB[event] as readonly string[];
  return typeof raw === 'string' && list.includes(raw) ? raw : undefined;
}

/** Where the counters are kept. The app binds this to device storage; tests use memory. */
export interface TelemetryStore {
  read(): Promise<string | null>;
  write(json: string): Promise<void>;
}

export type TelemetryCounts = { [E in TelemetryEvent]: Record<string, number> };

export interface TelemetrySnapshot {
  /** False until the saved counters have been read. */
  loaded: boolean;
  enabled: boolean;
  /** ISO time counting started, or null. */
  since: string | null;
  counts: TelemetryCounts;
  /** Sum of all counts. */
  total: number;
}

export interface Telemetry {
  /** Resolves once the saved counters are read. Never rejects. */
  readonly ready: Promise<void>;
  isEnabled(): boolean;
  setEnabled(on: boolean): Promise<void>;
  /** Adds one. Does nothing while counting is off or when the value is not on the list. Never rejects. */
  count(event: TelemetryEvent, dimension: unknown): Promise<void>;
  snapshot(): TelemetrySnapshot;
  /** The counters as JSON text for the person to copy or share. */
  exportJson(): string;
  /** Sets every count to zero. Leaves counting on or off as it was. */
  reset(): Promise<void>;
  subscribe(listener: () => void): () => void;
  version(): number;
}

interface State {
  enabled: boolean;
  since: number | null;
  counts: Record<string, number>;
}

const keyOf = (event: string, dimension: string) => `${event}${KEY_SEPARATOR}${dimension}`;

function isKnownKey(key: string): boolean {
  const at = key.indexOf(KEY_SEPARATOR);
  if (at < 1) return false;
  const event = key.slice(0, at);
  return Object.hasOwn(TELEMETRY_VOCAB, event)
    && (TELEMETRY_VOCAB[event as TelemetryEvent] as readonly string[]).includes(key.slice(at + 1));
}

/** Saved data is untrusted: keep only known keys with sane numbers. */
export function parseState(raw: string | null): State {
  const empty: State = { enabled: false, since: null, counts: {} };
  if (!raw) return empty;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof data !== 'object' || data === null) return empty;
  const d = data as { enabled?: unknown; since?: unknown; counts?: unknown };
  const counts: Record<string, number> = {};
  if (typeof d.counts === 'object' && d.counts !== null) {
    for (const [key, value] of Object.entries(d.counts)) {
      if (isKnownKey(key) && typeof value === 'number' && Number.isInteger(value) && value > 0) counts[key] = Math.min(value, MAX_COUNT);
    }
  }
  return {
    enabled: d.enabled === true,
    since: typeof d.since === 'number' && Number.isFinite(d.since) ? d.since : null,
    counts,
  };
}

export function createTelemetry(store: TelemetryStore, now: () => number = Date.now): Telemetry {
  let state: State = { enabled: false, since: null, counts: {} };
  let loaded = false;
  let version = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    version += 1;
    for (const l of [...listeners]) l();
  };
  let writes: Promise<void> = Promise.resolve();
  /** Writes go one after another, each with the state as it was when asked. A failed write is not fatal. */
  const persist = (): Promise<void> => {
    const json = JSON.stringify(state);
    writes = writes.then(() => store.write(json)).catch(() => undefined);
    return writes;
  };

  const ready = Promise.resolve()
    .then(() => store.read())
    .then((raw) => { state = parseState(raw); }, () => undefined)
    .then(() => {
      loaded = true;
      changed();
    });

  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

  function snapshot(): TelemetrySnapshot {
    const counts = {} as TelemetryCounts;
    let total = 0;
    for (const event of TELEMETRY_EVENTS) {
      counts[event] = {};
      for (const dimension of TELEMETRY_VOCAB[event] as readonly string[]) {
        const n = state.counts[keyOf(event, dimension)];
        if (n) {
          counts[event][dimension] = n;
          total += n;
        }
      }
    }
    return { loaded, enabled: loaded && state.enabled, since: iso(state.since), counts, total };
  }

  return {
    ready,
    isEnabled: () => loaded && state.enabled,
    async setEnabled(on) {
      await ready;
      if (state.enabled === on) return;
      state = { ...state, enabled: on, since: on && state.since === null ? now() : state.since };
      changed();
      await persist();
    },
    async count(event, dimension) {
      await ready;
      if (!state.enabled) return;
      const value = normalizeDimension(event, dimension);
      if (value === undefined) return;
      const key = keyOf(event, value);
      state = { ...state, counts: { ...state.counts, [key]: Math.min(MAX_COUNT, (state.counts[key] ?? 0) + 1) } };
      changed();
      await persist();
    },
    snapshot,
    exportJson() {
      const { enabled, since, counts } = snapshot();
      return JSON.stringify({ format: 'kalam-usage-counts', version: 1, exportedAt: iso(now()), enabled, since, counts }, null, 2);
    },
    async reset() {
      await ready;
      state = { enabled: state.enabled, since: state.enabled ? now() : null, counts: {} };
      changed();
      await persist();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
  };
}
