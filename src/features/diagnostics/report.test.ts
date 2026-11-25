import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type InferenceEvent, type KalamSettings } from '@/core/contracts';
import type { TimingSummary } from '@/core/observability';

import { diagnosticsCopy } from './copy';
import { buildProblemReport, describeOs, describeUserAgent, formatProblemReport, REPORT_AREAS } from './report';
import { copyOnly, shareOrCopy } from './share-logic';

const NOW = Date.parse('2026-11-18T10:00:00Z');

/** Things that must never appear in a report: they stand for records, prompts, names and file names. */
const SECRETS = [
  'Asha Verma', 'Asha', '4,500', 'clinic', 'make me an app', 'passport-scan', 'app_secret123', 'rec_9f2', 'task_77',
  'ghp_tokenvalue', 'my diary entry',
];

const goodTimings: TimingSummary[] = [
  { name: 'app_open', runs: 3, failed: 0, medianMs: 40, p95Ms: 130, maxMs: 130 },
  { name: 'record_write', runs: 12, failed: 1, medianMs: 6.2, p95Ms: 20, maxMs: 22 },
];

describe('buildProblemReport', () => {
  it('collects version, platform, system, errors, timings and settings flags', () => {
    const report = buildProblemReport({
      now: NOW,
      area: 'save',
      appVersion: '1.2.3',
      platform: 'android',
      osVersion: 'Android API 36',
      settings: { ...DEFAULT_SETTINGS, allowCloud: false, accessModes: { ...DEFAULT_SETTINGS.accessModes, large: true, voiceOnly: true } },
      usageCounts: true,
      errorCodes: ['timeout', 'offline', 'timeout', undefined, null, 'record_limit'],
      timings: goodTimings,
      inference: [
        { source: 'on_device', success: true }, { source: 'cloud', success: false }, { source: 'deterministic', success: true },
        { source: 'on_device', success: true },
      ],
    });
    expect(report).toEqual({
      createdAt: '2026-11-18T10:00:00.000Z',
      area: 'save',
      appVersion: '1.2.3',
      platform: 'android',
      osVersion: 'Android API 36',
      recentErrors: [{ code: 'timeout', count: 2 }, { code: 'offline', count: 1 }, { code: 'record_limit', count: 1 }],
      timings: goodTimings,
      ai: { onDevice: 2, cloud: 1, deterministic: 1, failed: 1 },
      settings: {
        aiMode: 'hybrid', colorScheme: 'system', reducedMotion: 'system', language: 'en',
        flags: {
          cloudAllowed: false, otherProvidersAllowed: false, largeText: true, highContrast: false, simple: false,
          readAloud: false, leftHanded: false, voiceOnly: true, keepRecordings: false, usageCounts: true,
        },
      },
    });
  });

  it('survives empty input with safe defaults', () => {
    const report = buildProblemReport({ now: Number.NaN });
    expect(report.createdAt).toBe('unknown');
    expect(report.area).toBe('other');
    expect(report.appVersion).toBe('unknown');
    expect(report.platform).toBe('other');
    expect(report.osVersion).toBe('unknown');
    expect(report.recentErrors).toEqual([]);
    expect(report.timings).toEqual([]);
    expect(report.ai).toEqual({ onDevice: 0, cloud: 0, deterministic: 0, failed: 0 });
    expect(report.settings.aiMode).toBe('unknown');
    expect(() => formatProblemReport(report)).not.toThrow();
  });

  it('accepts every report area and nothing else', () => {
    for (const area of REPORT_AREAS) expect(buildProblemReport({ now: NOW, area }).area).toBe(area);
    expect(buildProblemReport({ now: NOW, area: 'my clinic app broke' }).area).toBe('other');
  });
});

