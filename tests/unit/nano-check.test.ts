/**
 * The /nano-check self-check (src/app/nano-check.tsx) with Kalam's real orchestrator and routing, and a fake
 * on-device provider and phone. The screen itself is checked on a real phone through Firebase Test Lab.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  appCheckText, deviceInfo, downloadText, evidenceSummary, nanoCheckAllowed, nanoCheckRequest, nativeModelName, runNanoCheck, sourceText,
  type NanoCheckDeps,
} from '@/app/nano-check';
import { createOrchestrator } from '@/core/ai/orchestrator';
import type { AIProvider, OnDeviceStatus, StructuredRequest } from '@/core/contracts';

// Hoisted above the imports by Vitest: the route's React Native and app-wiring imports stay out of Node.
vi.mock('react-native', () => ({ Platform: { OS: 'android', Version: 36 }, View: () => null, ActivityIndicator: () => null }));
vi.mock('@/design', () => ({ Button: () => null, Screen: () => null, Text: () => null, useKalamTheme: () => ({}) }));
vi.mock('@/services', () => ({ getServices: vi.fn() }));
vi.mock('@/infrastructure/firebase/on-device', () => ({ onDeviceStatus: vi.fn() }));
vi.mock('@/infrastructure/firebase/app', () => ({ appCheckStatus: vi.fn() }));

type Availability = OnDeviceStatus['availability'];
const st = (availability: Availability, detail?: string): OnDeviceStatus => ({ platform: 'android', apiExposed: true, availability, detail });

/** A phone whose availability follows `sequence` (the last one repeats), with a provider that answers `answer`. */
function phone(sequence: Availability[], answer: unknown = { category: 'shopping' }) {
  let i = 0;
  const current = () => st(sequence[Math.min(i, sequence.length - 1)]!, sequence[Math.min(i, sequence.length - 1)] === 'available' ? 'Model on this phone: nano-v4-full' : 'AICore is not ready');
  const calls: StructuredRequest<unknown>[] = [];
  const provider: AIProvider = {
    name: 'firebase',
    isConfigured: () => true,
    onDeviceStatus: async () => current(),
    warmUpOnDevice: async () => ({ ...current(), warm: true }),
    generateStructured: async <T>(req: StructuredRequest<T>) => {
      calls.push(req as StructuredRequest<unknown>);
      const parsed = req.parse(answer);
      return parsed.success
        ? { success: true, output: parsed.data, provider: 'firebase' as const, source: 'on_device' as const, model: 'gemini-nano', latencyMs: 900, fallbackUsed: false }
        : { success: false, provider: 'firebase' as const, source: 'on_device' as const, latencyMs: 900, fallbackUsed: false, errorCode: 'invalid_output' as const, errorMessage: parsed.error };
    },
  };
  const ai = createOrchestrator({
    firebase: provider,
    specialist: { name: 'claude', isConfigured: () => false, onDeviceStatus: async () => st('unavailable'), generateStructured: vi.fn() } as AIProvider,
    events: { add: async () => {}, list: async () => [], clear: async () => {} },
    settings: {
      get: async () => ({ aiMode: 'hybrid', allowCloud: true, allowExternalProviders: false, onDeviceActionCount: 0 }),
      update: async (p: object) => p,
    } as never,
    network: { online: () => true, subscribe: () => () => {} },
    platform: 'android',
    rateLimit: false,
  });
  const lines: string[] = [];
  const deps = (over: Partial<NanoCheckDeps> = {}): NanoCheckDeps => ({
    device: { os: 'android', brand: 'google', model: 'Pixel 10', release: '16', apiLevel: '36' },
    status: async () => current(),
    confirmDownload: vi.fn(async () => true),
    prepare: async (onProgress) => {
      for (const p of [0, 0.05, 0.12, 0.5, 0.55, 1]) onProgress(p);
      i += 1;
      return current();
    },
    warmUp: () => ai.warmUpOnDevice(),
    run: (req, ctx) => ai.run(req, ctx),
    appCheck: async () => ({ status: 'not_configured' }),
    now: () => 1_000,
    log: (l) => lines.push(l),
    ...over,
  });
  const logged = () => lines.map((l) => {
    expect(l.startsWith('KALAM_NANO_CHECK {')).toBe(true);
    return JSON.parse(l.slice('KALAM_NANO_CHECK '.length)) as Record<string, unknown>;
  });
  return { deps, calls, logged };
}

