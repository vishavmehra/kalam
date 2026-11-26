/**
 * Browser side of the Chrome matrix (docs/17 §12.1, D17-003, D17-044, D13-025). Bundled and driven by
 * `node scripts/verify-firebase-ai.mjs --web-matrix`; never imported by the app.
 *
 * It runs Kalam's OWN code in a real Chrome page: the same orchestrator and the same Firebase provider the app builds
 * (src/core/ai/orchestrator.ts, src/infrastructure/firebase/firebase-provider.ts), the real `firebase/ai` hybrid SDK and the
 * real App Check setup. Only the screen is missing, and the saved-data layer (events are kept in memory here).
 *
 * Each scenario reports what it saw, never what it hoped for: the source comes from the SDK's own `inferenceSource` through the
 * provider, the model from the answer, the App Check header from the request that left the page (present or not, never its value).
 * Nothing the person typed exists here: the only input is the fixed sample "Buy milk tomorrow."
 */
import { z } from 'zod';
import { createOrchestrator } from '@/core/ai/orchestrator';
import {
  DEFAULT_SETTINGS, type AIExecutionResult, type AIProvider, type InferenceEvent, type KalamSettings, type StructuredRequest,
} from '@/core/contracts';
import { appCheckStatus, getFirebaseApp } from '@/infrastructure/firebase/app';
import { createFirebaseProvider } from '@/infrastructure/firebase/firebase-provider';
import { irToSpec } from '@/core/compiler/convert';
import { compilerIRSchema } from '@/core/compiler/ir';
import type { KalamAIBlock } from '@/core/spec/schema';
import { createAIBlockService } from '@/core/tasks/ai-block-service';
import tailorFixture from '../../fixtures/compiler/tailor-shop.ir.json';

type ScenarioId = 'A' | 'B' | 'C' | 'C2' | 'D' | 'E' | 'F' | 'G' | 'H';
interface Seen { task: string; route: string; source: string; provider: string; model?: string; ms: number; ok: boolean; fallback: boolean; error?: string }
export interface ScenarioResult {
  id: ScenarioId;
  title: string;
  /** What this run did to the page, so nobody reads a simulated signal as a real one. */
  how: string;
  pass: boolean;
  observed: Record<string, unknown>;
  events: Seen[];
  failures: string[];
}

const schema = {
  type: 'object',
  properties: { category: { type: 'string', enum: ['shopping', 'work', 'health', 'other'] }, confidence: { type: 'string', enum: ['high', 'low'] } },
  required: ['category', 'confidence'],
};
const answer = z.object({ category: z.enum(['shopping', 'work', 'health', 'other']), confidence: z.enum(['high', 'low']) }).strict();
type Answer = z.infer<typeof answer>;

/**
 * The task every device-eligible scenario runs. Voice actions are the one task whose recorded benchmark clears its gate on web (src/core/ai/local-ready.ts),
 * so the app routes it to Gemini Nano; classify, summarise and translate are kept off the device by their failed benchmarks and would go to the cloud.
 * The request is a tiny classification, which is a fair stand-in for a short voice command: the point here is the hybrid route, not the answer.
 */
const LOCAL_TASK = 'voice_action' as const;

const request = (mode: StructuredRequest<Answer>['mode']): StructuredRequest<Answer> => ({
  taskType: LOCAL_TASK, role: 'voice', system: 'Classify the note. Reply with JSON only.', prompt: 'Buy milk tomorrow.',
  jsonSchema: schema, mode, temperature: 0, timeoutMs: 120_000,
  parse: (raw) => {
    const r = answer.safeParse(raw);
    return r.success ? { success: true, data: r.data } : { success: false, error: r.error.issues.map((i) => i.message).join('; ') };
  },
});

/** A specialist that is never configured: this page must only ever reach Firebase. */
const noSpecialist: AIProvider = {
  name: 'claude', isConfigured: () => false,
  onDeviceStatus: async () => ({ platform: 'web', apiExposed: false, availability: 'unavailable' }),
  generateStructured: async <T>(): Promise<AIExecutionResult<T>> => ({
    success: false, provider: 'claude', source: 'cloud', latencyMs: 0, fallbackUsed: false, errorCode: 'not_configured',
  }),
};

