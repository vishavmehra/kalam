import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { errorLog, timings, type TimingSummary } from '@/core/observability';
import { createTelemetry, installTelemetry, type Telemetry, type TelemetrySnapshot } from '@/core/telemetry';
import { getServices } from '@/services';
import { useSettingsStore } from '@/state/settings-store';

import { collectProblemReport } from './collect-report';
import { readDeviceInfo } from './device';
import type { ReportArea } from './report';
import { storageTelemetryStore } from './telemetry-store';

let shared: Telemetry | undefined;

/** The one usage counter for the app. It reads its saved state on first use and counts nothing until the person turns it on. */
export function getTelemetry(): Telemetry {
  shared ??= createTelemetry(storageTelemetryStore(AsyncStorage));
  return shared;
}

/**
 * Call once when the app starts. After this, `track(...)` and `reportError(...)` from `@/core/telemetry`
 * reach the counter. Counting stays off until the person turns it on in Settings.
 */
export function startDiagnostics(): void {
  installTelemetry(getTelemetry());
}

interface Versioned {
  subscribe(listener: () => void): () => void;
  version(): number;
}

const cache = new Map<string, { version: number; value: unknown }>();

/**
 * A live read of a versioned source. `useSyncExternalStore` needs the same value back until something
 * changes, so the value is kept per `key` and rebuilt only when the source's version moves.
 */
function useVersioned<T>(key: string, source: Versioned, read: () => T): T {
  const get = (): T => {
    const version = source.version();
    const hit = cache.get(key);
    if (hit && hit.version === version) return hit.value as T;
    const value = read();
    cache.set(key, { version, value });
    return value;
  };
  return useSyncExternalStore(source.subscribe, get, get);
}

/** The counters, live. Re-renders when a count, the switch or a reset changes them. */
export function useTelemetry(): { telemetry: Telemetry; snapshot: TelemetrySnapshot; json: string } {
  const telemetry = getTelemetry();
  const view = useVersioned('telemetry', telemetry, () => ({ snapshot: telemetry.snapshot(), json: telemetry.exportJson() }));
  return { telemetry, ...view };
}

/** The timing summaries, live. */
export function useTimingSummaries(): TimingSummary[] {
  return useVersioned('timings', timings, () => timings.summarize());
}

/**
 * The text of a problem report, rebuilt each time the sheet opens or the area changes. It is
 * assembled on this device and shown to the person before anything is shared.
 */
export function useProblemReport(visible: boolean, area: ReportArea): { text: string; ready: boolean } {
  const settings = useSettingsStore((s) => s.settings);
  const { snapshot } = useTelemetry();
  const [text, setText] = useState('');
  const counting = snapshot.enabled;

  useEffect(() => {
    if (!visible) return undefined;
    let alive = true;
    void collectProblemReport(area, {
      now: Date.now,
      device: readDeviceInfo(),
      settings,
      usageCounts: counting,
      errorCodes: () => errorLog.recent().map((e) => e.code),
      timings: () => timings.summarize(),
      events: (limit) => getServices().db.events.list(limit),
    }).then(({ text: next }) => {
      if (alive) setText(next);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [visible, area, settings, counting]);

  return { text, ready: text !== '' };
}
