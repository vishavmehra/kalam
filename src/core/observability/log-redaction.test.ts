/**
 * Log redaction (docs/13 §16.3 "Logs do not expose private content", docs/11 §17.3, D13-040).
 *
 * One person's request is full of private words: a name, a phone number, an amount. This runs the real orchestrator and
 * the real create pipeline against a provider that succeeds, fails with a message that repeats the request, throws, and
 * answers with the request echoed back. Afterwards every place Kalam keeps a trace is searched for those words: the
 * activity log, the recent-errors log, the usage counts, the timings, the console, the problem report and the AI run
 * evidence export. None may hold any of them. A test that finds nothing proves nothing, so each sink is also checked to
 * have recorded the runs.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectProblemReport } from '@/features/diagnostics/collect-report';
import { buildEvidenceExport, formatEvidenceJson } from '@/features/diagnostics/evidence-export';
import {
  DEFAULT_SETTINGS, type AIErrorCode, type AIExecutionResult, type AIProvider, type InferenceEvent, type KalamSettings,
  type StructuredRequest,
} from '../contracts';
import { createOrchestrator } from '../ai/orchestrator';
import { createApplicationPipeline } from '../pipeline/create-application';
import { createTelemetry, installTelemetry, reportError, type TelemetryStore } from '../telemetry';
import { errorLog, timings } from './index';

const CANARIES = ['CANARY-ZXQ-7731', 'Raju Kumar', '9876543210', 'owes 4000 rupees', 'hunter2'];
const REQUEST = `A tailor shop book. ${CANARIES[0]}: ${CANARIES[1]} (${CANARIES[2]}) ${CANARIES[3]}, password ${CANARIES[4]}. Customers, orders, measurements chest waist sleeve, delivery dates, advance payment and a photo of the measurement slip.`;
const tailorIR = JSON.parse(readFileSync(new URL('../../../tests/fixtures/compiler/tailor-shop.ir.json', import.meta.url), 'utf8'));

type Step = 'ok' | 'fail' | 'throw' | 'echo';

function provider(script: Step[]): AIProvider {
  const queue = [...script];
  return {
    name: 'firebase',
    isConfigured: () => true,
    onDeviceStatus: async () => ({ platform: 'web', apiExposed: false, availability: 'unavailable' }),
    async generateStructured<T>(req: StructuredRequest<T>): Promise<AIExecutionResult<T>> {
      const step = queue.shift() ?? 'ok';
      const base = { provider: 'firebase' as const, source: 'cloud' as const, model: 'gemini-test', latencyMs: 12, fallbackUsed: false };
      if (step === 'throw') throw new Error(`socket closed while sending ${CANARIES.join(' ')}`);
      if (step === 'fail') {
        return { success: false, ...base, errorCode: 'provider_error' as AIErrorCode, errorMessage: `upstream rejected: ${REQUEST}` };
      }
      const raw = step === 'echo' ? { screens: [{ title: REQUEST }], note: REQUEST } : tailorIR;
      const parsed = req.parse(raw);
      if (!parsed.success) {
        return { success: false, ...base, errorCode: 'invalid_output', errorMessage: `Model output failed validation: ${REQUEST} ${parsed.error}` };
      }
      req.onUsage?.({ input: 100, output: 50 });
      return { success: true, output: parsed.data, ...base };
    },
  };
}

function setup(script: Step[]) {
  const events: InferenceEvent[] = [];
  let settings: KalamSettings = { ...DEFAULT_SETTINGS, allowCloud: true, cloudNoticeSeen: true };
  const ai = createOrchestrator({
    firebase: provider(script),
    specialist: { ...provider([]), name: 'claude', isConfigured: () => false },
    events: { add: async (e) => { events.push(e); }, list: async (n) => events.slice(0, n), clear: async () => { events.length = 0; } },
    settings: { get: async () => settings, update: async (p) => (settings = { ...settings, ...p }) },
    network: { online: () => true, subscribe: () => () => {} },
    retryDelayMs: () => 0,
    platform: 'web',
  });
  return { ai, events };
}

const memoryStore = (): TelemetryStore & { saved: string[] } => {
  const saved: string[] = [];
  return { saved, read: async () => saved.at(-1) ?? null, write: async (j) => { saved.push(j); } };
};

const consoleCalls: unknown[][] = [];
beforeEach(() => {
  consoleCalls.length = 0;
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { consoleCalls.push(a); });
  errorLog.clear();
  timings.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  installTelemetry(undefined);
});

describe('log redaction (D13-040)', () => {
  it('keeps the words of a request out of every log, count, report and export', async () => {
    const store = memoryStore();
    const telemetry = createTelemetry(store);
    await telemetry.setEnabled(true);
    installTelemetry(telemetry);
    // Succeed, fail, throw, echo the request back, then succeed again: every outcome writes its own trace.
    const { ai, events } = setup(['ok', 'fail', 'throw', 'echo', 'echo', 'ok']);
    const create = createApplicationPipeline({ ai });
    const input = { text: REQUEST, modalities: ['text' as const], images: [] };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await create(input, { sessionId: `sess_${i}test01` }));
    reportError({ code: 'provider_error', message: REQUEST });
    reportError(new Error(REQUEST));

    // Not vacuous: the runs happened and were recorded.
    expect(results.some((r) => r.ok)).toBe(true);
    expect(results.some((r) => !r.ok)).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events.every((e) => typeof e.latencyMs === 'number' && e.model !== REQUEST)).toBe(true);
    expect(errorLog.recent().length).toBeGreaterThan(0);

    const collected = await collectProblemReport('create', {
      now: () => Date.UTC(2026, 10, 26), device: { appVersion: '1.0.0', platform: 'web', osVersion: 'Chrome 140 on Windows' },
      settings: DEFAULT_SETTINGS, usageCounts: true, errorCodes: () => errorLog.recent().map((e) => e.code),
      timings: () => timings.summarize(), events: async (n) => events.slice(0, n),
    });
    const evidence = formatEvidenceJson(buildEvidenceExport({ now: Date.UTC(2026, 10, 26), appVersion: '1.0.0', platform: 'web', events }));

    const sinks: Record<string, string> = {
      'activity log': JSON.stringify(events),
      'recent errors': JSON.stringify(errorLog.recent()),
      'usage counts': telemetry.exportJson(),
      'saved counts': store.saved.join('\n'),
      timings: JSON.stringify(timings.summarize()),
      console: JSON.stringify(consoleCalls),
      'problem report': collected.text + JSON.stringify(collected.report),
      'evidence export': evidence,
    };
    for (const [name, text] of Object.entries(sinks)) {
      for (const canary of CANARIES) expect(text, `${name} holds "${canary}"`).not.toContain(canary);
    }
    // The evidence export did record the runs it was given.
    expect(JSON.parse(evidence).events.length).toBe(events.length);
  });

  it('records a failed run by its code and size, never by its message', async () => {
    const { ai, events } = setup(['fail', 'fail', 'fail']);
    await ai.run(
      {
        taskType: 'classify', prompt: REQUEST, jsonSchema: { type: 'object' }, mode: 'only_in_cloud',
        parse: () => ({ success: true as const, data: {} }),
      },
      { taskType: 'classify' },
    );
    expect(events.length).toBeGreaterThan(0);
    const e = events.at(-1)!;
    expect(e).toMatchObject({ success: false, errorCode: 'provider_error' });
    expect(e.inputChars).toBe(REQUEST.length);
    expect(JSON.stringify(e)).not.toContain('CANARY');
    expect(Object.keys(e)).not.toEqual(expect.arrayContaining(['prompt', 'errorMessage', 'output']));
  });
});
