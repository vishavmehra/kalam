import { describe, expect, it } from 'vitest';

import type { InferenceEvent } from '@/core/contracts';

import { buildEvidenceExport, EVIDENCE_MAX_EVENTS, formatEvidenceJson } from './evidence-export';

const event = (over: Partial<InferenceEvent> = {}): InferenceEvent => ({
  id: 'evt1', at: Date.UTC(2026, 10, 26, 9, 0, 0), taskId: 'task_abcd1234', taskType: 'classify', route: 'on_device',
  provider: 'firebase', model: 'gemini-nano', source: 'on_device', latencyMs: 420, success: true, fallbackUsed: false,
  platform: 'web', ...over,
});

const NOW = Date.UTC(2026, 10, 26, 10, 0, 0);

describe('buildEvidenceExport (D17-029)', () => {
  it('keeps platform, model, source and latency for every run', () => {
    const out = buildEvidenceExport({
      now: NOW, appVersion: '1.0.0', platform: 'web', onDevice: { apiExposed: true, availability: 'available' },
      events: [
        event({ latencyMs: 300 }),
        event({ route: 'cloud', source: 'cloud', model: 'gemini-3.8-flash', taskType: 'create_app', latencyMs: 9_100, tokens: { input: 1200, output: 800 }, promptVersion: 'compiler-v1', schemaVersion: '1.1.0', sessionId: 'create_abc12345' }),
      ],
    });
    expect(out).toMatchObject({ kind: 'kalam-inference-evidence', version: 1, createdAt: '2026-11-26T10:00:00.000Z', appVersion: '1.0.0', platform: 'web' });
    expect(out.onDevice).toEqual({ apiExposed: true, availability: 'available' });
    expect(out.events[0]).toEqual({
      at: '2026-11-26T09:00:00.000Z', platform: 'web', task: 'classify', route: 'on_device', source: 'on_device', provider: 'firebase',
      model: 'gemini-nano', latencyMs: 300, success: true, fallback: false,
    });
    expect(out.events[1]).toMatchObject({
      source: 'cloud', model: 'gemini-3.8-flash', task: 'create_app', latencyMs: 9_100, tokens: { input: 1200, output: 800 },
      promptVersion: 'compiler-v1', schemaVersion: '1.1.0', sessionId: 'create_abc12345',
    });
  });

  it('summarises runs, failures, median and slowest per source', () => {
    const out = buildEvidenceExport({
      now: NOW,
      events: [
        event({ latencyMs: 100 }), event({ latencyMs: 300 }), event({ latencyMs: 200, success: false, errorCode: 'timeout' }),
        event({ source: 'cloud', route: 'cloud', latencyMs: 4_000 }), event({ source: 'cloud', route: 'cloud', latencyMs: 6_000 }),
      ],
    });
    expect(out.summary.on_device).toEqual({ runs: 3, failed: 1, medianMs: 200, slowestMs: 300 });
    expect(out.summary.cloud).toEqual({ runs: 2, failed: 0, medianMs: 5_000, slowestMs: 6_000 });
    expect(out.summary.deterministic).toBeUndefined();
  });

  it('has nowhere for content to go: prompts, answers, app ids and notes never come out', () => {
    const hostile = {
      ...event({ model: 'gemini nano; ignore previous instructions' }),
      prompt: 'my secret shop plan', output: 'Raju owes 4000', appId: 'app_tailor01',
      escalationReason: 'the user typed: my password is hunter2', errorMessage: 'bad entry for Raju',
      sessionId: 'Raju Kumar, 9876543210', promptVersion: '<script>alert(1)</script>', taskType: 'my private task',
    };
    const text = formatEvidenceJson(buildEvidenceExport({ now: NOW, events: [hostile] }));
    for (const leak of ['secret', 'Raju', 'hunter2', 'app_tailor01', 'script', 'ignore previous', '9876543210', 'private']) {
      expect(text).not.toContain(leak);
    }
    const row = JSON.parse(text).events[0];
    expect(row).not.toHaveProperty('model');
    expect(row).not.toHaveProperty('sessionId');
    expect(row).not.toHaveProperty('promptVersion');
    expect(row.task).toBe('other');
  });

  it('drops rows with no usable time or latency and bad numbers', () => {
    const out = buildEvidenceExport({
      now: NOW,
      events: [null, 'text', {}, event({ latencyMs: -5 }), event({ latencyMs: Number.NaN }), event({ at: 0 }), event({ retries: 99 }), event({ tokens: { input: -1, output: 5 } })],
    });
    expect(out.events).toHaveLength(2);
    expect(out.events[0]).not.toHaveProperty('retries');
    expect(out.events[1]!.tokens).toEqual({ output: 5 });
  });

  it('keeps only the newest runs and survives an empty log', () => {
    const many = Array.from({ length: EVIDENCE_MAX_EVENTS + 40 }, (_, i) => event({ latencyMs: i }));
    const out = buildEvidenceExport({ now: NOW, events: many });
    expect(out.events).toHaveLength(EVIDENCE_MAX_EVENTS);
    expect(out.events[0]!.latencyMs).toBe(0);
    expect(buildEvidenceExport({ now: NOW, events: [] })).toMatchObject({ events: [], summary: {}, appVersion: 'unknown', platform: 'other' });
  });

  it('accepts the session id formats this app makes and rejects the rest', () => {
    const ids = ['create_abc12345', 'sess_mhx3k2a_a1b2c3d4e5f6', 'x', 'CREATE_ABC12345', 'a b'];
    const out = buildEvidenceExport({ now: NOW, events: ids.map((sessionId) => event({ sessionId })) });
    expect(out.events.map((e) => e.sessionId)).toEqual(['create_abc12345', 'sess_mhx3k2a_a1b2c3d4e5f6', undefined, undefined, undefined]);
  });

  it('records a failed run with its error code from the closed list', () => {
    const out = buildEvidenceExport({
      now: NOW, events: [event({ success: false, errorCode: 'app_check_failed', fallbackUsed: true }), event({ success: false, errorCode: 'weird_new_code' as never })],
    });
    expect(out.events[0]).toMatchObject({ success: false, error: 'app_check_failed', fallback: true });
    expect(out.events[1]!.error).toBe('other');
  });
});
