import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type InferenceEvent, type StoredApp } from '@/core/contracts';
import { createErrorLog, createTimingLog } from '@/core/observability';
import type { KalamSpec } from '@/core/spec/schema';
import { createTelemetry, type TelemetryStore } from '@/core/telemetry';
import { createWebDatabase } from '@/infrastructure/storage/database.web';

import { collectProblemReport, REPORT_EVENT_LIMIT, type ReportSources } from './collect-report';
import { storageTelemetryStore, TELEMETRY_STORAGE_KEY } from './telemetry-store';

const NOW = Date.parse('2026-11-25T09:00:00Z');

const sources = (over: Partial<ReportSources> = {}): ReportSources => ({
  now: () => NOW,
  device: { appVersion: '0.1.0', platform: 'android', osVersion: 'Android API 36' },
  settings: DEFAULT_SETTINGS,
  usageCounts: false,
  errorCodes: () => [],
  timings: () => [],
  events: async () => [],
  ...over,
});

describe('collectProblemReport', () => {
  it('builds the report and the text from the sources it is given', async () => {
    const events = vi.fn(async () => [{ source: 'cloud', success: true } as InferenceEvent]);
    const { report, text } = await collectProblemReport('create', sources({ errorCodes: () => ['timeout', 'timeout'], events }));
    expect(events).toHaveBeenCalledWith(REPORT_EVENT_LIMIT);
    expect(report.area).toBe('create');
    expect(report.platform).toBe('android');
    expect(report.recentErrors).toEqual([{ code: 'timeout', count: 2 }]);
    expect(report.ai).toEqual({ onDevice: 0, cloud: 1, deterministic: 0, failed: 0 });
    expect(text).toContain('Area: Making an app');
    expect(text).toContain('Device: Android, Android API 36');
    expect(text).toContain('Recent error codes: timeout (2)');
  });

  it('still builds a report when the activity log cannot be read', async () => {
    const { report } = await collectProblemReport('save', sources({ events: async () => { throw new Error('storage broke'); } }));
    expect(report.ai).toEqual({ onDevice: 0, cloud: 0, deterministic: 0, failed: 0 });
    expect(report.area).toBe('save');
  });

  it('reports usage counting as a setting, not the counts themselves', async () => {
    const mem: TelemetryStore = { read: async () => null, write: async () => undefined };
    const t = createTelemetry(mem);
    await t.setEnabled(true);
    await t.count('apps_created', 'drawing');
    const { text } = await collectProblemReport('other', sources({ usageCounts: t.isEnabled() }));
    expect(text).toContain('Usage counts: on');
    expect(text).not.toContain('drawing');
  });
});