describe('runNanoCheck', () => {
  it('runs the prompt on the device when Gemini Nano is ready, with no download', async () => {
    const t = phone(['available']);
    const r = await runNanoCheck(t.deps());
    expect(r.download).toBe('not_needed');
    expect(r.prompt).toMatchObject({ success: true, source: 'on_device', model: 'gemini-nano', output: { category: 'shopping' }, attempts: 1 });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.mode).toBe('only_on_device');
    expect(sourceText(r)).toBe('On device');
    expect(nativeModelName(r.statusAfter)).toBe('nano-v4-full');
    const steps = t.logged().map((l) => l.step);
    expect(steps).toEqual(['start', 'status', 'status_after', 'warmup', 'prompt', 'app_check', 'done']);
    expect(t.logged().at(-1)).toMatchObject({ source: 'on_device', outputValid: true, matchesExpected: true, availability: 'available' });
  });

  it('asks first, then downloads a downloadable model, logging progress once per 10%', async () => {
    const t = phone(['downloadable', 'available']);
    const deps = t.deps();
    const r = await runNanoCheck(deps);
    expect(deps.confirmDownload).toHaveBeenCalledTimes(1);
    expect(r.download).toBe('completed');
    expect(r.statusAfter?.availability).toBe('available');
    expect(r.prompt?.source).toBe('on_device');
    const downloads = t.logged().filter((l) => l.step === 'download');
    expect(downloads[0]).toMatchObject({ event: 'asked' });
    expect(downloads[1]).toMatchObject({ event: 'start' });
    expect(downloads.filter((l) => l.event === 'progress').map((l) => l.percent)).toEqual([0, 12, 50, 100]);
    expect(downloadText(r)).toBe('Completed');
  });

  it('never starts a download without the person\'s yes', async () => {
    const t = phone(['downloadable', 'available']);
    const prepare = vi.fn();
    for (const confirmDownload of [async () => false, () => Promise.reject(new Error('screen closed'))]) {
      const r = await runNanoCheck(t.deps({ confirmDownload, prepare }));
      expect(prepare).not.toHaveBeenCalled();
      expect(r.download).toBe('declined');
      expect(downloadText(r)).toBe('Not started: you chose not to download');
      // Nothing ran on the phone and nothing went to the cloud: the orchestrator refused.
      expect(r.prompt).toMatchObject({ success: false, errorCode: 'model_unavailable' });
      expect(t.logged().some((l) => l.step === 'download' && l.event === 'declined')).toBe(true);
    }
    expect(t.calls).toHaveLength(0);
  });

  it('follows a download that is already running without asking again', async () => {
    const t = phone(['downloading', 'available']);
    const deps = t.deps();
    const r = await runNanoCheck(deps);
    expect(deps.confirmDownload).not.toHaveBeenCalled();
    expect(r.download).toBe('completed');
  });

  it('shows and logs why Gemini Nano cannot run', async () => {
    const t = phone(['unavailable']);
    const why: OnDeviceStatus = {
      platform: 'android', apiExposed: true, availability: 'unavailable', reason: 'binding_failure', reasonCode: 601,
      detail: 'Kalam could not connect to Android AICore. (error code 601)',
    };
    const r = await runNanoCheck(t.deps({ status: async () => why }));
    expect(t.logged().find((l) => l.step === 'status')).toMatchObject({ reason: 'binding_failure', reasonCode: 601, detail: why.detail });
    expect(evidenceSummary(r)).toMatchObject({ availabilityReason: 'binding_failure', availabilityReasonCode: 601, availabilityDetail: why.detail });
  });

  it('gives up waiting after the timeout, and the orchestrator refuses instead of using the cloud', async () => {
    const t = phone(['downloading']);
    const r = await runNanoCheck(t.deps({ prepare: () => new Promise(() => {}), downloadTimeoutMs: 20 }));
    expect(r.download).toBe('timed_out');
    expect(r.prompt).toMatchObject({ success: false, errorCode: 'model_unavailable', source: 'on_device' });
    expect(t.calls).toHaveLength(0);
    expect(sourceText(r)).toBe('Not run on device');
  });

  it('reports an unavailable phone (an emulator) with its reason and never calls a model', async () => {
    const t = phone(['unavailable']);
    const r = await runNanoCheck(t.deps());
    expect(r.download).toBe('not_needed');
    expect(r.status).toMatchObject({ availability: 'unavailable', detail: 'AICore is not ready' });
    expect(r.prompt?.errorCode).toBe('model_unavailable');
    expect(t.calls).toHaveLength(0);
    expect(evidenceSummary(r)).toMatchObject({ availability: 'unavailable', outputValid: false, source: 'on_device' });
  });

  it('rejects an answer outside the schema', async () => {
    const t = phone(['available'], { category: 'groceries' });
    const r = await runNanoCheck(t.deps());
    expect(r.prompt).toMatchObject({ success: false, errorCode: 'invalid_output' });
    expect(nanoCheckRequest().parse({ category: 'shopping', extra: 1 })).toEqual({ success: true, data: { category: 'shopping' } });
  });

  it('tries once more when the orchestrator saw no ready model but the phone says it is', async () => {
    const t = phone(['available']);
    const run = vi.fn()
      .mockResolvedValueOnce({ success: false, provider: 'none', source: 'on_device', latencyMs: 1500, fallbackUsed: false, errorCode: 'model_unavailable' })
      .mockResolvedValueOnce({ success: true, provider: 'firebase', source: 'on_device', model: 'gemini-nano', latencyMs: 800, fallbackUsed: false, output: { category: 'shopping' } });
    const r = await runNanoCheck(t.deps({ run }));
    expect(run).toHaveBeenCalledTimes(2);
    expect(r.prompt).toMatchObject({ success: true, attempts: 2 });
  });

  it('never throws: a failing step ends the check with the error shown', async () => {
    const t = phone(['available']);
    const r = await runNanoCheck(t.deps({ run: () => Promise.reject(new Error('boom')) }));
    expect(r).toMatchObject({ step: 'done', error: 'boom' });
    expect(t.logged().map((l) => l.step)).toContain('error');
  });
});

