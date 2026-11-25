import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS, type AICacheRepository, type AIErrorCode, type AIExecutionResult, type AIProvider, type AIProviderName,
  type InferenceEvent, type InferenceMode, type KalamSettings, type OnDeviceStatus, type StructuredRequest, type TaskType,
} from '../contracts';
import { SCHEMA_VERSION } from '../spec/schema';
import { backoffDelay } from './limits';
import { promptVersionFor } from './model-config';
import { createOrchestrator, detectPlatform, type OrchestratorDeps } from './orchestrator';
import { TASK_POLICIES } from './routing';

type Availability = OnDeviceStatus['availability'];

/** Fake provider that mimics the Firebase hybrid SDK's mode semantics and reports token usage. */
function fakeProvider(name: AIProviderName, opts: { device?: Availability; configured?: boolean; script?: Array<AIErrorCode | 'ok' | 'throw'> } = {}) {
  const calls: Array<StructuredRequest<unknown>> = [];
  const script = [...(opts.script ?? [])];
  const provider: AIProvider = {
    name,
    isConfigured: () => opts.configured ?? true,
    onDeviceStatus: async () => ({ platform: 'web', apiExposed: true, availability: opts.device ?? 'available' }),
    async generateStructured<T>(req: StructuredRequest<T>): Promise<AIExecutionResult<T>> {
      calls.push(req as StructuredRequest<unknown>);
      const step = script.shift() ?? 'ok';
      if (step === 'throw') throw new Error('boom');
      const deviceOk = (opts.device ?? 'available') === 'available';
      const source = req.mode === 'only_on_device' || (req.mode === 'prefer_on_device' && deviceOk) ? 'on_device' : 'cloud';
      if (source === 'cloud') req.onUsage?.({ input: 10, output: 5 });
      if (step !== 'ok') return { success: false, provider: name, source, latencyMs: 1, fallbackUsed: false, errorCode: step };
      const parsed = req.parse({ answer: 'yes' });
      if (!parsed.success) throw new Error(parsed.error);
      return { success: true, output: parsed.data, provider: name, source, model: 'm', latencyMs: 1, fallbackUsed: false };
    },
  };
  return { provider, calls };
}

function harness(o: {
  settings?: Partial<KalamSettings>; online?: boolean; device?: Availability; firebaseConfigured?: boolean;
  specialistConfigured?: boolean; firebaseScript?: Array<AIErrorCode | 'ok' | 'throw'>; specialistScript?: Array<AIErrorCode | 'ok' | 'throw'>;
  failEvents?: boolean; firebase?: AIProvider; extra?: Partial<OrchestratorDeps>;
} = {}) {
  const firebase = fakeProvider('firebase', { device: o.device, configured: o.firebaseConfigured, script: o.firebaseScript });
  const specialist = fakeProvider('claude', { configured: o.specialistConfigured ?? true, script: o.specialistScript });
  const events: InferenceEvent[] = [];
  let settings: KalamSettings = { ...DEFAULT_SETTINGS, ...o.settings };
  const ai = createOrchestrator({
    firebase: o.firebase ?? firebase.provider,
    specialist: specialist.provider,
    events: {
      add: async (e) => { if (o.failEvents) throw new Error('db down'); events.push(e); },
      list: async () => events,
      clear: async () => { events.length = 0; },
    },
    settings: { get: async () => settings, update: async (p) => (settings = { ...settings, ...p }) },
    network: { online: () => o.online ?? true, subscribe: () => () => {} },
    retryDelayMs: () => 0,
    ...o.extra,
  });
  return { ai, firebase, specialist, events, settings: () => settings };
}

