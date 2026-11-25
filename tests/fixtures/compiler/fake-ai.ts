/**
 * Test double for AIOrchestrator. Mirrors the real orchestrator's contract: consent/connectivity
 * failures, `parse` as the final authority (parse failure → invalid_output), and the source that
 * a mode would actually produce. Production code never uses this.
 */
import type {
  AIErrorCode, AIExecutionResult, AIOrchestrator, InferenceEvent, InferenceSource, OnDeviceStatus, StructuredRequest,
} from '@/core/contracts';

type RunCtx = Parameters<AIOrchestrator['run']>[1];
export type FakeReply =
  | { raw: unknown; source?: InferenceSource; model?: string }
  | { error: AIErrorCode; message?: string };

export interface FakeCall {
  req: StructuredRequest<unknown>;
  ctx: RunCtx;
  result: AIExecutionResult<unknown>;
}

export interface FakeAIOptions {
  online?: boolean;
  onDevice?: OnDeviceStatus['availability'];
  cloudConfigured?: boolean;
  specialistConfigured?: boolean;
  /** Reported as OnDeviceStatus.warm (omitted when undefined, like platforms that cannot tell). */
  warm?: boolean;
  /** Milliseconds each run() waits before answering (simulates a cold or slow model). */
  delayMs?: number;
  respond?: (req: StructuredRequest<unknown>, ctx: RunCtx, callIndex: number) => FakeReply;
}

export interface FakeAI extends AIOrchestrator {
  calls: FakeCall[];
  events: Array<Omit<InferenceEvent, 'id' | 'at' | 'provider' | 'source' | 'fallbackUsed'>>;
  cloudCalls(): FakeCall[];
  warmUps: number;
}

const onDeviceModes = new Set(['only_on_device', 'prefer_on_device']);

export function createFakeAI(opts: FakeAIOptions = {}): FakeAI {
  const online = opts.online ?? true;
  const onDevice = opts.onDevice ?? 'unavailable';
  const calls: FakeCall[] = [];
  const events: FakeAI['events'] = [];

  const ai: FakeAI = {
    calls,
    events,
    warmUps: 0,
    cloudCalls: () => calls.filter((c) => c.result.source === 'cloud' || c.req.mode === 'only_in_cloud' || c.req.mode === 'prefer_in_cloud'),
    async run<T>(req: StructuredRequest<T>, ctx: RunCtx): Promise<AIExecutionResult<T>> {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      const wantsDevice = onDeviceModes.has(req.mode) && onDevice === 'available';
      const source: InferenceSource = wantsDevice ? 'on_device' : 'cloud';
      const fail = (errorCode: AIErrorCode, errorMessage?: string): AIExecutionResult<T> => ({
        success: false, provider: 'none', source, latencyMs: 1, fallbackUsed: false, errorCode, errorMessage,
      });
      let result: AIExecutionResult<T>;
      if (req.mode === 'only_on_device' && onDevice !== 'available') result = fail('model_unavailable');
      else if (source === 'cloud' && !online) result = fail('offline');
      else {
        const reply = opts.respond?.(req as StructuredRequest<unknown>, ctx, calls.length) ?? { error: 'provider_error' as const };
        if ('error' in reply) result = fail(reply.error, reply.message);
        else {
          const parsed = req.parse(reply.raw);
          const src = reply.source ?? source;
          result = parsed.success
            ? { success: true, output: parsed.data, provider: 'firebase', source: src, model: reply.model ?? (src === 'on_device' ? 'gemini-nano' : 'gemini-2.5-flash'), latencyMs: 5, fallbackUsed: false }
            : { ...fail('invalid_output', parsed.error), provider: 'firebase' };
        }
      }
      calls.push({ req: req as StructuredRequest<unknown>, ctx, result: result as AIExecutionResult<unknown> });
      return result;
    },
    async recordDeterministic(e) {
      events.push(e);
    },
    async status() {
      return {
        onDevice: {
          platform: 'web', apiExposed: onDevice !== 'unavailable', availability: onDevice,
          ...(opts.warm === undefined ? {} : { warm: opts.warm }),
        },
        cloudConfigured: opts.cloudConfigured ?? true,
        online,
        specialistConfigured: opts.specialistConfigured ?? false,
      };
    },
    async prepareOnDevice() {
      return { platform: 'web', apiExposed: true, availability: onDevice };
    },
    async warmUpOnDevice() {
      ai.warmUps += 1;
      return { platform: 'web', apiExposed: true, availability: onDevice, warm: onDevice === 'available' };
    },
  };
  return ai;
}