// ─── What left the page ───────────────────────────────────────────────────────────────────────
const sent: Array<{ host: string; appCheckHeader: boolean }> = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (/firebasevertexai|firebaseml|generativelanguage|aiplatform/.test(url.hostname)) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      sent.push({ host: url.hostname, appCheckHeader: headers.has('X-Firebase-AppCheck') });
    }
  } catch { /* never let the probe change a request */ }
  return realFetch(input, init);
};

// ─── Harness ──────────────────────────────────────────────────────────────────────────────────
function harness(settings: Partial<KalamSettings> = {}, extra: { localReady?: () => 'unproven' } = {}) {
  const events: InferenceEvent[] = [];
  let current: KalamSettings = { ...DEFAULT_SETTINGS, allowCloud: true, cloudNoticeSeen: true, ...settings };
  const ai = createOrchestrator({
    firebase: createFirebaseProvider(),
    specialist: noSpecialist,
    events: { add: async (e) => { events.push(e); }, list: async (n) => events.slice(-(n ?? events.length)).reverse(), clear: async () => { events.length = 0; } },
    settings: { get: async () => current, update: async (p) => (current = { ...current, ...p }) },
    network: {
      online: () => navigator.onLine,
      subscribe: (l) => { const f = () => l(navigator.onLine); addEventListener('online', f); addEventListener('offline', f); return () => { removeEventListener('online', f); removeEventListener('offline', f); }; },
    },
    platform: 'web',
    ...extra,
  });
  const seen = (): Seen[] => events.map((e) => ({
    task: e.taskType, route: e.route, source: e.source, provider: e.provider, ...(e.model ? { model: e.model } : {}),
    ms: e.latencyMs, ok: e.success, fallback: e.fallbackUsed, ...(e.errorCode ? { error: e.errorCode } : {}),
  }));
  return { ai, seen };
}

const lm = () => (globalThis as { LanguageModel?: Record<string, unknown> }).LanguageModel;

/** Replaces one method of the Prompt API for the rest of this page, and says so in the result. */
function patchLanguageModel(method: 'availability' | 'create', replacement: () => unknown): void {
  const api = lm();
  if (!api) throw new Error('This Chrome has no LanguageModel to patch.');
  Object.defineProperty(api, method, { value: replacement, configurable: true, writable: true });
}

const cloudCalls = (since: number) => sent.slice(since);

