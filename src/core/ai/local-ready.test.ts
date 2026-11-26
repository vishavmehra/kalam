import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, type AIExecutionResult, type AIProvider, type KalamSettings, type StructuredRequest, type TaskType,
} from '../contracts';
import {
  evaluateGate, LOCAL_EVIDENCE, LOCAL_GATES, LOCAL_TASKS, localBenchmarkSchema, localStatus, localTaskFor, type LocalBenchmark,
} from './local-ready';
import { createOrchestrator } from './orchestrator';
import { onDeviceEligible, planRoute, TASK_POLICIES, type RouteInput } from './routing';

const good: LocalBenchmark = {
  task: 'classify', platform: 'web', model: 'gemini-nano, Chrome 157', date: '2026-11-26', cases: 80, schemaValid: 79, correct: 70,
  hallucinated: 1, p95LatencyMs: 3000, offlineOk: true, evidence: 'docs/evidence/local-ready-classify-web-2026-11-26.json',
};

describe('evaluateGate (docs/07 §6.7, §20.4)', () => {
  it('is ready only when every threshold is met and the offline run was checked', () => {
    expect(evaluateGate(good)).toEqual({ status: 'ready', reasons: [] });
  });

  it('fails on a measured miss and says which one', () => {
    expect(evaluateGate({ ...good, schemaValid: 70 })).toMatchObject({ status: 'failed', reasons: [expect.stringMatching(/schema-valid/)] });
    expect(evaluateGate({ ...good, correct: 40 }).reasons.join()).toMatch(/correct 50%/);
    expect(evaluateGate({ ...good, hallucinated: 20 }).reasons.join()).toMatch(/invented/);
    expect(evaluateGate({ ...good, p95LatencyMs: 9000 }).reasons.join()).toMatch(/p95/);
    expect(evaluateGate({ ...good, offlineOk: false })).toMatchObject({ status: 'failed', reasons: ['did not work offline'] });
  });

  it('is unproven, never ready, with too few cases or no offline run', () => {
    expect(evaluateGate({ ...good, cases: 10, schemaValid: 10, correct: 10 }).status).toBe('unproven');
    const { offlineOk: _unused, ...unchecked } = good;
    expect(evaluateGate(unchecked)).toEqual({ status: 'unproven', reasons: ['offline run not checked'] });
  });

  it('holds a small edit to the highest bar', () => {
    const patch: LocalBenchmark = { ...good, task: 'generate_patch', correct: 74, hallucinated: 3 };
    expect(evaluateGate(patch).status).toBe('failed'); // 92.5% correct, 3.75% unrelated changes
    expect(LOCAL_GATES.generate_patch.accuracy).toBeGreaterThan(LOCAL_GATES.classify.accuracy);
  });

  it('rejects a record whose counts do not add up', () => {
    expect(localBenchmarkSchema.safeParse({ ...good, correct: 100 }).success).toBe(false);
  });
});

describe('localStatus', () => {
  it('is unproven for every task and platform with no recorded run', () => {
    for (const t of LOCAL_TASKS) expect(localStatus(t, 'web', [])).toBe('unproven');
    for (const t of LOCAL_TASKS) for (const p of ['android', 'ios'] as const) expect(localStatus(t, p)).toBe('unproven');
  });

  it('reads the recorded Chrome runs of 2026-11-26 (D07-031): one task ready, three below their gate, the rest not benchmarked', () => {
    expect(Object.fromEntries(LOCAL_TASKS.map((t) => [t, localStatus(t, 'web')]))).toEqual({
      classify: 'failed', summarize: 'failed', translate: 'failed', voice_action: 'ready',
      generate_patch: 'unproven', extract_data: 'unproven', extract_template_params: 'unproven', create_simple_app: 'unproven',
    });
    // Every record names a raw run on disk, and the run was made offline.
    for (const r of LOCAL_EVIDENCE) {
      expect(r.offlineOk).toBe(true);
      expect(existsSync(join(__dirname, '..', '..', '..', r.evidence)), r.evidence).toBe(true);
    }
  });

  it('uses the newest record for that task and platform', () => {
    const older = { ...good, date: '2026-11-20', correct: 10 };
    expect(localStatus('classify', 'web', [older, good])).toBe('ready');
    expect(localStatus('classify', 'web', [good, older, { ...good, date: '2026-12-01', schemaValid: 5, correct: 5 }])).toBe('failed');
    expect(localStatus('classify', 'android', [good])).toBe('unproven');
    expect(localStatus('summarize', 'web', [good])).toBe('unproven');
  });

  it('only ships records that parse and verdicts that come from their numbers', () => {
    for (const r of LOCAL_EVIDENCE) expect(localBenchmarkSchema.safeParse(r).success).toBe(true);
  });

  it('maps a task run to its gate key', () => {
    expect(localTaskFor('create_app', 'simple')).toBe('create_simple_app');
    expect(localTaskFor('create_app', 'medium')).toBeUndefined();
    expect(localTaskFor('classify')).toBe('classify');
    expect(localTaskFor('repair_spec')).toBeUndefined();
  });
});