/** Lets every pending promise chain run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function req(mode: InferenceMode): StructuredRequest<{ answer: string }> {
  return {
    taskType: 'classify', prompt: 'Is milk a grocery?', jsonSchema: { type: 'object' }, mode,
    parse: (raw) => {
      const answer = (raw as { answer?: unknown }).answer;
      return typeof answer === 'string' ? { success: true, data: { answer } } : { success: false, error: 'bad' };
    },
  };
}

const TASKS = Object.keys(TASK_POLICIES) as TaskType[];
const MODES: InferenceMode[] = ['only_on_device', 'prefer_on_device', 'only_in_cloud', 'prefer_in_cloud'];
const CONSENTS: Array<Partial<KalamSettings>> = [
  { aiMode: 'hybrid', allowCloud: true, allowExternalProviders: true },
  { aiMode: 'hybrid', allowCloud: false, allowExternalProviders: true },
  { aiMode: 'offline_only', allowCloud: true, allowExternalProviders: true },
];

describe('routing matrix (task × mode × consent × online × device × complexity × first-call failure)', () => {
  const cases: Array<[TaskType, InferenceMode, Partial<KalamSettings>, boolean, Availability, 'simple' | 'complex', boolean]> = [];
  for (const t of TASKS) for (const m of MODES) for (const c of CONSENTS) for (const online of [true, false]) {
    for (const d of ['available', 'unavailable'] as const) for (const cx of ['simple', 'complex'] as const) {
      for (const firstFails of [false, true]) cases.push([t, m, c, online, d, cx, firstFails]);
    }
  }

  it.each(cases)('%s %s %o online=%s device=%s %s firstFails=%s', async (task, mode, consent, online, device, complexity, firstFails) => {
    const h = harness({ settings: consent, online, device, firebaseScript: firstFails ? ['invalid_output'] : [] });
    const res = await h.ai.run(req(mode), { taskType: task, complexity, escalationReason: complexity === 'complex' ? 'needs deep reasoning' : undefined });
    const cloudOk = consent.aiMode === 'hybrid' && consent.allowCloud === true && online;
    const policy = TASK_POLICIES[task];

    // Consent / connectivity is never violated: without cloud permission no provider sees a cloud-capable mode.
    if (!cloudOk) {
      for (const call of h.firebase.calls) expect(call.mode).toBe('only_on_device');
      expect(h.specialist.calls).toHaveLength(0);
      expect(res.source === 'cloud' && res.success).toBe(false);
    }
    // A caller's only_on_device is never widened.
    if (mode === 'only_on_device') {
      for (const call of h.firebase.calls) expect(call.mode).toBe('only_on_device');
      expect(h.specialist.calls).toHaveLength(0);
    }
    // Nano never receives tasks it is not eligible for.
    if (!policy.onDevice) for (const call of h.firebase.calls) expect(call.mode).toBe('only_in_cloud');
    // Specialists only with explicit justification + consent + eligibility, and never alongside Firebase.
    if (h.specialist.calls.length) {
      expect(policy.specialist && cloudOk && complexity === 'complex').toBe(true);
      expect(h.firebase.calls).toHaveLength(0);
    }
    // Lead decision 2: one Firebase cloud fallback after an on-device failure, only for eligible tasks
    // with cloud allowed; never more than one extra call (no cascades).
    expect(h.firebase.calls.length).toBeLessThanOrEqual(2);
    const fellBack = h.firebase.calls.length === 2
      && h.firebase.calls[0]!.mode === 'prefer_on_device' && h.firebase.calls[1]!.mode === 'only_in_cloud';
    const fallbackAllowed = policy.cloudFallback && cloudOk && device === 'available' && mode === 'prefer_on_device';
    if (firstFails && fallbackAllowed) {
      expect(fellBack).toBe(true);
      expect(res).toMatchObject({ success: true, source: 'cloud', fallbackUsed: true });
      expect(h.events[0]!.escalationReason).toContain('one Firebase cloud fallback');
    } else {
      expect(fellBack).toBe(false);
    }
    // Exactly one event per run, and its success matches the result.
    expect(h.events).toHaveLength(1);
    expect(h.events[0]!.success).toBe(res.success);
    expect(res.eventId).toBe(h.events[0]!.id);
  });
});

describe('orchestrator', () => {
  it('sends cloud-only tasks to Firebase in only_in_cloud mode with the task role', async () => {
    const h = harness();
    const res = await h.ai.run(req('prefer_on_device'), { taskType: 'create_app', complexity: 'complex' });
    expect(res).toMatchObject({ success: true, provider: 'firebase', source: 'cloud', fallbackUsed: true });
    expect(h.firebase.calls[0]).toMatchObject({ mode: 'only_in_cloud', role: 'compiler' });
    expect(h.events[0]).toMatchObject({ route: 'cloud', escalationReason: expect.stringContaining('task requires cloud reasoning') });
  });

  it('fails fast offline for cloud-only tasks without calling any provider', async () => {
    const h = harness({ online: false });
    const res = await h.ai.run(req('only_in_cloud'), { taskType: 'create_app' });
    expect(res).toMatchObject({ success: false, provider: 'none', errorCode: 'offline' });
    expect(h.firebase.calls).toHaveLength(0);
    expect(h.events[0]).toMatchObject({ success: false, provider: 'none', errorCode: 'offline' });
  });

  it('clamps to only_on_device offline and counts user-facing on-device actions', async () => {
    const h = harness({ online: false });
    const res = await h.ai.run(req('prefer_in_cloud'), { taskType: 'classify' });
    expect(res).toMatchObject({ success: true, source: 'on_device', fallbackUsed: true, output: { answer: 'yes' } });
    expect(h.firebase.calls[0]!.mode).toBe('only_on_device');
    expect(h.settings().onDeviceActionCount).toBe(1);
  });

  it('reports offline when neither cloud nor device can serve', async () => {
    const h = harness({ online: false, device: 'downloadable' });
    const res = await h.ai.run(req('prefer_on_device'), { taskType: 'voice_action' });
    expect(res).toMatchObject({ success: false, errorCode: 'offline' });
    expect(h.firebase.calls).toHaveLength(0);
  });

  it('reports consent_denied when cloud is off and Nano is not ready', async () => {
    const h = harness({ settings: { allowCloud: false }, device: 'unavailable' });
    expect((await h.ai.run(req('prefer_on_device'), { taskType: 'translate' })).errorCode).toBe('consent_denied');
    const h2 = harness({ settings: { allowCloud: false } });
    expect((await h2.ai.run(req('only_in_cloud'), { taskType: 'safety_review' })).errorCode).toBe('consent_denied');
  });

  it('marks hybrid SDK fallback when the device model is not available', async () => {
    const h = harness({ device: 'downloadable' });
    const res = await h.ai.run(req('prefer_on_device'), { taskType: 'summarize' });
    expect(res).toMatchObject({ success: true, source: 'cloud', fallbackUsed: true });
    expect(h.events[0]!.escalationReason).toContain('hybrid fallback to cloud');
    expect(h.settings().onDeviceActionCount).toBe(0);
  });

  it('respects only_on_device when the model is not ready', async () => {
    const h = harness({ device: 'downloading' });
    const res = await h.ai.run(req('only_on_device'), { taskType: 'extract_data' });
    expect(res).toMatchObject({ success: false, errorCode: 'model_unavailable' });
    expect(h.firebase.calls).toHaveLength(0);
  });

  it('returns not_configured when Firebase is missing', async () => {
    const h = harness({ firebaseConfigured: false });
    expect((await h.ai.run(req('only_in_cloud'), { taskType: 'repair_spec' })).errorCode).toBe('not_configured');
  });

  it('uses a specialist only with justification + external consent, and never cascades on failure', async () => {
    const noConsent = harness({ settings: { allowExternalProviders: false } });
    await noConsent.ai.run(req('only_in_cloud'), { taskType: 'plan_app', escalationReason: 'multi-role workflow' });
    expect(noConsent.specialist.calls).toHaveLength(0);
    expect(noConsent.firebase.calls).toHaveLength(1);

    // A rate-limited specialist is retried on the specialist only, never handed to Firebase.
    const h = harness({ settings: { allowExternalProviders: true }, specialistScript: ['quota', 'quota', 'quota'] });
    const res = await h.ai.run(req('only_in_cloud'), { taskType: 'plan_app', escalationReason: 'multi-role workflow' });
    expect(res).toMatchObject({ success: false, provider: 'claude', errorCode: 'quota' });
    expect(h.specialist.calls).toHaveLength(3);
    expect(h.firebase.calls).toHaveLength(0);
    expect(h.events[0]).toMatchObject({ route: 'specialist', escalationReason: expect.stringContaining('multi-role workflow'), retries: 2 });
  });

  // docs/04 §11.9 and docs/11 §16.1: rate limits (429), service errors (503) and network drops get
  // exponential backoff with jitter and a bounded retry count. This replaced the single retry (wave 5, C1).
  it('retries 429, 5xx and network failures at most twice on the same provider and leg', async () => {
    const h = harness({ firebaseScript: ['provider_error', 'provider_error', 'ok'] });
    const res = await h.ai.run(req('only_in_cloud'), { taskType: 'create_app' });
    expect(res.success).toBe(true);
    expect(h.firebase.calls.map((c) => c.mode)).toEqual(['only_in_cloud', 'only_in_cloud', 'only_in_cloud']);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ retries: 2, escalationReason: expect.stringContaining('retried 2 times after provider_error') });

    for (const code of ['quota', 'provider_error', 'offline'] as const) {
      const g = harness({ firebaseScript: [code, code, code, 'ok'] });
      expect((await g.ai.run(req('only_in_cloud'), { taskType: 'create_app' })).errorCode).toBe(code);
      expect(g.firebase.calls).toHaveLength(3);
    }
  });

  it('retries a timeout once, because it already used its whole time budget', async () => {
    const ok = harness({ firebaseScript: ['timeout', 'ok'] });
    expect((await ok.ai.run(req('only_in_cloud'), { taskType: 'create_app' })).success).toBe(true);
    expect(ok.events[0]!.escalationReason).toContain('retried once after timeout');
    const twice = harness({ firebaseScript: ['timeout', 'timeout', 'ok'] });
    expect((await twice.ai.run(req('only_in_cloud'), { taskType: 'create_app' })).errorCode).toBe('timeout');
    expect(twice.firebase.calls).toHaveLength(2);
  });

  it('never retries bad output, consent, configuration, App Check, a bad request or a cancel', async () => {
    const final: AIErrorCode[] = [
      'invalid_output', 'app_check_failed', 'bad_request', 'not_configured', 'consent_denied', 'model_unavailable',
      'unsupported_modality', 'cancelled',
    ];
    for (const code of final) {
      const h = harness({ firebaseScript: [code] });
      expect((await h.ai.run(req('only_in_cloud'), { taskType: 'create_app' })).errorCode).toBe(code);
      expect(h.firebase.calls).toHaveLength(1);
    }
  });

  it('turns a throwing provider into a recorded failure', async () => {
    const h = harness({ firebaseScript: ['throw', 'throw', 'throw'] });
    const res = await h.ai.run(req('only_in_cloud'), { taskType: 'create_app' });
    expect(res).toMatchObject({ success: false, errorCode: 'provider_error', errorMessage: 'boom' });
    expect(h.events[0]!.success).toBe(false);
  });

  it('never fails a run because event storage failed, and never mutates the request', async () => {
    const h = harness({ failEvents: true });
    const r = req('prefer_on_device');
    const res = await h.ai.run(r, { taskType: 'classify' });
    expect(res.success).toBe(true);
    expect(r.mode).toBe('prefer_on_device');
    expect(r.role).toBeUndefined();
  });

  it('records deterministic decisions and reports status', async () => {
    const h = harness({ online: false, specialistConfigured: false });
    await h.ai.recordDeterministic({ taskId: 't', taskType: 'create_app', route: 'template', latencyMs: 3, success: true });
    expect(h.events[0]).toMatchObject({ provider: 'deterministic', source: 'deterministic', route: 'template', fallbackUsed: false });
    expect(await h.ai.status()).toMatchObject({ cloudConfigured: true, online: false, specialistConfigured: false, onDevice: { availability: 'available' } });
  });
});

describe('status time-box and warm-up', () => {
  const base = {
    name: 'firebase' as const, isConfigured: () => true,
    generateStructured: async () => ({ success: false, provider: 'firebase' as const, source: 'cloud' as const, latencyMs: 0, fallbackUsed: false }),
  };
  const deps = (firebase: AIProvider) => ({
    firebase,
    specialist: { ...base, name: 'claude' as const, isConfigured: () => false, onDeviceStatus: async () => ({ platform: 'web' as const, apiExposed: false, availability: 'unavailable' as const }) },
    events: { add: async () => {}, list: async () => [], clear: async () => {} },
    settings: { get: async () => DEFAULT_SETTINGS, update: async () => DEFAULT_SETTINGS },
    network: { online: () => true, subscribe: () => () => {} },
    statusBudgetMs: 30,
  });

  it('reports `unknown` instead of hanging when the availability check never answers', async () => {
    const ai = createOrchestrator(deps({ ...base, onDeviceStatus: () => new Promise<OnDeviceStatus>(() => {}) }));
    const t0 = Date.now();
    const s = await ai.status();
    expect(Date.now() - t0).toBeLessThan(500);
    expect(s.onDevice.availability).toBe('unknown');
    expect(s.cloudConfigured).toBe(true);
  });

  it('a slow status check still names the platform it runs on (iOS, never "other")', async () => {
    const ai = createOrchestrator({ ...deps({ ...base, onDeviceStatus: () => new Promise<OnDeviceStatus>(() => {}) }), platform: 'ios' });
    expect((await ai.status()).onDevice).toMatchObject({ platform: 'ios', availability: 'unknown' });
  });

  it('warmUpOnDevice delegates to the provider and never throws', async () => {
    let warmed = 0;
    const ok = createOrchestrator(deps({
      ...base, onDeviceStatus: async () => ({ platform: 'web', apiExposed: true, availability: 'available', warm: false }),
      warmUpOnDevice: async () => { warmed += 1; return { platform: 'web', apiExposed: true, availability: 'available', warm: true }; },
    }));
    expect(await ok.warmUpOnDevice()).toMatchObject({ availability: 'available', warm: true });
    expect(warmed).toBe(1);

    const broken = createOrchestrator(deps({
      ...base, onDeviceStatus: async () => ({ platform: 'web', apiExposed: true, availability: 'available' }),
      warmUpOnDevice: async () => { throw new Error('no memory'); },
    }));
    expect((await broken.warmUpOnDevice()).availability).toBe('unknown');

    const noWarm = createOrchestrator(deps({ ...base, onDeviceStatus: async () => ({ platform: 'android', apiExposed: false, availability: 'unavailable' }) }));
    expect((await noWarm.warmUpOnDevice()).availability).toBe('unavailable');
  });
});

describe('one Firebase cloud fallback after an on-device failure (lead decision 2)', () => {
  it('falls back once for eligible tasks, records it, and never cascades', async () => {
    const h = harness({ firebaseScript: ['timeout', 'provider_error', 'ok'] });
    const res = await h.ai.run(req('prefer_on_device'), { taskType: 'classify' });
    expect(res).toMatchObject({ success: false, errorCode: 'provider_error', source: 'cloud' });
    expect(h.firebase.calls.map((c) => c.mode)).toEqual(['prefer_on_device', 'only_in_cloud']);
    expect(h.events[0]).toMatchObject({ success: false, escalationReason: expect.stringContaining('on-device failed (timeout)') });
  });

  it('never falls back for template parameters, only_on_device or cancelled runs', async () => {
    const tpl = harness({ firebaseScript: ['invalid_output'] });
    await tpl.ai.run(req('prefer_on_device'), { taskType: 'extract_template_params' });
    expect(tpl.firebase.calls).toHaveLength(1);

    const strict = harness({ firebaseScript: ['invalid_output'] });
    await strict.ai.run(req('only_on_device'), { taskType: 'voice_action' });
    expect(strict.firebase.calls).toHaveLength(1);

    const cancelled = harness({ firebaseScript: ['cancelled'] });
    await cancelled.ai.run(req('prefer_on_device'), { taskType: 'summarize' });
    expect(cancelled.firebase.calls).toHaveLength(1);
  });

  it('does not fall back when cloud is not allowed', async () => {
    for (const settings of [{ allowCloud: false }, { aiMode: 'offline_only' as const }]) {
      const h = harness({ settings, firebaseScript: ['invalid_output'] });
      const res = await h.ai.run(req('prefer_on_device'), { taskType: 'translate' });
      expect(res.success).toBe(false);
      expect(h.firebase.calls.map((c) => c.mode)).toEqual(['only_on_device']);
    }
    const offline = harness({ online: false, firebaseScript: ['invalid_output'] });
    await offline.ai.run(req('prefer_on_device'), { taskType: 'voice_action' });
    expect(offline.firebase.calls.map((c) => c.mode)).toEqual(['only_on_device']);
  });
});

describe('event detail', () => {
  it('records classification, retries and a jittered wait before the one retry', async () => {
    const h = harness({ firebaseScript: ['timeout', 'ok'] });
    await h.ai.run(req('only_in_cloud'), { taskType: 'create_app', classification: { method: 'deterministic', confidence: 0.88 } });
    expect(h.events[0]).toMatchObject({ classificationMethod: 'deterministic', classificationConfidence: 0.88, retries: 1, success: true });
    const once = harness();
    await once.ai.run(req('only_in_cloud'), { taskType: 'create_app' });
    expect(once.events[0]!.retries).toBe(0);
  });

  it('records prompt and schema versions, platform, tokens, retries and cache hit (docs/04 §20.2, docs/07 §16.4)', async () => {
    const h = harness({ extra: { platform: 'web' } });
    await h.ai.run(req('only_in_cloud'), { taskType: 'create_app', classification: { method: 'on_device', confidence: 0.6 } });
    expect(h.events[0]).toMatchObject({
      promptVersion: promptVersionFor('compiler'), schemaVersion: SCHEMA_VERSION, platform: 'web',
      tokens: { input: 10, output: 5 }, retries: 0, cacheHit: false, classificationMethod: 'on_device', classificationConfidence: 0.6,
    });
    // A run that never reached a model carries the same fields.
    const off = harness({ online: false, device: 'unavailable', extra: { platform: 'android' } });
    await off.ai.run(req('only_in_cloud'), { taskType: 'summarize' });
    expect(off.events[0]).toMatchObject({
      promptVersion: promptVersionFor('ai_block'), schemaVersion: SCHEMA_VERSION, platform: 'android', success: false, errorCode: 'offline',
    });
    expect(off.events[0]!.tokens).toBeUndefined();
  });

  it('uses the role the request names for the prompt version', async () => {
    const h = harness();
    await h.ai.run({ ...req('only_in_cloud'), role: 'judge' }, { taskType: 'verify_ai_block' });
    expect(h.events[0]!.promptVersion).toBe(promptVersionFor('judge'));
  });

  it("adds up token counts over retries and still calls the caller's own onUsage", async () => {
    const seen: Array<{ input?: number; output?: number }> = [];
    const h = harness({ firebaseScript: ['provider_error', 'ok'] });
    await h.ai.run({ ...req('only_in_cloud'), onUsage: (u) => seen.push(u) }, { taskType: 'create_app' });
    expect(h.events[0]!.tokens).toEqual({ input: 20, output: 10 });
    expect(seen).toHaveLength(2);
  });

  it('marks template decisions with the platform and schema version', async () => {
    const h = harness({ extra: { platform: 'web' } });
    await h.ai.recordDeterministic({ taskId: 't', taskType: 'create_app', route: 'template', latencyMs: 1, success: true });
    expect(h.events[0]).toMatchObject({ platform: 'web', schemaVersion: SCHEMA_VERSION, source: 'deterministic' });
  });

  it('detects the platform from the runtime (Node here)', () => {
    expect(detectPlatform()).toBe('other');
  });
});

describe('backoff and the client token bucket', () => {
  it('waits with exponential backoff and full jitter before each retry', async () => {
    vi.useFakeTimers();
    try {
      // random() = 1 gives the ceiling of each jitter window: 500 ms, then 1000 ms.
      const h = harness({ firebaseScript: ['provider_error', 'quota', 'ok'], extra: { retryDelayMs: (a) => backoffDelay(a, () => 1) } });
      const pending = h.ai.run(req('only_in_cloud'), { taskType: 'create_app' });
      await vi.advanceTimersByTimeAsync(499);
      expect(h.firebase.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.firebase.calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(999);
      expect(h.firebase.calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.firebase.calls).toHaveLength(3);
      expect(await pending).toMatchObject({ success: true });
      expect(h.events[0]).toMatchObject({ retries: 2, escalationReason: expect.stringContaining('retried 2 times after provider_error, quota') });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops retrying when the caller cancels during the backoff wait', async () => {
    const ac = new AbortController();
    const h = harness({ firebaseScript: ['provider_error', 'ok'], extra: { retryDelayMs: () => 60_000 } });
    const pending = h.ai.run({ ...req('only_in_cloud'), signal: ac.signal }, { taskType: 'create_app' });
    await settle();
    ac.abort();
    expect(await pending).toMatchObject({ success: false, errorCode: 'cancelled' });
    await settle();
    expect(h.firebase.calls).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ success: false, errorCode: 'cancelled' });
  });

  it('stops a burst of cloud calls for one task before it reaches the provider, and records it', async () => {
    const h = harness();
    for (let i = 0; i < 6; i++) expect((await h.ai.run(req('only_in_cloud'), { taskType: 'create_app' })).success).toBe(true);
    const limited = await h.ai.run(req('only_in_cloud'), { taskType: 'create_app' });
    expect(limited).toMatchObject({ success: false, errorCode: 'quota', provider: 'none' });
    expect(limited.errorMessage).toMatch(/wait a minute/i);
    expect(h.firebase.calls).toHaveLength(6);
    expect(h.events.at(-1)).toMatchObject({ success: false, errorCode: 'quota', escalationReason: 'client rate limit reached' });
    // Each task has its own bucket.
    expect((await h.ai.run(req('only_in_cloud'), { taskType: 'plan_app' })).success).toBe(true);
  });

  it('does not spend cloud tokens on runs the device will serve, and can be turned off', async () => {
    const device = harness();
    for (let i = 0; i < 25; i++) {
      await device.ai.run({ ...req('prefer_on_device'), prompt: `note ${i}` }, { taskType: 'classify' });
    }
    expect(device.firebase.calls).toHaveLength(25);

    const off = harness({ extra: { rateLimit: false } });
    for (let i = 0; i < 8; i++) expect((await off.ai.run(req('only_in_cloud'), { taskType: 'create_app' })).success).toBe(true);
  });
});

/** A provider that answers only when released, or reports cancelled when its signal aborts. */
function slowProvider() {
  const calls: Array<StructuredRequest<unknown>> = [];
  const releases: Array<() => void> = [];
  const provider: AIProvider = {
    name: 'firebase',
    isConfigured: () => true,
    onDeviceStatus: async () => ({ platform: 'web', apiExposed: true, availability: 'available' }),
    async generateStructured<T>(r: StructuredRequest<T>): Promise<AIExecutionResult<T>> {
      calls.push(r as StructuredRequest<unknown>);
      await new Promise<void>((resolve) => {
        releases.push(resolve);
        r.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      if (r.signal?.aborted) return { success: false, provider: 'firebase', source: 'cloud', latencyMs: 1, fallbackUsed: false, errorCode: 'cancelled' };
      const parsed = r.parse({ answer: 'yes' });
      return { success: true, output: parsed.success ? parsed.data : undefined, provider: 'firebase', source: 'cloud', model: 'm', latencyMs: 1, fallbackUsed: false };
    },
  };
  return { provider, calls, release: () => releases.splice(0).forEach((r) => r()) };
}

describe('request de-duplication (docs/07 §16.2, docs/17 §6.1)', () => {
  it('shares one call between identical requests in flight, and keeps different apps apart', async () => {
    const h = harness();
    const [a, b, other] = await Promise.all([
      h.ai.run(req('only_in_cloud'), { taskType: 'create_app', appId: 'x' }),
      h.ai.run(req('only_in_cloud'), { taskType: 'create_app', appId: 'x' }),
      h.ai.run(req('only_in_cloud'), { taskType: 'create_app', appId: 'y' }),
    ]);
    expect(h.firebase.calls).toHaveLength(2);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(other.success).toBe(true);
    expect(h.events).toHaveLength(2);
  });

  it('does not share between different modes or roles', async () => {
    const h = harness();
    await Promise.all([
      h.ai.run(req('only_in_cloud'), { taskType: 'create_app' }),
      h.ai.run(req('prefer_in_cloud'), { taskType: 'create_app' }),
      h.ai.run({ ...req('only_in_cloud'), role: 'repair' }, { taskType: 'create_app' }),
    ]);
    expect(h.firebase.calls).toHaveLength(3);
  });

  it('one caller cancelling leaves the shared call running; all cancelling stops it', async () => {
    const slow = slowProvider();
    const h = harness({ firebase: slow.provider });
    const a = new AbortController();
    const b = new AbortController();
    const pa = h.ai.run({ ...req('only_in_cloud'), signal: a.signal }, { taskType: 'create_app' });
    const pb = h.ai.run({ ...req('only_in_cloud'), signal: b.signal }, { taskType: 'create_app' });
    await settle();
    expect(slow.calls).toHaveLength(1);
    a.abort();
    expect(await pa).toMatchObject({ success: false, errorCode: 'cancelled' });
    expect(slow.calls[0]!.signal?.aborted).toBe(false);
    slow.release();
    expect(await pb).toMatchObject({ success: true });

    const c = new AbortController();
    const d = new AbortController();
    const pc = h.ai.run({ ...req('only_in_cloud'), signal: c.signal }, { taskType: 'create_app' });
    const pd = h.ai.run({ ...req('only_in_cloud'), signal: d.signal }, { taskType: 'create_app' });
    await settle();
    expect(slow.calls).toHaveLength(2);
    c.abort();
    d.abort();
    expect(await pc).toMatchObject({ errorCode: 'cancelled' });
    expect(await pd).toMatchObject({ errorCode: 'cancelled' });
    expect(slow.calls[1]!.signal?.aborted).toBe(true);
    await settle();
    expect(h.events.at(-1)).toMatchObject({ success: false, errorCode: 'cancelled' });
  });

  it('a request made after everyone cancelled starts a fresh call (React strict-mode effects)', async () => {
    const slow = slowProvider();
    const h = harness({ firebase: slow.provider });
    const first = new AbortController();
    const p1 = h.ai.run({ ...req('only_in_cloud'), signal: first.signal }, { taskType: 'create_app' });
    first.abort();
    const p2 = h.ai.run(req('only_in_cloud'), { taskType: 'create_app' });
    await settle();
    slow.release();
    expect(await p1).toMatchObject({ errorCode: 'cancelled' });
    expect(await p2).toMatchObject({ success: true });
  });
});

/** In-memory stand-in for db.aiCache. */
function memoryStore(): AICacheRepository & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async (key, value) => { data.set(key, value); },
    clear: async () => data.clear(),
    size: async () => data.size,
  };
}