describe('the report holds no content', () => {
  /** Settings, events, timings and codes all stuffed with records and prompts. */
  function fuzzedInput() {
    const settings = {
      ...DEFAULT_SETTINGS,
      language: 'Asha Verma clinic',
      aiMode: 'make me an app for my clinic',
      colorScheme: 'my diary entry',
      reducedMotion: 'passport-scan.jpg',
      accessModes: { ...DEFAULT_SETTINGS.accessModes, large: true, note: 'Asha owes 4,500' },
      speech: { sttLanguage: 'en-IN', ttsLanguage: 'en-IN', rate: 1, keepRecordings: true, voiceId: 'Asha Verma' },
      records: [{ id: 'rec_9f2', values: { name: 'Asha Verma', owes: '4,500' } }],
      prompt: 'make me an app for my clinic',
      authToken: 'ghp_tokenvalue',
    } as unknown as Partial<KalamSettings>;
    const inference = [
      {
        id: 'ev1', at: NOW, taskId: 'task_77', taskType: 'create_app', appId: 'app_secret123', route: 'cloud', provider: 'firebase',
        model: 'gemini', source: 'cloud', latencyMs: 900, success: false, fallbackUsed: false, errorCode: 'timeout',
        escalationReason: 'make me an app for my clinic', inputChars: 30,
      } satisfies InferenceEvent,
      { source: 'on_device', success: true, appId: 'app_secret123', prompt: 'Asha Verma', value: '4,500' },
    ];
    return {
      now: NOW,
      area: 'make me an app for my clinic',
      appVersion: 'Asha Verma 1.0',
      platform: 'Asha Verma laptop',
      osVersion: 'Windows 11 Asha Verma PC passport-scan',
      settings,
      usageCounts: true,
      errorCodes: [
        'Could not save the order for Asha Verma', new Error('rec_9f2 failed: my diary entry'),
        { code: 'Asha', message: 'make me an app' }, { message: 'ghp_tokenvalue' }, 'timeout', 42, ['clinic'],
      ] as unknown[],
      timings: [
        { ...goodTimings[0], appId: 'app_secret123', note: 'Asha Verma' },
        { name: 'open Asha Verma clinic', runs: 1, failed: 0, medianMs: 1, p95Ms: 1, maxMs: 1 },
        { name: 'app_open', runs: 'many', failed: 0, medianMs: 1, p95Ms: 1, maxMs: 1 },
        null,
      ] as unknown as TimingSummary[],
      inference,
    };
  }

  it('drops every secret from the data and from the text', () => {
    const report = buildProblemReport(fuzzedInput());
    const data = JSON.stringify(report);
    const text = formatProblemReport(report);
    for (const secret of SECRETS) {
      expect(data, `data has ${secret}`).not.toContain(secret);
      expect(text, `text has ${secret}`).not.toContain(secret);
    }
    expect(report.appVersion).toBe('unknown');
    expect(report.platform).toBe('other');
    expect(report.osVersion).toBe('unknown');
    expect(report.area).toBe('other');
    expect(report.settings.aiMode).toBe('unknown');
    expect(report.settings.language).toBe('unknown');
    // Only the one well-formed timing row and the known error codes remain.
    expect(report.timings).toEqual([goodTimings[0]]);
    expect(report.recentErrors.map((e) => e.code).sort()).toEqual(['other', 'timeout']);
  });

  it('has only the fields a report is meant to have', () => {
    const report = buildProblemReport(fuzzedInput());
    expect(Object.keys(report).sort()).toEqual(
      ['ai', 'appVersion', 'area', 'createdAt', 'osVersion', 'platform', 'recentErrors', 'settings', 'timings'],
    );
    expect(Object.keys(report.settings).sort()).toEqual(['aiMode', 'colorScheme', 'flags', 'language', 'reducedMotion']);
    expect(Object.keys(report.settings.flags)).toHaveLength(10);
    for (const t of report.timings) expect(Object.keys(t).sort()).toEqual(['failed', 'maxMs', 'medianMs', 'name', 'p95Ms', 'runs']);
  });

  it('reads only source and success from activity events', () => {
    const report = buildProblemReport(fuzzedInput());
    expect(report.ai).toEqual({ onDevice: 1, cloud: 1, deterministic: 0, failed: 1 });
  });

  it('every line of the text is made from copy and short codes, numbers and versions', () => {
    const text = formatProblemReport(buildProblemReport({
      now: NOW, area: 'open', appVersion: '1.0.0', platform: 'web', osVersion: 'Chrome 131 on Windows',
      settings: DEFAULT_SETTINGS, errorCodes: ['quota'], timings: goodTimings, inference: [],
    }));
    expect(text).toBe([
      'Kalam problem report',
      'Created: 2026-11-18T10:00:00.000Z',
      'Area: Opening an app',
      'Kalam version: 1.0.0',
      'Device: web, Chrome 131 on Windows',
      'Recent error codes: quota',
      'Timings:',
      '  Opening an app: 3 runs, usual 40 ms, slowest 130 ms',
      '  Saving an entry: 12 runs, usual 6.2 ms, slowest 20 ms, 1 failed',
      'AI work: on this device 0, in the cloud 0, plain app logic 0, failed 0',
      'Settings:',
      '  AI mode: hybrid',
      '  Theme: system',
      '  Motion: system',
      '  Language: en',
      '  Cloud AI allowed: on',
      '  Other AI providers allowed: off',
      '  Large text: off',
      '  High contrast: off',
      '  Simple mode: off',
      '  Read aloud: off',
      '  Left handed: off',
      '  Voice only: off',
      '  Keep recordings: off',
      '  Usage counts: off',
      '',
      diagnosticsCopy.report.footer,
    ].join('\n'));
  });

  it('keeps the error list short and sorted by how often each code happened', () => {
    const codes = ['quota', 'timeout', 'timeout', 'offline', 'offline', 'offline'];
    const report = buildProblemReport({ now: NOW, errorCodes: codes });
    expect(report.recentErrors).toEqual([
      { code: 'offline', count: 3 }, { code: 'timeout', count: 2 }, { code: 'quota', count: 1 },
    ]);
    const many = buildProblemReport({ now: NOW, errorCodes: Array.from({ length: 500 }, () => 'timeout') });
    expect(many.recentErrors).toEqual([{ code: 'timeout', count: 100 }]);
  });
});

