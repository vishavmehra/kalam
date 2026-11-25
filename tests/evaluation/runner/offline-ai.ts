/**
 * The AI orchestrator used by deterministic evaluation: no model is reachable. Anything that needs a
 * model fails with `offline`, so a template app proves it was built without one, and cloud-only
 * requests are reported as "needs cloud" instead of being faked. Never used in production code.
 */
import type { AIExecutionResult, AIOrchestrator, InferenceEvent, OnDeviceStatus } from '@/core/contracts';

const NO_ON_DEVICE: OnDeviceStatus = { platform: 'other', apiExposed: false, availability: 'unavailable' };

export type RecordedEvent = Omit<InferenceEvent, 'id' | 'at' | 'provider' | 'source' | 'fallbackUsed'>;

export interface OfflineAI extends AIOrchestrator {
  /** Number of model calls attempted. Must stay 0 on the template route. */
  readonly runCalls: () => number;
  /** Deterministic decisions the pipeline recorded (template builds, refused cloud routes). */
  readonly events: () => readonly RecordedEvent[];
}

export function createOfflineAI(): OfflineAI {
  let runs = 0;
  const events: RecordedEvent[] = [];
  return {
    runCalls: () => runs,
    events: () => events,
    async run<T>(): Promise<AIExecutionResult<T>> {
      runs += 1;
      return {
        success: false,
        provider: 'none',
        source: 'cloud',
        latencyMs: 0,
        fallbackUsed: false,
        errorCode: 'offline',
      };
    },
    async recordDeterministic(e) {
      events.push(e);
    },
    async status() {
      return { onDevice: NO_ON_DEVICE, cloudConfigured: false, online: false, specialistConfigured: false };
    },
    async prepareOnDevice() {
      return NO_ON_DEVICE;
    },
    async warmUpOnDevice() {
      return NO_ON_DEVICE;
    },
  };
}
