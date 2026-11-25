/**
 * The call sites' way in. `track('ai_source', 'cloud')` is safe to call from anywhere: it does
 * nothing until the app installs a telemetry instance, and nothing while the person has counting off.
 * It never throws and never waits.
 */
import { errorLog, type ErrorCode } from '../observability';
import type { Telemetry, TelemetryDimension, TelemetryEvent } from './counters';

let active: Telemetry | undefined;

/** Called once at app start. Pass `undefined` to detach (tests). */
export function installTelemetry(telemetry: Telemetry | undefined): void {
  active = telemetry;
}

export function track<E extends TelemetryEvent>(event: E, dimension: TelemetryDimension<E>): void {
  try {
    void active?.count(event, dimension).catch(() => undefined);
  } catch {
    // Counting must never break the feature it counts.
  }
}

/**
 * Records a failure in the recent-errors log (always, in memory) and counts it by code (only when
 * counting is on). Only the stable code is kept; the message is dropped.
 */
export function reportError(raw: unknown): ErrorCode {
  const code = errorLog.note(raw);
  track('error', code);
  return code;
}
