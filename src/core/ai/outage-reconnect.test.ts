/**
 * Provider outage and reconnect (docs/07 §CP11, docs/13 §9.1, D07-057). Nothing here mocks the orchestrator: the real one runs against a
 * provider and a network that go down and come back, and the checks are about what a person is left with: their words kept, a plain
 * message instead of a stack trace, no call made while the network is known to be down, and the very next request working once it is
 * back, with the failed run in the activity log and no leftover state from it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, type AIErrorCode, type AIExecutionResult, type AIProvider, type InferenceEvent, type KalamSettings, type NormalizedInput,
  type OnDeviceStatus, type StructuredRequest,
} from '../contracts';
import { createApplicationPipeline } from '../pipeline/create-application';
import { createOrchestrator } from './orchestrator';

const tailorIR = JSON.parse(readFileSync(new URL('../../../tests/fixtures/compiler/tailor-shop.ir.json', import.meta.url), 'utf8'));

type Health = 'up' | AIErrorCode | 'throw';

/** A provider whose health can be changed between and during a run. `script` answers the next calls first. */
function world(opts: { device?: OnDeviceStatus['availability'] } = {}) {
  const state = { health: 'up' as Health, script: [] as Health[], connected: true, calls: 0 };
  const events: InferenceEvent[] = [];
  const firebase: AIProvider = {
    name: 'firebase',
    isConfigured: () => true,
    onDeviceStatus: async () => ({ platform: 'web', apiExposed: true, availability: opts.device ?? 'unavailable' }),
    async generateStructured<T>(req: StructuredRequest<T>): Promise<AIExecutionResult<T>> {
      state.calls += 1;
      const source: 'on_device' | 'cloud' = req.mode === 'only_on_device' || (req.mode === 'prefer_on_device' && opts.device === 'available') ? 'on_device' : 'cloud';
      // The outage is the cloud's: the device model keeps answering.
      const step = source === 'on_device' ? 'up' : (state.script.shift() ?? state.health);
      const base = { provider: 'firebase' as const, source, model: 'm', latencyMs: 3, fallbackUsed: false };
      if (step === 'throw') throw new Error('socket hang up');
      if (step !== 'up') return { success: false, ...base, errorCode: step, errorMessage: 'upstream detail that must not reach the person' };
      const raw = req.taskType === 'create_app' || req.taskType === 'repair_spec' ? tailorIR : { answer: 'ok' };
      const parsed = req.parse(raw);
      return parsed.success ? { success: true, output: parsed.data, ...base } : { success: false, ...base, errorCode: 'invalid_output' };
    },
  };
  let settings: KalamSettings = { ...DEFAULT_SETTINGS, allowCloud: true, cloudNoticeSeen: true };
  const ai = createOrchestrator({
    firebase,
    specialist: { ...firebase, name: 'claude', isConfigured: () => false },
    events: { add: async (e) => { events.push(e); }, list: async (n) => events.slice(-(n ?? events.length)).reverse(), clear: async () => { events.length = 0; } },
    settings: { get: async () => settings, update: async (p) => (settings = { ...settings, ...p }) },
    // `can` is the connectivity hold (docs/09 §13.4): cloud work waits out a recent network failure.
    network: { online: () => state.connected, can: (kind) => (kind === 'cloud' ? state.connected : true), subscribe: () => () => {} },
    retryDelayMs: () => 0,
    platform: 'web',
    // Outage handling is tested apart from the benchmark gate (a recorded run can keep a task off the device).
    localReady: () => 'unproven',
  });
  return { ai, state, events };
}

const note = (mode: StructuredRequest<{ answer: string }>['mode'], taskType: StructuredRequest<unknown>['taskType'] = 'classify', prompt = 'Is milk a grocery?'): StructuredRequest<{ answer: string }> => ({
  taskType, prompt, jsonSchema: { type: 'object' }, mode,
  parse: (raw) => (typeof (raw as { answer?: unknown })?.answer === 'string' ? { success: true, data: { answer: (raw as { answer: string }).answer } } : { success: false, error: 'bad' }),
});
const REQUEST = 'A tailor shop book with customers and orders, measurements chest waist sleeve, delivery dates, advance payment and a photo of the measurement slip.';
const input = (): NormalizedInput => ({ text: REQUEST, modalities: ['text'], images: [] });

