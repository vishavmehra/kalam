/**
 * The one-time cloud notice (docs/03 §23, docs/11 §8.3) gates every call that would reach Firebase, not
 * only a cloud build: the single cloud fallback of voice, translation, edit and AI-step runs, a photo
 * read, and any task the device model cannot take. No OK, no call, and an honest result.
 */
import { describe, expect, it, vi } from 'vitest';
import { createFakeAI } from '../../../tests/fixtures/compiler/fake-ai';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import {
  DEFAULT_SETTINGS, type AIErrorCode, type AIExecutionResult, type AIProvider, type InferenceEvent, type InferenceMode,
  type KalamSettings, type StructuredRequest, type TaskType,
} from '../contracts';
import { validateSpec } from '../spec';
import type { KalamSpec } from '../spec/schema';
import { createEditService } from '../tasks/edit-service';
import { createTranslateService } from '../tasks/translate-service';
import { AI_COPY, needsCloudOk, noticeDeclined } from './copy';
import { createOrchestrator, NOTICE_COOLDOWN_MS } from './orchestrator';

/** A Firebase provider that answers from `script` (default: ok); the source follows the mode and the device, like the SDK. */
function provider(script: Array<AIErrorCode | 'ok'> = [], device: 'available' | 'unavailable' = 'available') {
  const calls: Array<StructuredRequest<unknown>> = [];
  const steps = [...script];
  const p: AIProvider = {
    name: 'firebase',
    isConfigured: () => true,
    onDeviceStatus: async () => ({ platform: 'web', apiExposed: true, availability: device }),
    async generateStructured<T>(req: StructuredRequest<T>): Promise<AIExecutionResult<T>> {
      calls.push(req as StructuredRequest<unknown>);
      const step = steps.shift() ?? 'ok';
      const source = req.mode === 'only_on_device' || (req.mode === 'prefer_on_device' && device === 'available') ? 'on_device' : 'cloud';
      if (step !== 'ok') return { success: false, provider: 'firebase', source, latencyMs: 1, fallbackUsed: false, errorCode: step };
      const parsed = req.parse({ answer: 'yes' });
      if (!parsed.success) throw new Error(parsed.error);
      return { success: true, output: parsed.data, provider: 'firebase', source, model: 'm', latencyMs: 1, fallbackUsed: false };
    },
  };
  return { p, calls };
}

function setup(o: {
  settings?: Partial<KalamSettings>; script?: Array<AIErrorCode | 'ok'>; device?: 'available' | 'unavailable';
  ask?: ((a: { taskType: TaskType; appId?: string }) => Promise<boolean | undefined>) | null; online?: boolean; clock?: { t: number };
} = {}) {
  const fb = provider(o.script, o.device);
  const specialist = provider();
  const events: InferenceEvent[] = [];
  let settings: KalamSettings = { ...DEFAULT_SETTINGS, ...o.settings };
  const ask = vi.fn(o.ask ?? (async () => true));
  const ai = createOrchestrator({
    firebase: fb.p,
    specialist: { ...specialist.p, name: 'claude' },
    events: { add: async (e) => { events.push(e); }, list: async () => events, clear: async () => { events.length = 0; } },
    settings: { get: async () => settings, update: async (patch) => (settings = { ...settings, ...patch }) },
    network: { online: () => o.online ?? true, subscribe: () => () => {} },
    retryDelayMs: () => 0,
    rateLimit: false,
    cacheResults: false,
    now: o.clock ? () => o.clock!.t : undefined,
    askCloudNotice: o.ask === null ? undefined : ask,
  });
  return { ai, fb, events, ask };
}

let n = 0;
/** Distinct prompt each time so two runs are never merged into one. */
const req = (mode: InferenceMode): StructuredRequest<{ answer: string }> => ({
  taskType: 'classify', prompt: `Is milk a grocery? ${n++}`, jsonSchema: { type: 'object' }, mode,
  parse: (raw) => {
    const answer = (raw as { answer?: unknown }).answer;
    return typeof answer === 'string' ? { success: true, data: { answer } } : { success: false, error: 'bad' };
  },
});

const sayNo = async () => false;