async function runScenario(id: ScenarioId): Promise<ScenarioResult> {
  const failures: string[] = [];
  const expect = (cond: unknown, message: string) => { if (!cond) failures.push(message); };
  const base = { id, failures, pass: false };
  getFirebaseApp(); // App Check is set up with the app, before the first request

  if (id === 'A') {
    const h = harness();
    const status = await h.ai.status();
    expect(status.onDevice.apiExposed, 'Prompt API is not exposed');
    expect(status.onDevice.availability === 'available', `availability is ${status.onDevice.availability}`);
    const t0 = performance.now();
    const warm = await h.ai.warmUpOnDevice();
    const warmMs = Math.round(performance.now() - t0);
    const res = await h.ai.run(request('prefer_on_device'), { taskType: LOCAL_TASK });
    expect(res.success, `the run failed: ${res.errorCode}`);
    expect(res.source === 'on_device', `source is ${res.source}`);
    expect(res.fallbackUsed === false, 'a device answer is not a fallback');
    expect(res.model?.includes('nano'), `model is ${res.model}`);
    const ev = h.seen();
    expect(ev.at(-1)?.source === 'on_device' && ev.at(-1)?.provider === 'firebase', 'the activity event does not say on_device');
    return {
      ...base, title: 'Chrome with a local model', how: 'Real Gemini Nano in the Kalam Chrome. Nothing patched.', pass: failures.length === 0,
      observed: { availability: status.onDevice.availability, warm: warm.warm, warmUpMs: warmMs, source: res.source, model: res.model, latencyMs: res.latencyMs, output: res.output },
      events: ev,
    };
  }

  if (id === 'B') {
    const h = harness();
    const status = await h.ai.status();
    expect(!status.onDevice.apiExposed, 'this browser exposes the Prompt API; scenario B needs one that does not');
    const before = sent.length;
    const res = await h.ai.run(request('prefer_on_device'), { taskType: LOCAL_TASK });
    expect(res.success, `the run failed: ${res.errorCode}`);
    expect(res.source === 'cloud', `source is ${res.source}`);
    expect(res.fallbackUsed === true, 'the cloud answer should count as a fallback from the device preference');
    expect(cloudCalls(before).length > 0, 'no request reached the cloud');
    return {
      ...base, title: 'Chrome without a local model', how: 'A real Chromium with the Prompt API switched off (launched with --disable-features for it), so the browser exposes no local model. Nothing patched in the page.', pass: failures.length === 0,
      observed: { apiExposed: status.onDevice.apiExposed, availability: status.onDevice.availability, source: res.source, model: res.model, latencyMs: res.latencyMs, output: res.output, cloudRequests: cloudCalls(before).length },
      events: h.seen(),
    };
  }

  if (id === 'C2') {
    // A real browser whose model is not installed: nothing is patched, the page only reports what Chrome says.
    const h = harness();
    const status = await h.ai.status();
    expect(status.onDevice.apiExposed, 'this browser does not expose the Prompt API');
    expect(status.onDevice.availability !== 'available', `the model is available here (${status.onDevice.availability}); this scenario needs one that is not installed`);
    const before = sent.length;
    const res = await h.ai.run(request('prefer_on_device'), { taskType: LOCAL_TASK });
    expect(res.success && res.source === 'cloud', `expected a cloud answer, got ${res.success ? res.source : res.errorCode}`);
    expect(res.fallbackUsed === true, 'the cloud answer should count as a fallback');
    expect(cloudCalls(before).length > 0, 'no request reached the cloud');
    const strict = await h.ai.run(request('only_on_device'), { taskType: LOCAL_TASK });
    expect(!strict.success && strict.errorCode === 'model_unavailable', `a device-only request should fail plainly, got ${strict.errorCode ?? 'success'}`);
    return {
      ...base, title: 'Local model not ready (real)', how: 'A real Chromium whose Gemini Nano is not installed (Playwright Chromium, Prompt API exposed, availability reported by Chrome). Nothing patched.',
      pass: failures.length === 0,
      observed: {
        apiExposed: status.onDevice.apiExposed, availability: status.onDevice.availability, source: res.source, model: res.model, fallbackUsed: res.fallbackUsed,
        deviceOnly: { success: strict.success, errorCode: strict.errorCode, message: strict.errorMessage },
      },
      events: h.seen(),
    };
  }

  if (id === 'C') {
    const out: Record<string, unknown> = {};
    const all: Seen[] = [];
    for (const state of ['downloadable', 'downloading'] as const) {
      patchLanguageModel('availability', async () => state);
      const h = harness();
      const status = await h.ai.status();
      expect(status.onDevice.availability === state, `status says ${status.onDevice.availability}, not ${state}`);
      const res = await h.ai.run(request('prefer_on_device'), { taskType: LOCAL_TASK });
      expect(res.success && res.source === 'cloud', `${state}: expected a cloud answer, got ${res.source}`);
      expect(res.fallbackUsed === true, `${state}: the cloud answer should count as a fallback`);
      const strict = await h.ai.run(request('only_on_device'), { taskType: LOCAL_TASK });
      expect(!strict.success && strict.errorCode === 'model_unavailable', `${state}: a device-only request should fail plainly, got ${strict.errorCode ?? 'success'}`);
      expect(!!strict.errorMessage && !/[{}]|undefined/.test(strict.errorMessage), `${state}: the message is not plain`);
      out[state] = { source: res.source, fallbackUsed: res.fallbackUsed, deviceOnly: { success: strict.success, errorCode: strict.errorCode, message: strict.errorMessage } };
      all.push(...h.seen());
    }
    return {
      ...base, title: 'Local model not ready (simulated signal)', how: 'The page answers the Prompt API availability check with "downloadable" and then "downloading" (a model that is already installed cannot be made not ready). The requests that follow are real.',
      pass: failures.length === 0, observed: out, events: all,
    };
  }

  if (id === 'D') {
    patchLanguageModel('create', async () => { throw new DOMException('The device model could not start.', 'NotAllowedError'); });
    const h = harness();
    const status = await h.ai.status();
    const before = sent.length;
    const res = await h.ai.run(request('prefer_on_device'), { taskType: LOCAL_TASK });
    const ev = h.seen();
    expect(res.success, `the run failed: ${res.errorCode}`);
    expect(res.source === 'cloud', `source is ${res.source}`);
    expect(res.fallbackUsed === true, 'the answer should count as a fallback');
    expect(ev.length >= 2 && ev[0]?.ok === false && ev[0]?.source === 'on_device', 'the failed device attempt is not in the activity log');
    expect(ev.at(-1)?.source === 'cloud' && ev.at(-1)?.ok === true, 'the cloud answer is not in the activity log');
    expect(cloudCalls(before).length === 1, `expected exactly one cloud request, saw ${cloudCalls(before).length}`);
    return {
      ...base, title: 'Cloud fallback after the device fails', how: 'The page makes the Prompt API refuse to start a session (NotAllowedError). The cloud request that follows is real.',
      pass: failures.length === 0,
      observed: { availabilityBefore: status.onDevice.availability, source: res.source, model: res.model, fallbackUsed: res.fallbackUsed, cloudRequests: cloudCalls(before).length, output: res.output },
      events: ev,
    };
  }

  if (id === 'E') {
    const h = harness();
    const ac = appCheckStatus();
    expect(ac.status === 'debug' || ac.status === 'active', `App Check is ${ac.status}${ac.detail ? ` (${ac.detail})` : ''}`);
    const before = sent.length;
    const res = await h.ai.run(request('only_in_cloud'), { taskType: LOCAL_TASK });
    expect(res.success, `the run failed: ${res.errorCode}`);
    expect(res.source === 'cloud', `source is ${res.source}`);
    const calls = cloudCalls(before);
    expect(calls.length > 0, 'no request reached the cloud');
    expect(calls.length > 0 && calls.every((c) => c.appCheckHeader), 'a cloud request left without an App Check token');
    return {
      ...base, title: 'Inference with App Check', how: 'Real cloud request with the App Check token Kalam attaches (debug token on localhost). The header is checked for presence only.',
      pass: failures.length === 0,
      observed: { appCheck: ac.status, source: res.source, model: res.model, latencyMs: res.latencyMs, cloudRequests: calls.length, allWithAppCheckHeader: calls.every((c) => c.appCheckHeader), output: res.output },
      events: h.seen(),
    };
  }

  if (id === 'H') {
    // H: the build-time check of an AI step (docs/07 CP7) in the real Chrome: the cloud writes the test cases, Gemini Nano runs the step on this
    // device for each, and the answers are graded. The step classifies a short order-book note as urgent or normal.
    const spec = irToSpec(compilerIRSchema.parse(tailorFixture), { appId: 'app_matrix01', now: 1 });
    const block: KalamAIBlock = {
      kind: 'classify', prompt: 'Is this note urgent or normal?', verified: 'unverified', labels: ['Urgent', 'Normal'], inputField: 'notes', outputField: 'notes',
    };
    const withBlock = { ...spec, aiBlocks: { note_kind: block } };
    // The benchmark gate is set aside for this run: classify currently fails its gate on web, which keeps the step off the device (scenario C shows that message).
    const h = harness({}, { localReady: () => 'unproven' });
    const status = await h.ai.status();
    expect(status.onDevice.availability === 'available', `availability is ${status.onDevice.availability}`);
    const outcome = await createAIBlockService({ ai: h.ai }).verify(withBlock, 'note_kind');
    const ev = h.seen();
    expect(outcome.testCount >= 3, `only ${outcome.testCount} test cases were written`);
    expect(outcome.status !== 'unverified', `the check stopped: ${outcome.reason ?? 'unknown'} ${outcome.message ?? ''}`.trim());
    expect(ev.some((e) => e.source === 'cloud' && e.ok), 'no cloud step (writing the test cases) is in the activity log');
    expect(ev.some((e) => e.source === 'on_device' && e.ok), 'no on-device step (running the AI step) is in the activity log');
    return {
      ...base, title: 'AI-step check, Nano plus cloud', how: 'Real Gemini Nano runs the step; the cloud writes the test cases. The device benchmark gate is set aside for this run (classify fails it on web today). The test inputs are model-written, not real notes.',
      pass: failures.length === 0,
      observed: {
        status: outcome.status, reason: outcome.reason, testCount: outcome.testCount, passCount: outcome.passCount, model: outcome.model, judgeUsed: outcome.judgeUsed,
        device: outcome.device, onDeviceRunMs: outcome.details.map((d) => d.latencyMs ?? null),
      },
      events: ev,
    };
  }

  if (id === 'G') {
    // G: the driver has put the network back after F. The cloud-only task that was refused offline must now work, and the first request after the
    // reconnect must be the one that goes through (no stuck state from the outage).
    const h = harness();
    expect(navigator.onLine, 'the page still thinks it is offline');
    const before = sent.length;
    const res = await h.ai.run({ ...request('only_in_cloud'), taskType: 'create_app', role: 'compiler' }, { taskType: 'create_app', complexity: 'complex' });
    expect(res.success, `the first request after reconnecting failed: ${res.errorCode}`);
    expect(res.source === 'cloud', `source is ${res.source}`);
    expect(cloudCalls(before).length === 1, `expected one cloud request, saw ${cloudCalls(before).length}`);
    return {
      ...base, title: 'Reconnect', how: 'The driver takes the tab offline (scenario F) and puts the network back. The first cloud-only request after that is a real, billed request.',
      pass: failures.length === 0,
      observed: { online: navigator.onLine, success: res.success, source: res.source, model: res.model, latencyMs: res.latencyMs, cloudRequests: cloudCalls(before).length, output: res.output },
      events: h.seen(),
    };
  }

  // F: the driver has put this tab offline (Network.emulateNetworkConditions) before calling.
  const h = harness();
  const online = navigator.onLine;
  expect(!online, 'the page still thinks it is online');
  const before = sent.length;
  const local = await h.ai.run(request('prefer_on_device'), { taskType: LOCAL_TASK });
  expect(local.success && local.source === 'on_device', `offline local run: ${local.success ? local.source : local.errorCode}`);
  // A cloud-only task (building an app): a task the device can do (classify) would run on the device instead, which is the point.
  const cloud = await h.ai.run({ ...request('only_in_cloud'), taskType: 'create_app', role: 'compiler' }, { taskType: 'create_app', complexity: 'complex' });
  expect(!cloud.success && cloud.errorCode === 'offline', `offline cloud run should fail as offline, got ${cloud.errorCode ?? 'success'}`);
  expect(!!cloud.errorMessage && !/[{}]|undefined/.test(cloud.errorMessage), 'the offline message is not plain');
  expect(cloudCalls(before).length === 0, 'a request left the page while it was offline');
  return {
    ...base, title: 'Offline', how: 'The driver puts the tab offline with the DevTools network emulation. Real Gemini Nano answers a local task; a cloud-only task (building an app) is refused as offline before anything is sent. Saved apps opening offline is covered by the offline Playwright run (tests/e2e).',
    pass: failures.length === 0,
    observed: {
      online, localSource: local.source, localModel: local.model, localLatencyMs: local.latencyMs,
      cloudSuccess: cloud.success, cloudErrorCode: cloud.errorCode, cloudMessage: cloud.errorMessage, requestsSentWhileOffline: cloudCalls(before).length,
    },
    events: h.seen(),
  };
}

(globalThis as { __matrix?: unknown }).__matrix = {
  run: (id: ScenarioId) => runScenario(id).catch((e: unknown): ScenarioResult => ({
    id, title: 'error', how: '', pass: false, observed: {}, events: [], failures: [`the scenario threw ${e instanceof Error ? e.name : 'an error'}`],
  })),
  ready: true,
};
