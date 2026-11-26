/**
 * The user-initiated problem report (docs/11 §17.3: stable codes, sanitized messages, minimal
 * context; "a user should be able to report a failure without automatically sending their
 * application data"). Pure TypeScript.
 *
 * Content-free by construction. The builder does not copy what it is given: it reads a short list of
 * known fields and keeps a value only if it is a number, a boolean, a code from a closed list, or a
 * string that fits a strict format (a version number, a browser name). There is no free-text field,
 * so a prompt, a record value, an app name or a file name has nowhere to go.
 */
import type { KalamSettings } from '@/core/contracts';
import { LIMITS_POLICY_VERSION } from '@/core/limits';
import { TIMING_NAMES, toErrorCode, type ErrorCode, type TimingName, type TimingSummary } from '@/core/observability';

import { diagnosticsCopy } from './copy';

export const REPORT_AREAS = ['create', 'open', 'save', 'voice', 'other'] as const;
export type ReportArea = (typeof REPORT_AREAS)[number];
export type ReportPlatform = 'web' | 'android' | 'ios' | 'other';

export interface ReportInput {
  area?: unknown;
  appVersion?: unknown;
  platform?: unknown;
  osVersion?: unknown;
  /** Epoch milliseconds. */
  now: number;
  /** Read for a few enum and boolean fields only. */
  settings?: Partial<KalamSettings>;
  usageCounts?: boolean;
  /** Newest first. Only codes on the closed list survive; anything else counts as `other`. */
  errorCodes?: readonly unknown[];
  timings?: readonly TimingSummary[];
  /** Activity events. Only `source` and `success` are read. */
  inference?: ReadonlyArray<{ source?: unknown; success?: unknown }>;
}

export interface ProblemReport {
  createdAt: string;
  area: ReportArea;
  appVersion: string;
  /** Version of the limits policy this build enforces (core/limits). A constant, never read from the device. */
  limitsVersion: string;
  platform: ReportPlatform;
  osVersion: string;
  recentErrors: Array<{ code: ErrorCode; count: number }>;
  timings: TimingSummary[];
  ai: { onDevice: number; cloud: number; deterministic: number; failed: number };
  settings: {
    aiMode: 'hybrid' | 'offline_only' | 'unknown';
    colorScheme: 'system' | 'light' | 'dark' | 'unknown';
    reducedMotion: 'system' | 'on' | 'off' | 'unknown';
    language: string;
    flags: {
      cloudAllowed: boolean;
      otherProvidersAllowed: boolean;
      largeText: boolean;
      highContrast: boolean;
      simple: boolean;
      readAloud: boolean;
      leftHanded: boolean;
      voiceOnly: boolean;
      keepRecordings: boolean;
      usageCounts: boolean;
    };
  };
}

const MAX_CODES_READ = 100;
const MAX_ERROR_ROWS = 10;
const MAX_EVENTS_READ = 500;
const MAX_TIMING_ROWS = 20;

const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}(-[0-9A-Za-z.]{1,16})?$/;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const BROWSERS = ['Chrome', 'Edge', 'Firefox', 'Safari', 'Opera', 'Browser'];
const SYSTEMS = ['Windows', 'Android', 'iOS', 'macOS', 'Linux', 'ChromeOS', 'another system'];
const OS_FORMAT = new RegExp(`^(unknown|Android API \\d{1,3}|iOS \\d{1,3}|(${BROWSERS.join('|')})( \\d{1,4})? on (${SYSTEMS.join('|')}))$`);

const BROWSER_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['Edge', /Edg\/(\d+)/], ['Opera', /OPR\/(\d+)/], ['Firefox', /Firefox\/(\d+)/],
  ['Chrome', /(?:Chrome|CriOS)\/(\d+)/], ['Safari', /Version\/(\d+)[\s\S]*Safari/],
];
const SYSTEM_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['Android', /Android/], ['iOS', /iPhone|iPad|iPod/], ['Windows', /Windows/], ['macOS', /Mac OS X|Macintosh/],
  ['ChromeOS', /CrOS/], ['Linux', /Linux|X11/],
];