describe('the single cloud fallback needs the notice', () => {
  it.each<TaskType>(['voice_action', 'translate', 'generate_patch', 'extract_data', 'summarize', 'classify'])(
    '%s: Nano fails, the person has not accepted, so nothing is sent and the result says so', async (task) => {
      const h = setup({ script: ['invalid_output'], ask: sayNo });
      const res = await h.ai.run(req('prefer_on_device'), { taskType: task, appId: 'a1' });
      expect(res).toMatchObject({ success: false, errorCode: 'consent_denied', errorMessage: AI_COPY.needsCloudOk, source: 'on_device' });
      expect(needsCloudOk(res)).toBe(true);
      expect(h.fb.calls.map((c) => c.mode)).toEqual(['prefer_on_device']);
      expect(h.ask).toHaveBeenCalledTimes(1);
      expect(h.ask).toHaveBeenCalledWith({ taskType: task, appId: 'a1' });
      // The recorded event keeps the real on-device failure, so on-device metrics stay honest.
      expect(h.events.at(-1)).toMatchObject({ success: false, errorCode: 'invalid_output', source: 'on_device' });
      expect(h.events.at(-1)!.escalationReason).toContain('cloud notice is not accepted');
    },
  );

  it('goes to the cloud once the person accepts, and asks only about the task, never its content', async () => {
    const h = setup({ script: ['invalid_output'] });
    const res = await h.ai.run({ ...req('prefer_on_device'), prompt: 'SECRET-RECORD-VALUE' }, { taskType: 'voice_action', appId: 'a1' });
    expect(res).toMatchObject({ success: true, source: 'cloud', fallbackUsed: true });
    expect(h.fb.calls.map((c) => c.mode)).toEqual(['prefer_on_device', 'only_in_cloud']);
    expect(JSON.stringify(h.ask.mock.calls)).not.toContain('SECRET');
  });

  it('is asked once: an accepted notice is remembered even before settings catch up', async () => {
    const h = setup({ script: ['invalid_output', 'ok', 'invalid_output'] });
    await h.ai.run(req('prefer_on_device'), { taskType: 'voice_action' });
    await h.ai.run(req('prefer_on_device'), { taskType: 'voice_action' });
    expect(h.fb.calls).toHaveLength(4);
    expect(h.ask).toHaveBeenCalledTimes(1);
  });

  it('never asks once settings say the notice was seen, or when no screen can answer', async () => {
    const seen = setup({ settings: { cloudNoticeSeen: true }, script: ['invalid_output'] });
    expect((await seen.ai.run(req('prefer_on_device'), { taskType: 'voice_action' })).success).toBe(true);
    expect(seen.ask).not.toHaveBeenCalled();
    const headless = setup({ ask: null, script: ['invalid_output'] });
    expect((await headless.ai.run(req('prefer_on_device'), { taskType: 'voice_action' })).success).toBe(true);
  });

  it('does not ask when the device answers or cloud is off, because nothing would leave the device', async () => {
    const fine = setup({ ask: sayNo });
    expect((await fine.ai.run(req('prefer_on_device'), { taskType: 'voice_action' })).source).toBe('on_device');
    const off = setup({ ask: sayNo, settings: { allowCloud: false }, script: ['invalid_output'] });
    const res = await off.ai.run(req('prefer_on_device'), { taskType: 'voice_action' });
    expect(res.errorCode).toBe('invalid_output');
    expect(needsCloudOk(res)).toBe(false);
    for (const h of [fine, off]) expect(h.ask).not.toHaveBeenCalled();
    const offline = setup({ ask: sayNo, online: false, script: ['invalid_output'] });
    await offline.ai.run(req('prefer_on_device'), { taskType: 'voice_action' });
    expect(offline.ask).not.toHaveBeenCalled();
  });

  it('keeps an only_on_device request on the device without asking', async () => {
    const h = setup({ ask: sayNo, script: ['invalid_output'] });
    const res = await h.ai.run(req('only_on_device'), { taskType: 'voice_action' });
    expect(res.errorCode).toBe('invalid_output');
    expect(h.ask).not.toHaveBeenCalled();
  });
});

