import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { errorLog, recoveryLog, timings, type TimingSummary } from '@/core/observability';
import { createTelemetry, installTelemetry, type Telemetry, type TelemetrySnapshot } from '@/core/telemetry';
import { getServices } from '@/services';
import { useSettingsStore } from '@/state/settings-store';

import { collectProblemReport } from './collect-report';
import { buildEvidenceExport, EVIDENCE_MAX_EVENTS, formatEvidenceJson } from './evidence-export';
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
 * Wipes what this feature keeps in memory or on this device: usage counts, timings and recent errors.
 * Call it from "delete all data" so no count of apps made or opened survives a wipe. Counting stays on
 * or off as the person left it.
 */
export async function clearDiagnostics(): Promise<void> {
  timings.clear();
  errorLog.clear();
  recoveryLog.clear();
  await getTelemetry().reset();
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

/**
 * The AI run evidence as JSON text, read from the activity log when the person acts so it holds the runs up to that
 * moment (D17-029). `runs` is how many events went in. Throws when the log cannot be read: the caller says so.
 */
export async function exportInferenceEvidence(): Promise<{ json: string; runs: number }> {
  const services = getServices();
  const device = readDeviceInfo();
  const [events, status] = await Promise.all([
    services.db.events.list(EVIDENCE_MAX_EVENTS),
    services.ai.status().then((s) => s.onDevice).catch(() => undefined),
  ]);
  const evidence = buildEvidenceExport({ now: Date.now(), appVersion: device.appVersion, platform: device.platform, onDevice: status, events });
  return { json: formatEvidenceJson(evidence), runs: evidence.events.length };
}

/** The timing summaries, live. */
export function useTimingSummaries(): TimingSummary[] {
  return useVersioned('timings', timings, () => timings.summarize());
}

/**
 * The text of a problem report, rebuilt each time the sheet opens or the area changes. It is
 * assembled on this device and shown to the person before anything is shared. `ready` is true only
 * for a report built for the area shown now, so a stale report from another area or an earlier
 * opening is never offered for sharing.
 */
export function useProblemReport(visible: boolean, area: ReportArea): { text: string; ready: boolean } {
  const settings = useSettingsStore((s) => s.settings);
  const { snapshot } = useTelemetry();
  const [built, setBuilt] = useState<{ area: ReportArea; text: string } | null>(null);
  const counting = snapshot.enabled;

  useEffect(() => {
    if (!visible) {
      setBuilt(null);
      return undefined;
    }
    let alive = true;
    void collectProblemReport(area, {
      now: Date.now,
      device: readDeviceInfo(),
      settings,
      usageCounts: counting,
      errorCodes: () => errorLog.recent().map((e) => e.code),
      timings: () => timings.summarize(),
      events: (limit) => getServices().db.events.list(limit),
    }).then(({ text }) => {
      if (alive) setBuilt({ area, text });
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [visible, area, settings, counting]);

  const current = visible && built?.area === area ? built.text : '';
  return { text: current, ready: current !== '' };
}
