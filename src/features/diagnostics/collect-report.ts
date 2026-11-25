/**
 * Gathers what a problem report needs from the app and hands it to the content-free builder in
 * report.ts. Every source is passed in, so the rules are tested without a device. Nothing here
 * reads an app, an entry, a prompt or a file: the sources are the recent error codes, the timing
 * summaries, the activity log (only `source` and `success` are read from it) and a few settings.
 */
import type { InferenceEvent, KalamSettings } from '@/core/contracts';
import type { TimingSummary } from '@/core/observability';

import { buildProblemReport, formatProblemReport, type ProblemReport, type ReportArea, type ReportInput } from './report';

/** How many recent activity events feed the AI line of the report. */
export const REPORT_EVENT_LIMIT = 200;

export interface DeviceInfo {
  appVersion: string;
  platform: 'web' | 'android' | 'ios' | 'other';
  osVersion: string;
}

export interface ReportSources {
  now(): number;
  device: DeviceInfo;
  settings: Partial<KalamSettings>;
  usageCounts: boolean;
  /** Newest first. */
  errorCodes(): readonly unknown[];
  timings(): readonly TimingSummary[];
  /** The activity log. May fail, for example when storage cannot be read. */
  events(limit: number): Promise<readonly InferenceEvent[]>;
}

export interface CollectedReport {
  report: ProblemReport;
  /** The exact text the person reads before sharing. */
  text: string;
}

export async function collectProblemReport(area: ReportArea, sources: ReportSources): Promise<CollectedReport> {
  let inference: ReportInput['inference'] = [];
  try {
    inference = await sources.events(REPORT_EVENT_LIMIT);
  } catch {
    // A report is most needed when something is broken. Leave the AI line at zero instead of failing.
  }
  const report = buildProblemReport({
    now: sources.now(),
    area,
    appVersion: sources.device.appVersion,
    platform: sources.device.platform,
    osVersion: sources.device.osVersion,
    settings: sources.settings,
    usageCounts: sources.usageCounts,
    errorCodes: sources.errorCodes(),
    timings: sources.timings(),
    inference,
  });
  return { report, text: formatProblemReport(report) };
}