describe('real storage full of private content', () => {
  const SECRETS = [
    'Asha Verma', 'Asha', '4,500', 'Clinic Ledger', 'ask the doctor about my knee', 'passport-scan', 'app_asha_clinic',
    'secret-model-name', 'prompt about my diary', 'task_secret_77',
  ];

  function spec(): KalamSpec {
    return {
      id: 'app_asha_clinic', schemaVersion: '1.0.0', version: 1, name: 'Asha Verma Clinic Ledger', lang: 'en',
      theme: { primary: '#315C4C', radius: 12, fontScale: 1 },
      collections: {
        visits: {
          label: 'Visits',
          fields: {
            patient: { type: 'text', label: 'Patient', required: true, maxLength: 80 },
            owed: { type: 'number', label: 'Owed', min: 0, max: 1_000_000 },
          },
        },
      },
      screens: [{
        id: 'home', title: 'Clinic Ledger', form: 'visits',
        children: [
          { id: 'patient_input', type: 'textInput', label: 'Patient', field: 'patient' },
          { id: 'owed_input', type: 'number', label: 'Owed', field: 'owed' },
          { id: 'save', type: 'bigButton', label: 'Save', action: 'add_visit' },
          { id: 'all', type: 'list', source: 'visits', primary: 'patient', secondary: 'owed' },
        ],
      }],
      initialScreen: 'home',
      actions: { add_visit: { type: 'insert', collection: 'visits' } },
      aiBlocks: {},
      intents: {},
      meta: { createdAt: 1 },
    };
  }

  it('the report, the usage counts and the timings hold none of it', async () => {
    const db = createWebDatabase(`kalam-diagnostics-${Date.now()}`);
    const app: StoredApp = { id: 'app_asha_clinic', spec: spec(), createdAt: 1, updatedAt: 1, origin: { route: 'template', templateId: 'x' } };
    await db.apps.save(app, { summary: 'Created', source: 'create' });
    await db.records.insert('app_asha_clinic', 'visits', { patient: 'Asha Verma passport-scan', owed: 4500 });
    await db.records.insert('app_asha_clinic', 'visits', { patient: 'ask the doctor about my knee', owed: 1 });
    await db.settings.update({ language: 'en' });
    const event = (n: number, extra: Partial<InferenceEvent>): InferenceEvent => ({
      id: `ev_${n}`, at: NOW - n, taskId: 'task_secret_77', taskType: 'create_app', appId: 'app_asha_clinic', route: 'cloud',
      provider: 'firebase', model: 'secret-model-name', source: 'cloud', latencyMs: 700, success: true, fallbackUsed: false,
      escalationReason: 'prompt about my diary', inputChars: 40, ...extra,
    });
    await db.events.add(event(1, {}));
    await db.events.add(event(2, { success: false, errorCode: 'timeout', source: 'on_device' }));

    const errors = createErrorLog();
    errors.note(new Error('Could not save the visit for Asha Verma'));
    errors.note(Object.assign(new Error('prompt about my diary'), { code: 'quota' }));
    const timings = createTimingLog();
    timings.record('record_write', 12.4, { count: 2 });
    timings.record('spec_validate', 3, { ok: false });

    const mem: { saved: string | null } = { saved: null };
    const telemetry = createTelemetry(storageTelemetryStore({
      getItem: async () => mem.saved,
      setItem: async (key, value) => {
        expect(key).toBe(TELEMETRY_STORAGE_KEY);
        mem.saved = value;
      },
    }));
    await telemetry.setEnabled(true);
    await telemetry.count('apps_created', 'text');
    await telemetry.count('error', new Error('Could not save the visit for Asha Verma'));

    const { report, text } = await collectProblemReport('save', {
      ...sources(),
      settings: await db.settings.get(),
      usageCounts: telemetry.isEnabled(),
      errorCodes: () => errors.recent().map((e) => e.code),
      timings: () => timings.summarize(),
      events: (limit) => db.events.list(limit),
    });

    const everything = [JSON.stringify(report), text, telemetry.exportJson(), mem.saved ?? '', JSON.stringify(timings.events())];
    for (const piece of everything) {
      for (const secret of SECRETS) expect(piece, `found "${secret}"`).not.toContain(secret);
    }
    // What it should hold: the two activity events and the two error codes.
    expect(report.ai).toEqual({ onDevice: 1, cloud: 1, deterministic: 0, failed: 1 });
    expect(report.recentErrors.map((e) => e.code).sort()).toEqual(['other', 'quota']);
    expect(report.timings.map((t) => t.name)).toEqual(['spec_validate', 'record_write']);
  });
});

describe('storageTelemetryStore', () => {
  it('reads and writes one key', async () => {
    const data = new Map<string, string>();
    const store = storageTelemetryStore({
      getItem: async (k) => data.get(k) ?? null,
      setItem: async (k, v) => void data.set(k, v),
    });
    expect(await store.read()).toBeNull();
    await store.write('{"a":1}');
    expect(data.get(TELEMETRY_STORAGE_KEY)).toBe('{"a":1}');
    expect(await store.read()).toBe('{"a":1}');
  });

  it('works with a custom key and passes storage failures up for the counters to handle', async () => {
    const store = storageTelemetryStore({ getItem: async () => { throw new Error('blocked'); }, setItem: async () => { throw new Error('full'); } }, 'other.key');
    await expect(store.read()).rejects.toThrow('blocked');
    await expect(store.write('x')).rejects.toThrow('full');
  });
});
