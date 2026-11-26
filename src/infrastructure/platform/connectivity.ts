/**
 * Connectivity service (docs/09 §13.4). One place that answers: am I online, since when, how many cloud
 * operations are in flight or waiting, and may this kind of work proceed now.
 *
 * It wraps the platform `NetworkMonitor` and IS a NetworkMonitor (online, subscribe), so it can stand in for
 * `services.network` and be handed to anything that takes one (the orchestrator, the operation queue).
 *
 * "Browser online events are hints, not proof": the monitor says online, but a cloud call may still fail. Work
 * that goes through `track` reports its outcome; a network-looking failure marks the cloud unreachable, and
 * `can('cloud')` says no for a short while (RETRY_AFTER_MS), then lets one more try through. A success, or the
 * monitor reporting a change, clears the mark at once. `online()` stays the monitor's own answer.
 * Nothing here reads or stores a request, a response, a prompt or a record. Pure TypeScript.
 */
import type { NetworkMonitor } from '@/core/contracts';
import { getNetworkMonitor } from './network';

/** After a network failure, how long cloud work is held back before the next attempt is allowed. */
export const RETRY_AFTER_MS = 20_000;

export type OperationKind = 'local' | 'cloud';

export interface ConnectivitySnapshot {
  /** What the platform reports. A hint. */
  online: boolean;
  /** False for a short while after a cloud call failed although the platform said online. */
  reachable: boolean;
  /** Epoch ms of the last change of the online state seen by this service, or null if none yet. */
  lastChangeAt: number | null;
  /** Cloud operations in flight plus whatever the added sources count (for example the operation queue). */
  pending: number;
}

export interface Connectivity extends NetworkMonitor {
  lastChange(): number | null;
  pending(): number;
  /** Adds a synchronous count (for example waiting queued operations) to `pending()`. Returns a remover. */
  addPendingSource(count: () => number): () => void;
  /** Runs a cloud call, counting it as pending and learning from how it ends. Errors are rethrown unchanged. */
  track<T>(operation: () => Promise<T>): Promise<T>;
  /** Local work always may. Cloud work needs the platform online and the cloud not recently unreachable. */
  can(kind: OperationKind): boolean;
  snapshot(): ConnectivitySnapshot;
  /** Hears every change of the snapshot (online, reachable, pending). Returns a remover. */
  watch(listener: (snapshot: ConnectivitySnapshot) => void): () => void;
  /** Stops listening to the platform. Only tests and teardown need it. */
  dispose(): void;
}

/** A failure that says the network or the service could not be reached, not that the request was wrong. */
export function looksUnreachable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /unavailable|network|deadline|timeout|offline/i.test(code)) return true;
  const text = error instanceof Error ? `${error.name} ${error.message}` : '';
  return /network request failed|failed to fetch|networkerror|load failed|timed? ?out|offline/i.test(text);
}

export function createConnectivity(monitor: NetworkMonitor, clock: () => number = Date.now): Connectivity {
  let lastChangeAt: number | null = null;
  let failedAt: number | null = null;
  let inFlight = 0;
  let lastOnline = monitor.online();
  const sources = new Set<() => number>();
  const online = new Set<(online: boolean) => void>();
  const watchers = new Set<(snapshot: ConnectivitySnapshot) => void>();

  const reachable = () => failedAt === null || clock() - failedAt >= RETRY_AFTER_MS;
  const pending = () => {
    let n = inFlight;
    for (const count of sources) {
      try {
        n += Math.max(0, count() | 0);
      } catch {
        // A broken source counts as zero; it must never break the status line.
      }
    }
    return n;
  };
  const snapshot = (): ConnectivitySnapshot => ({ online: monitor.online(), reachable: reachable(), lastChangeAt, pending: pending() });
  const notify = () => {
    const s = snapshot();
    for (const w of [...watchers]) {
      try {
        w(s);
      } catch {
        // One bad listener must not stop the others.
      }
    }
  };

  const off = monitor.subscribe((now) => {
    if (now !== lastOnline) {
      lastOnline = now;
      lastChangeAt = clock();
    }
    failedAt = null; // a new network says nothing about the old failure
    for (const l of [...online]) {
      try {
        l(now);
      } catch {
        // Same: keep going.
      }
    }
    notify();
  });

  return {
    online: () => monitor.online(),
    subscribe(listener) {
      online.add(listener);
      return () => void online.delete(listener);
    },
    lastChange: () => lastChangeAt,
    pending,
    addPendingSource(count) {
      sources.add(count);
      return () => void sources.delete(count);
    },
    async track(operation) {
      inFlight++;
      notify();
      try {
        const result = await operation();
        if (failedAt !== null) {
          failedAt = null;
          notify();
        }
        return result;
      } catch (error) {
        if (looksUnreachable(error)) failedAt = clock();
        throw error;
      } finally {
        inFlight--;
        notify();
      }
    },
    can: (kind) => kind === 'local' || (monitor.online() && reachable()),
    snapshot,
    watch(listener) {
      watchers.add(listener);
      return () => void watchers.delete(listener);
    },
    dispose() {
      off();
      online.clear();
      watchers.clear();
      sources.clear();
    },
  };
}

let instance: Connectivity | undefined;

/** The app-wide service over the platform monitor. */
export function getConnectivity(): Connectivity {
  return (instance ??= createConnectivity(getNetworkMonitor()));
}