describe('answer reuse (docs/07 §16.2, docs/00 §29)', () => {
  it('reuses the answer to an identical safe-to-repeat request and records the cache hit', async () => {
    const h = harness();
    const first = await h.ai.run(req('prefer_on_device'), { taskType: 'classify', appId: 'a1' });
    const again = await h.ai.run(req('prefer_on_device'), { taskType: 'classify', appId: 'a1' });
    expect(h.firebase.calls).toHaveLength(1);
    expect(again).toMatchObject({ success: true, output: first.output, source: first.source, model: first.model, fallbackUsed: false });
    expect(again.eventId).not.toBe(first.eventId);
    expect(h.events.map((e) => e.cacheHit)).toEqual([false, true]);
    expect(h.events[1]).toMatchObject({ success: true, retries: 0, promptVersion: promptVersionFor('local_assistant') });
    expect(h.settings().onDeviceActionCount).toBe(1); // a reused answer is not a new on-device action
  });

  it('never reuses across apps, for only_on_device requests, for failures or for generation tasks', async () => {
    const h = harness({ firebaseScript: ['invalid_output'] });
    await h.ai.run(req('prefer_in_cloud'), { taskType: 'summarize', appId: 'a' }); // fails: not stored
    await h.ai.run(req('prefer_in_cloud'), { taskType: 'summarize', appId: 'a' });
    await h.ai.run(req('prefer_in_cloud'), { taskType: 'summarize', appId: 'b' });
    await h.ai.run(req('only_on_device'), { taskType: 'summarize', appId: 'a' });
    await h.ai.run(req('only_on_device'), { taskType: 'summarize', appId: 'a' });
    await h.ai.run(req('only_in_cloud'), { taskType: 'create_app', appId: 'a' });
    await h.ai.run(req('only_in_cloud'), { taskType: 'create_app', appId: 'a' });
    expect(h.firebase.calls).toHaveLength(7);
    expect(h.events.some((e) => e.cacheHit)).toBe(false);
  });

  it('checks a stored answer with the caller parser again and treats a mismatch as a miss', async () => {
    const h = harness();
    const old: StructuredRequest<{ answer: string }> = { ...req('prefer_on_device'), parse: () => ({ success: true, data: { answer: 'old' } }) };
    await h.ai.run(old, { taskType: 'translate' });
    const current: StructuredRequest<{ answer: string }> = {
      ...req('prefer_on_device'),
      parse: (raw) => ((raw as { answer?: unknown }).answer === 'yes' ? { success: true, data: { answer: 'yes' } } : { success: false, error: 'old shape' }),
    };
    const res = await h.ai.run(current, { taskType: 'translate' });
    expect(h.firebase.calls).toHaveLength(2);
    expect(res).toMatchObject({ success: true, output: { answer: 'yes' } });
    expect(h.events.some((e) => e.cacheHit)).toBe(false);
  });

  it('persists answers through db.aiCache and reads them back in a later session', async () => {
    const store = memoryStore();
    const one = harness({ extra: { aiCache: store } });
    await one.ai.run(req('prefer_on_device'), { taskType: 'extract_data', appId: 'a' });
    await settle();
    expect(store.data.size).toBe(1);
    const two = harness({ extra: { aiCache: store } });
    const res = await two.ai.run(req('prefer_on_device'), { taskType: 'extract_data', appId: 'a' });
    expect(res).toMatchObject({ success: true, output: { answer: 'yes' } });
    expect(two.firebase.calls).toHaveLength(0);
    expect(two.events[0]).toMatchObject({ cacheHit: true });
  });

  it('cacheResults: false always reaches the model', async () => {
    const h = harness({ extra: { cacheResults: false } });
    await h.ai.run(req('prefer_on_device'), { taskType: 'classify' });
    await h.ai.run(req('prefer_on_device'), { taskType: 'classify' });
    expect(h.firebase.calls).toHaveLength(2);
  });
});