describe('routing with the gate', () => {
  const route = (over: Partial<RouteInput>): ReturnType<typeof planRoute> => planRoute({
    taskType: 'classify', requestedMode: 'prefer_on_device', settings: { aiMode: 'hybrid', allowCloud: true, allowExternalProviders: false },
    online: true, firebaseConfigured: true, specialistConfigured: false, onDevice: 'available', ...over,
  });

  it('keeps the device for a task whose benchmark is unproven or passed, drops it when failed', () => {
    for (const localReady of [undefined, 'unproven', 'ready'] as const) {
      expect(route({ localReady })).toEqual({ kind: 'firebase', mode: 'prefer_on_device' });
    }
    expect(route({ localReady: 'failed' })).toMatchObject({ kind: 'firebase', mode: 'only_in_cloud', note: expect.stringMatching(/benchmark/) });
    expect(onDeviceEligible('classify', undefined, 'failed')).toBe(false);
  });

  it('honours only_on_device by refusing, and offline by refusing, when the benchmark failed', () => {
    expect(route({ localReady: 'failed', requestedMode: 'only_on_device' })).toMatchObject({ kind: 'fail', code: 'model_unavailable' });
    expect(route({ localReady: 'failed', online: false })).toMatchObject({ kind: 'fail', code: 'offline' });
  });

  it('tries the device first for a simple app only after its benchmark passed', () => {
    const base = { taskType: 'create_app' as const, complexity: 'simple' as const };
    expect(route({ ...base })).toMatchObject({ mode: 'only_in_cloud' });
    expect(route({ ...base, localReady: 'unproven' })).toMatchObject({ mode: 'only_in_cloud' });
    expect(route({ ...base, localReady: 'ready' })).toEqual({ kind: 'firebase', mode: 'prefer_on_device' });
    expect(route({ ...base, complexity: 'medium', localReady: 'ready' })).toMatchObject({ mode: 'only_in_cloud' });
    expect(route({ ...base, localReady: 'ready', online: false })).toMatchObject({ kind: 'firebase', mode: 'only_on_device' });
    expect(route({ ...base, localReady: 'ready', requestedMode: 'only_in_cloud' })).toMatchObject({ mode: 'only_in_cloud' });
  });

  it('only marks create_app as gated', () => {
    const gated = (Object.keys(TASK_POLICIES) as TaskType[]).filter((t) => TASK_POLICIES[t].localWhenReady);
    expect(gated).toEqual(['create_app']);
  });
});

describe('orchestrator with the gate', () => {
  function build(localReady: 'ready' | 'unproven' | 'failed', device: 'available' | 'unavailable' = 'available') {
    const seen: Array<{ mode: string; onDevice: boolean }> = [];
    const provider = (name: 'firebase' | 'claude'): AIProvider => ({
      name,
      isConfigured: () => true,
      onDeviceStatus: async () => ({ platform: 'web', apiExposed: true, availability: device }),
      async generateStructured<T>(req: StructuredRequest<T>): Promise<AIExecutionResult<T>> {
        const onDevice = req.mode === 'only_on_device' || (req.mode === 'prefer_on_device' && device === 'available');
        seen.push({ mode: req.mode, onDevice });
        const parsed = req.parse({ answer: 'yes' });
        if (!parsed.success) throw new Error(parsed.error);
        return { success: true, output: parsed.data, provider: name, source: onDevice ? 'on_device' : 'cloud', latencyMs: 1, fallbackUsed: false };
      },
    });
    const settings: KalamSettings = { ...DEFAULT_SETTINGS };
    const ai = createOrchestrator({
      firebase: provider('firebase'), specialist: provider('claude'),
      events: { add: async () => {}, list: async () => [], clear: async () => {} },
      settings: { get: async () => settings, update: async () => settings },
      network: { online: () => true, subscribe: () => () => {} },
      platform: 'web', rateLimit: false, cacheResults: false, retryDelayMs: () => 0, localReady: () => localReady,
    });
    return { ai, seen };
  }
  const request = (taskType: TaskType, mode: StructuredRequest<unknown>['mode']): StructuredRequest<{ answer: string }> => ({
    taskType, prompt: 'x', jsonSchema: { type: 'object' }, mode,
    parse: (raw) => (typeof (raw as { answer?: unknown }).answer === 'string' ? { success: true, data: { answer: 'yes' } } : { success: false, error: 'bad' }),
  });

  it('sends a failed task to the cloud even when the device model is ready', async () => {
    const { ai, seen } = build('failed');
    const res = await ai.run(request('classify', 'prefer_on_device'), { taskType: 'classify' });
    expect(res).toMatchObject({ success: true, source: 'cloud' });
    expect(seen).toEqual([{ mode: 'only_in_cloud', onDevice: false }]);
  });

  it('runs the device first for a simple create_app once the gate is ready, and not before', async () => {
    const ready = build('ready');
    expect(await ready.ai.run(request('create_app', 'prefer_on_device'), { taskType: 'create_app', complexity: 'simple' }))
      .toMatchObject({ success: true, source: 'on_device' });
    const unproven = build('unproven');
    expect(await unproven.ai.run(request('create_app', 'prefer_on_device'), { taskType: 'create_app', complexity: 'simple' }))
      .toMatchObject({ success: true, source: 'cloud' });
    expect(unproven.seen).toEqual([{ mode: 'only_in_cloud', onDevice: false }]);
  });
});