describe('describeUserAgent', () => {
  it('reduces a user agent to a browser, its major number and a system', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'))
      .toBe('Chrome 131 on Windows');
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36 Edg/130.0.2849.5'))
      .toBe('Edge 130 on Windows');
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'))
      .toBe('Chrome 130 on Android');
    expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15'))
      .toBe('Safari 17 on macOS');
    expect(describeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0')).toBe('Firefox 125 on Linux');
  });

  it('never returns a device name or an unknown string, and its output is accepted by the report', () => {
    expect(describeUserAgent('Pixel 8 of Asha Verma')).toBe('Browser on another system');
    expect(describeUserAgent('')).toBe('unknown');
    expect(describeUserAgent(undefined)).toBe('unknown');
    const ua = describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.0.0 Safari/537.36');
    expect(buildProblemReport({ now: NOW, osVersion: ua }).osVersion).toBe(ua);
    expect(buildProblemReport({ now: NOW, osVersion: describeUserAgent('Pixel 8 of Asha Verma') }).osVersion).toBe('Browser on another system');
  });
});

describe('describeOs and iOS', () => {
  it('gives an API level on Android, a major number on iOS and a browser line on web', () => {
    expect(describeOs('android', 36)).toBe('Android API 36');
    expect(describeOs('android', '34')).toBe('Android API 34');
    expect(describeOs('ios', '17.4.1')).toBe('iOS 17');
    expect(describeOs('web', undefined, 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.0.0 Safari/537.36')).toBe('Chrome 131 on Windows');
    expect(describeOs('web', undefined, undefined)).toBe('unknown');
  });

  it('never lets a device name through, and what it returns the report accepts', () => {
    expect(describeOs('android', 'Pixel 8 of Asha Verma')).toBe('unknown');
    expect(describeOs('ios', 'Asha iPhone')).toBe('unknown');
    expect(describeOs('windows', 11)).toBe('unknown');
    expect(describeOs('android', 1_000_000)).toBe('unknown');
    for (const os of [describeOs('android', 36), describeOs('ios', '17.4'), describeOs('web', 0, 'Chrome/131.0 Windows')]) {
      expect(buildProblemReport({ now: NOW, osVersion: os }).osVersion).toBe(os);
    }
  });

  it('accepts ios as a platform and prints it by name', () => {
    const report = buildProblemReport({ now: NOW, platform: 'ios', osVersion: 'iOS 17' });
    expect(report.platform).toBe('ios');
    expect(formatProblemReport(report)).toContain('Device: iOS, iOS 17');
  });
});

describe('sharing', () => {
  it('shares when the share sheet works', async () => {
    const copy = vi.fn();
    expect(await shareOrCopy('text', { share: async () => 'shared', copy })).toBe('shared');
    expect(copy).not.toHaveBeenCalled();
  });

  it('does not copy behind the persons back when the share sheet is closed', async () => {
    const copy = vi.fn();
    expect(await shareOrCopy('text', { share: async () => 'dismissed', copy })).toBe('cancelled');
    expect(copy).not.toHaveBeenCalled();
  });

  it('copies when there is no share sheet, and reports a failed copy', async () => {
    const copy = vi.fn(async () => undefined);
    expect(await shareOrCopy('text', { share: async () => { throw new Error('unsupported'); }, copy })).toBe('copied');
    expect(copy).toHaveBeenCalledWith('text');
    expect(await shareOrCopy('text', { share: async () => { throw new Error('x'); }, copy: async () => { throw new Error('y'); } })).toBe('failed');
    expect(await copyOnly('text', { copy })).toBe('copied');
  });
});