describe('calls that go straight to the cloud need the notice too', () => {
  it.each<[TaskType, InferenceMode, 'available' | 'unavailable']>([
    ['modify_app', 'only_in_cloud', 'available'], // an edit the device cannot do
    ['create_app', 'only_in_cloud', 'unavailable'],
    ['interpret_sketch', 'only_in_cloud', 'available'], // reading a photo or video
    ['extract_data', 'prefer_on_device', 'unavailable'], // device model not ready, SDK would use the cloud
    ['translate', 'prefer_on_device', 'unavailable'],
    ['verify_ai_block', 'only_in_cloud', 'available'],
  ])('%s with mode %s and device %s: declined means no provider call', async (task, mode, device) => {
    const h = setup({ ask: sayNo, device });
    const res = await h.ai.run(req(mode), { taskType: task });
    expect(res).toMatchObject({ success: false, errorCode: 'consent_denied', errorMessage: AI_COPY.needsCloudOk, source: 'cloud' });
    expect(h.fb.calls).toHaveLength(0);
    expect(h.events.at(-1)).toMatchObject({ success: false, errorCode: 'consent_denied', provider: 'none' });
    expect(noticeDeclined(h.events.at(-1)!)).toBe(true); // the Activity screen tells this apart from "cloud is off"
  });

  it('runs after acceptance', async () => {
    const h = setup({ device: 'unavailable' });
    const res = await h.ai.run(req('only_in_cloud'), { taskType: 'modify_app' });
    expect(res).toMatchObject({ success: true, source: 'cloud' });
    expect(h.ask).toHaveBeenCalledTimes(1);
  });

  it('treats a stopped or throwing screen as "not now"', async () => {
    const boom = setup({ ask: async () => { throw new Error('no screen'); } });
    expect(needsCloudOk(await boom.ai.run(req('only_in_cloud'), { taskType: 'modify_app' }))).toBe(true);
    expect(boom.fb.calls).toHaveLength(0);
  });

  it('reports a cancel instead of a refusal when the person stopped while the notice was open', async () => {
    const c = new AbortController();
    const h = setup({ ask: async () => { c.abort(); return false; } });
    const res = await h.ai.run({ ...req('only_in_cloud'), signal: c.signal }, { taskType: 'modify_app' });
    expect(res.errorCode).toBe('cancelled');
  });
});

describe('asking again', () => {
  it('shares one question between runs that overlap', async () => {
    let release!: (ok: boolean) => void;
    const h = setup({ ask: () => new Promise<boolean>((r) => { release = r; }), device: 'unavailable' });
    const a = h.ai.run(req('only_in_cloud'), { taskType: 'modify_app' });
    const b = h.ai.run(req('only_in_cloud'), { taskType: 'create_app' });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.ask).toHaveBeenCalledTimes(1);
    release(true);
    expect((await Promise.all([a, b])).every((r) => r.success)).toBe(true);
  });

  it('waits out "Not now" for ten minutes, then asks again', async () => {
    const clock = { t: 1_000_000 };
    let answer = false;
    const h = setup({ ask: async () => answer, device: 'unavailable', clock });
    await h.ai.run(req('only_in_cloud'), { taskType: 'modify_app' });
    clock.t += NOTICE_COOLDOWN_MS - 1;
    expect(needsCloudOk(await h.ai.run(req('only_in_cloud'), { taskType: 'modify_app' }))).toBe(true);
    expect(h.ask).toHaveBeenCalledTimes(1);
    clock.t += 2;
    answer = true;
    expect((await h.ai.run(req('only_in_cloud'), { taskType: 'modify_app' })).success).toBe(true);
    expect(h.ask).toHaveBeenCalledTimes(2);
  });
});

describe('nobody to ask', () => {
  it('does not start the ten minute pause when no screen could be asked', async () => {
    const clock = { t: 1_000_000 };
    let answer: boolean | undefined;
    const h = setup({ ask: async () => answer, device: 'unavailable', clock });
    expect(needsCloudOk(await h.ai.run(req('only_in_cloud'), { taskType: 'modify_app' }))).toBe(true);
    clock.t += 1;
    answer = true;
    expect((await h.ai.run(req('only_in_cloud'), { taskType: 'modify_app' })).success).toBe(true);
    expect(h.ask).toHaveBeenCalledTimes(2);
  });
});

describe('task services show the honest sentence', () => {
  const spec = validateSpec(loadFixture('valid', 'expense-tracker')).spec as KalamSpec;
  const refused = { error: 'consent_denied' as const, message: AI_COPY.needsCloudOk };

  it('edit: a structural change that needs the cloud says Kalam needs the OK', async () => {
    const ai = createFakeAI({ onDevice: 'unavailable', respond: () => refused });
    const out = await createEditService({ ai }).applyInstruction(spec, 'Add a new screen to keep track of my suppliers with their phone numbers');
    expect(out).toMatchObject({ ok: false, message: AI_COPY.needsCloudOk });
  });

  it('translate: stops after the refusal instead of asking the cloud a second time', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: () => refused });
    const r = await createTranslateService({ ai, cache: { get: async () => undefined, put: async () => {}, listForApp: async () => [], removeForApp: async () => {} }, onDeviceLanguages: ['en', 'es'] })
      .translateApp(spec, 'es');
    expect(ai.calls.map((c) => c.req.mode)).toEqual(['prefer_on_device']);
    expect(r.ok).toBe(false);
    expect(r.message).toContain(AI_COPY.needsCloudOk);
  });
});