describe('provider outage (D07-057)', () => {
  it('retries a service error twice, then fails with a plain message and records the retries', async () => {
    const w = world();
    w.state.health = 'provider_error';
    const res = await w.ai.run(note('only_in_cloud', 'summarize'), { taskType: 'summarize' });
    expect(res).toMatchObject({ success: false, errorCode: 'provider_error' });
    expect(w.state.calls).toBe(3); // the first call and two retries, never a loop
    // The provider's own words stay technical detail: the activity event keeps a code and counts, never the message.
    expect(JSON.stringify(w.events)).not.toContain('upstream detail');
    expect(w.events.at(-1)).toMatchObject({ success: false, errorCode: 'provider_error', retries: 2 });
  });

  it('survives an outage that clears in the middle of a run: the retry answers', async () => {
    const w = world();
    w.state.script = ['provider_error', 'quota'];
    const res = await w.ai.run(note('only_in_cloud', 'summarize'), { taskType: 'summarize' });
    expect(res).toMatchObject({ success: true, output: { answer: 'ok' } });
    expect(w.state.calls).toBe(3);
    expect(w.events.at(-1)).toMatchObject({ success: true, retries: 2 });
  });

  it('does not retry what a retry cannot fix (a refused request, a bad answer)', async () => {
    for (const code of ['bad_request', 'invalid_output', 'app_check_failed'] as const) {
      const w = world();
      w.state.health = code;
      await w.ai.run(note('only_in_cloud', 'summarize'), { taskType: 'summarize' });
      expect(w.state.calls, code).toBe(1);
    }
  });

  it('a provider that throws is one failed run, never a crash and never retried', async () => {
    const w = world();
    w.state.health = 'throw';
    const res = await w.ai.run(note('only_in_cloud', 'summarize'), { taskType: 'summarize' });
    expect(res.success).toBe(false);
    expect(w.state.calls).toBe(1);
    expect(JSON.stringify(w.events)).not.toContain('socket hang up');
  });

  it('the create pipeline keeps the person\'s words and says so, then builds the same request once the provider is back', async () => {
    const w = world();
    const create = createApplicationPipeline({ ai: w.ai });
    const typed = input();
    w.state.health = 'provider_error';
    const down = await create(typed);
    expect(down.ok).toBe(false);
    expect(down.spec).toBeUndefined();
    expect(down.message).toMatch(/kept/i);
    expect(down.message).not.toMatch(/upstream|socket|undefined|stack/i);
    expect(typed.text).toBe(REQUEST); // nothing was consumed or cleared
    w.state.health = 'up';
    const back = await create(typed);
    expect(back.ok).toBe(true);
    expect(back.spec?.screens.length).toBeGreaterThan(0);
  });
});

describe('network loss and reconnect (D07-057)', () => {
  it('makes no provider call while the network is known to be down, and says it is offline', async () => {
    const w = world();
    w.state.connected = false;
    const res = await w.ai.run(note('only_in_cloud', 'summarize'), { taskType: 'summarize' });
    expect(res).toMatchObject({ success: false, errorCode: 'offline' });
    expect(w.state.calls).toBe(0);
    expect(res.errorMessage).toMatch(/online|offline|internet/i);
  });

  it('the first request after reconnect works, and the failed one stays in the activity log', async () => {
    const w = world();
    w.state.connected = false;
    const down = await w.ai.run(note('only_in_cloud', 'summarize'), { taskType: 'summarize' });
    w.state.connected = true;
    const up = await w.ai.run(note('only_in_cloud', 'summarize'), { taskType: 'summarize' });
    expect(down.success).toBe(false);
    expect(up).toMatchObject({ success: true, source: 'cloud' });
    expect(w.state.calls).toBe(1);
    expect(w.events.map((e) => [e.success, e.errorCode])).toEqual([[false, 'offline'], [true, undefined]]);
  });

  it('a local task keeps working through the whole outage on the device, and goes back to the cloud preference after', async () => {
    const w = world({ device: 'available' });
    w.state.connected = false;
    w.state.health = 'provider_error';
    const offline = await w.ai.run(note('prefer_on_device'), { taskType: 'classify' });
    expect(offline).toMatchObject({ success: true, source: 'on_device' });
    w.state.connected = true;
    w.state.health = 'up';
    const back = await w.ai.run(note('prefer_on_device'), { taskType: 'classify' });
    expect(back).toMatchObject({ success: true, source: 'on_device' });
    expect(w.events.every((e) => e.success)).toBe(true);
  });

  it('a cloud-only task fails fast offline and works again on reconnect, with no stuck state in between', async () => {
    const w = world();
    const create = createApplicationPipeline({ ai: w.ai });
    w.state.connected = false;
    const typed = input();
    const down = await create(typed);
    expect(down).toMatchObject({ ok: false });
    expect(down.message).toMatch(/offline|online|internet/i);
    expect(w.state.calls).toBe(0);
    w.state.connected = true;
    const up = await create(typed);
    expect(up.ok).toBe(true);
    // Several outages and reconnects in a row leave no residue.
    for (let i = 0; i < 3; i++) {
      w.state.connected = false;
      // A new question each round: an identical one is answered from the reuse cache, which is a different test.
      expect((await w.ai.run(note('only_in_cloud', 'summarize', `Round ${i} down`), { taskType: 'summarize' })).errorCode).toBe('offline');
      w.state.connected = true;
      expect((await w.ai.run(note('only_in_cloud', 'summarize', `Round ${i} up`), { taskType: 'summarize' })).success).toBe(true);
    }
  });
});
