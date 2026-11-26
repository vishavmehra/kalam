import { describe, expect, it } from 'vitest';

import type { InferenceEvent } from '@/core/contracts';
import type { TimingSummary } from '@/core/observability';

import { buildEvidence, EVIDENCE_RUN_LIMIT, EVIDENCE_SCHEMA, evidenceFileName, evidenceJson } from './evidence';

const NOW = Date.UTC(2026, 10, 25, 12);
const device = { appVersion: '1.2.3', platform: 'android', osVersion: 'Android API 36' };
const timing: TimingSummary = { name: 'media_validate', runs: 3, failed: 1, medianMs: 4.5, p95Ms: 9, maxMs: 9 };

const event = (over: Partial<InferenceEvent> = {}): InferenceEvent => ({
  id: 'evt_secret_id', at: NOW - 1000, taskId: 'task_abc123', taskType: 'classify', appId: 'app_SENTINEL_clinic', route: 'on_device',
  provider: 'firebase', model: 'gemini-nano', source: 'on_device', latencyMs: 812, success: true, fallbackUsed: false,
  escalationReason: 'SENTINEL free text about Asha', inputChars: 40, outputChars: 12, platform: 'android', promptVersion: 'assistant/3',
  schemaVersion: '1.0.0', tokens: { input: 10, output: 4 }, retries: 0, cacheHit: false, ...over,
});

describe('hybrid evidence export (docs/17 §5.4)', () => {
  it('lists, per run, task, platform, model, source, completion, model time and error, and nothing else', () => {
    const out = buildEvidence({
      events: [
        event(),
        event({ taskId: 'task_def456', at: NOW - 500, source: 'cloud', route: 'cloud', model: 'gemini-2.5-flash', success: false, errorCode: 'timeout', fallbackUsed: true, latencyMs: 20000 }),
      ],
      timings: [timing], device, now: NOW,
    });
    expect(out).toMatchObject({
      schema: EVIDENCE_SCHEMA, createdAt: '2026-11-25T12:00:00.000Z', appVersion: '1.2.3', platform: 'android', osVersion: 'Android API 36',
      skippedRuns: 0, localSteps: [timing],
    });
    expect(out.runs.map((r) => [r.taskId, r.source, r.completed, r.modelLatencyMs, r.error])).toEqual([
      ['task_abc123', 'on_device', true, 812, undefined], ['task_def456', 'cloud', false, 20000, 'timeout'],
    ]);
    expect(out.runs[0]).toEqual({
      taskId: 'task_abc123', task: 'classify', at: NOW - 1000, platform: 'android', source: 'on_device', route: 'on_device', provider: 'firebase',
      model: 'gemini-nano', promptVersion: 'assistant/3', schemaVersion: '1.0.0', completed: true, modelLatencyMs: 812, fallbackUsed: false,
      cacheHit: false, retries: 0, tokens: { input: 10, output: 4 }, inputChars: 40, outputChars: 12,
    });
    expect(out.summary).toMatchObject({ onDevice: { runs: 1, succeeded: 1 }, cloud: { runs: 1, succeeded: 0 }, cloudFallbacks: { runs: 0 } });
    expect(out.latencyBasis).toMatch(/model call only/);
  });

  it('holds no free text, app id, event id or record value', () => {
    const json = evidenceJson(buildEvidence({
      events: [event({ appId: 'app_SENTINEL_clinic', escalationReason: 'SENTINEL free text about Asha', model: 'gemini-nano' })], timings: [], device, now: NOW,
    }));
    expect(json).not.toMatch(/SENTINEL|Asha|evt_secret_id|app_/);
    expect(JSON.parse(json).runs[0]).not.toHaveProperty('appId');
    expect(JSON.parse(json).runs[0]).not.toHaveProperty('escalationReason');
  });

  it('leaves out a run with a value that is not on a closed list or a short name, and counts it', () => {
    const bad = [
      event({ taskId: 'task one with spaces' }),
      event({ model: 'Asha clinic prompt: please summarise' }),
      event({ taskType: 'wipe' as never }),
      event({ source: 'somewhere' as never }),
      event({ latencyMs: Number.NaN }),
      event({ errorCode: 'SENTINEL oops' as never }),
      event({ tokens: { input: -1 } }),
    ];
    const out = buildEvidence({ events: [...bad, event({ taskId: 'task_good' })], timings: [], device, now: NOW });
    expect(out.runs.map((r) => r.taskId)).toEqual(['task_good']);
    expect(out.skippedRuns).toBe(bad.length);
    expect(evidenceJson(out)).not.toMatch(/SENTINEL|Asha|wipe/);
  });

  it('cleans the device line and the timings, and keeps model time and local steps apart', () => {
    const out = buildEvidence({
      events: [], timings: [timing, { ...timing, name: 'not_a_step' as never }],
      device: { appVersion: '1.2.3 build for Asha', platform: 'toaster', osVersion: 'Pixel 9 of Asha' }, now: NOW,
    });
    expect(out).toMatchObject({ appVersion: 'unknown', platform: 'other', osVersion: 'unknown', runs: [], skippedRuns: 0 });
    expect(out.localSteps).toEqual([timing]);
    expect(out.runs).toEqual([]);
    expect(JSON.stringify(out)).not.toMatch(/Asha|toaster|Pixel/);
  });

  it('keeps the newest runs, oldest first, and names an unknown platform plainly', () => {
    const many = Array.from({ length: EVIDENCE_RUN_LIMIT + 5 }, (_, i) => event({ taskId: `task_${i}`, at: NOW - 100_000 + i, platform: undefined }));
    const out = buildEvidence({ events: many, timings: [], device, now: NOW });
    expect(out.runs).toHaveLength(EVIDENCE_RUN_LIMIT);
    expect(out.runs[0]!.taskId).toBe('task_5');
    expect(out.runs.at(-1)!.taskId).toBe(`task_${EVIDENCE_RUN_LIMIT + 4}`);
    expect(out.runs[0]!.platform).toBe('unknown');
    expect(out.summary.byPlatform.map((p) => p.platform)).toEqual(['unknown']);
  });

  it('names the file by day and survives a bad clock', () => {
    expect(evidenceFileName(NOW)).toBe('kalam-hybrid-evidence-2026-11-25.json');
    expect(evidenceFileName(Number.NaN)).toBe('kalam-hybrid-evidence-unknown.json');
    expect(evidenceFileName(1e20)).toBe('kalam-hybrid-evidence-unknown.json');
    expect(buildEvidence({ events: [], timings: [], device, now: Number.NaN }).createdAt).toBe('unknown');
  });
});