describe('who can open the check', () => {
  it('development builds and diagnostics builds only, never a store build', () => {
    expect(nanoCheckAllowed(true, undefined)).toBe(true);
    expect(nanoCheckAllowed(false, 'true')).toBe(true);
    expect(nanoCheckAllowed(false, undefined)).toBe(false);
    expect(nanoCheckAllowed(false, '')).toBe(false);
    expect(nanoCheckAllowed(false, '1')).toBe(false);
  });
});

describe('display helpers', () => {
  it('keeps only brand, model and OS version from Platform', () => {
    const info = deviceInfo({ OS: 'android', Version: 36, constants: { Brand: 'google', Model: 'Pixel 10', Release: '16', Serial: 'SECRET', Fingerprint: 'google/frankel/x' } });
    expect(info).toEqual({ os: 'android', brand: 'google', model: 'Pixel 10', release: '16', apiLevel: '36' });
    expect(JSON.stringify(info)).not.toMatch(/SECRET|frankel/);
  });

  it('describes App Check states', () => {
    expect(appCheckText({ status: 'active' })).toMatch(/^Active/);
    expect(appCheckText({ status: 'not_configured' })).toBe('Set up; no token requested yet');
    expect(appCheckText({ status: 'error', detail: 'Play Integrity gave no token: x' })).toBe('error: Play Integrity gave no token: x');
  });
});