/** "Chrome 131 on Windows". Only a browser name, its major number and a system name come out. */
export function describeUserAgent(ua: unknown): string {
  if (typeof ua !== 'string' || !ua) return 'unknown';
  let browser = 'Browser';
  for (const [name, pattern] of BROWSER_RULES) {
    const major = pattern.exec(ua)?.[1];
    if (major) {
      browser = `${name} ${Math.min(Number(major), 9999)}`;
      break;
    }
  }
  const system = SYSTEM_RULES.find(([, pattern]) => pattern.test(ua))?.[0] ?? 'another system';
  return `${browser} on ${system}`;
}

/**
 * The system line for the report: "Android API 36", "iOS 17", or a browser and system on web.
 * `version` is `Platform.Version` (a number on Android, text like "17.4" on iOS). Only a whole
 * number of one to three digits comes out, so no device name can.
 */
export function describeOs(platform: unknown, version: unknown, userAgent?: unknown): string {
  if (platform === 'web') return describeUserAgent(userAgent);
  const text = String(version ?? '');
  if (platform === 'android') return /^\d{1,3}$/.test(text) ? `Android API ${Number(text)}` : 'unknown';
  const major = /^(\d{1,3})(\.\d{1,4}){0,3}$/.exec(text)?.[1];
  return platform === 'ios' && major ? `iOS ${Number(major)}` : 'unknown';
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | 'unknown' {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : 'unknown';
}

const whole = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1_000_000_000 ? v : undefined;
const tenths = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 3_600_000 ? Math.round(v * 10) / 10 : undefined;

function cleanTimings(rows: readonly unknown[] | undefined): TimingSummary[] {
  const out: TimingSummary[] = [];
  for (const row of (rows ?? []).slice(0, MAX_TIMING_ROWS)) {
    const r = (row ?? {}) as Record<string, unknown>;
    const name = (TIMING_NAMES as readonly unknown[]).includes(r.name) ? (r.name as TimingName) : undefined;
    const runs = whole(r.runs);
    const failed = whole(r.failed);
    const medianMs = tenths(r.medianMs);
    const p95Ms = tenths(r.p95Ms);
    const maxMs = tenths(r.maxMs);
    if (name && runs !== undefined && failed !== undefined && medianMs !== undefined && p95Ms !== undefined && maxMs !== undefined) {
      out.push({ name, runs, failed, medianMs, p95Ms, maxMs });
    }
  }
  return out;
}

function cleanErrors(codes: readonly unknown[] | undefined): ProblemReport['recentErrors'] {
  const counts = new Map<ErrorCode, number>();
  for (const raw of (codes ?? []).slice(0, MAX_CODES_READ)) {
    if (raw === undefined || raw === null) continue;
    const code = toErrorCode(raw);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, MAX_ERROR_ROWS);
}

function cleanAi(events: ReportInput['inference']): ProblemReport['ai'] {
  const ai = { onDevice: 0, cloud: 0, deterministic: 0, failed: 0 };
  for (const e of (events ?? []).slice(0, MAX_EVENTS_READ)) {
    if (e?.source === 'on_device') ai.onDevice += 1;
    else if (e?.source === 'cloud') ai.cloud += 1;
    else if (e?.source === 'deterministic') ai.deterministic += 1;
    if (e?.success === false) ai.failed += 1;
  }
  return ai;
}

export function buildProblemReport(input: ReportInput): ProblemReport {
  const s = input.settings ?? {};
  const modes: Partial<KalamSettings['accessModes']> = s.accessModes ?? {};
  const language = typeof s.language === 'string' && LANGUAGE.test(s.language) ? s.language : 'unknown';
  return {
    createdAt: Number.isFinite(input.now) ? new Date(input.now).toISOString() : 'unknown',
    area: REPORT_AREAS.includes(input.area as ReportArea) ? (input.area as ReportArea) : 'other',
    appVersion: typeof input.appVersion === 'string' && VERSION.test(input.appVersion) ? input.appVersion : 'unknown',
    limitsVersion: LIMITS_POLICY_VERSION,
    platform: input.platform === 'web' || input.platform === 'android' || input.platform === 'ios' ? input.platform : 'other',
    osVersion: typeof input.osVersion === 'string' && OS_FORMAT.test(input.osVersion) ? input.osVersion : 'unknown',
    recentErrors: cleanErrors(input.errorCodes),
    timings: cleanTimings(input.timings),
    ai: cleanAi(input.inference),
    settings: {
      aiMode: oneOf(['hybrid', 'offline_only'] as const, s.aiMode),
      colorScheme: oneOf(['system', 'light', 'dark'] as const, s.colorScheme),
      reducedMotion: oneOf(['system', 'on', 'off'] as const, s.reducedMotion),
      language,
      flags: {
        cloudAllowed: s.allowCloud === true,
        otherProvidersAllowed: s.allowExternalProviders === true,
        largeText: modes.large === true,
        highContrast: modes.highContrast === true,
        simple: modes.simple === true,
        readAloud: modes.readAloud === true,
        leftHanded: modes.leftHanded === true,
        voiceOnly: modes.voiceOnly === true,
        keepRecordings: s.speech?.keepRecordings === true,
        usageCounts: input.usageCounts === true,
      },
    },
  };
}

/** The exact text the person reads, then shares or copies. */
export function formatProblemReport(report: ProblemReport): string {
  const c = diagnosticsCopy.report;
  const label = c.settingLabels;
  const flag = (on: boolean) => (on ? c.on : c.off);
  const f = report.settings.flags;
  const errors = report.recentErrors.length
    ? report.recentErrors.map((e) => (e.count > 1 ? `${e.code} (${e.count})` : e.code)).join(', ')
    : c.none;
  const timings = report.timings.length
    ? report.timings.map((t) => `  ${c.timingRow(diagnosticsCopy.timings.names[t.name], t.runs, t.medianMs, t.p95Ms, t.failed)}`)
    : [`  ${c.none}`];
  const { ai } = report;
  return [
    c.title,
    `${c.created}: ${report.createdAt}`,
    `${c.area}: ${diagnosticsCopy.problem.areas[report.area]}`,
    `${c.version}: ${report.appVersion}`,
    `${c.limits}: ${report.limitsVersion}`,
    `${c.device}: ${c.platforms[report.platform]}, ${report.osVersion}`,
    `${c.errors}: ${errors}`,
    `${c.timings}:`,
    ...timings,
    `${c.ai}: ${c.aiLine(ai.onDevice, ai.cloud, ai.deterministic, ai.failed)}`,
    `${c.settings}:`,
    `  ${label.aiMode}: ${report.settings.aiMode}`,
    `  ${label.colorScheme}: ${report.settings.colorScheme}`,
    `  ${label.reducedMotion}: ${report.settings.reducedMotion}`,
    `  ${label.language}: ${report.settings.language}`,
    `  ${label.cloudAllowed}: ${flag(f.cloudAllowed)}`,
    `  ${label.otherProvidersAllowed}: ${flag(f.otherProvidersAllowed)}`,
    `  ${label.largeText}: ${flag(f.largeText)}`,
    `  ${label.highContrast}: ${flag(f.highContrast)}`,
    `  ${label.simple}: ${flag(f.simple)}`,
    `  ${label.readAloud}: ${flag(f.readAloud)}`,
    `  ${label.leftHanded}: ${flag(f.leftHanded)}`,
    `  ${label.voiceOnly}: ${flag(f.voiceOnly)}`,
    `  ${label.keepRecordings}: ${flag(f.keepRecordings)}`,
    `  ${label.usageCounts}: ${flag(f.usageCounts)}`,
    '',
    c.footer,
  ].join('\n');
}