describe('capability registry in routing (docs/07 §14.6)', () => {
  const png = { mimeType: 'image/png' as const, base64: 'AAAA' };

  it('on Android, images never go to the on-device model', async () => {
    const h = harness({ extra: { platform: 'android' } });
    const res = await h.ai.run({ ...req('prefer_on_device'), images: [png] }, { taskType: 'extract_data' });
    expect(res.success).toBe(true);
    expect(h.firebase.calls.map((c) => c.mode)).toEqual(['only_in_cloud']);
    expect(h.events[0]!.escalationReason).toContain('on-device model lacks image_input');

    const strict = harness({ extra: { platform: 'android' } });
    const r = await strict.ai.run({ ...req('only_on_device'), images: [png] }, { taskType: 'extract_data' });
    expect(r).toMatchObject({ success: false, errorCode: 'unsupported_modality' });
    expect(r.errorMessage).toMatch(/cannot handle images/);
    expect(strict.firebase.calls).toHaveLength(0);

    const offline = harness({ online: false, extra: { platform: 'android' } });
    const o = await offline.ai.run({ ...req('prefer_on_device'), images: [png] }, { taskType: 'extract_data' });
    expect(o).toMatchObject({ success: false, errorCode: 'offline' });
    expect(o.errorMessage).toMatch(/cannot handle images/);
  });

  it('keeps routing unchanged where the registry allows the input', async () => {
    const android = harness({ extra: { platform: 'android' } });
    await android.ai.run(req('prefer_on_device'), { taskType: 'classify' });
    expect(android.firebase.calls[0]!.mode).toBe('prefer_on_device');
    const web = harness({ extra: { platform: 'web' } });
    await web.ai.run({ ...req('prefer_on_device'), images: [png] }, { taskType: 'extract_data' });
    expect(web.firebase.calls[0]!.mode).toBe('prefer_on_device');
  });
});
