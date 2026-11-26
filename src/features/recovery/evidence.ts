/**
 * Hybrid-run evidence the person can save (docs/17 §5.4, D17-029): for each AI run, the task kind,
 * platform, model, where it actually ran, whether it finished, how long the model took and any error
 * code. Pure TypeScript.
 *
 * Content-free by construction. Each run is built field by field from the activity event and then must
 * pass a strict Zod schema made of closed lists, small numbers and short names. Free text on the event
 * (`escalationReason`), the app id and the event id are never read. A run that fails the schema is
 * left out and counted in `skippedRuns`, never repaired. Nothing here sends anything: the file is built
 * when the person asks and goes where they put it.
 *
 * Local steps and model time are kept apart on purpose (docs/06 §17.3): `modelLatencyMs` on a run is the
 * model call only, and `localSteps` are timings of work on this device. Neither includes the other.
 */
import { z } from 'zod';

import { hybridMetrics, type HybridMetrics } from '@/core/ai/metrics';
import { TASK_POLICIES } from '@/core/ai/routing';
import type { InferenceEvent } from '@/core/contracts';
import type { TimingSummary } from '@/core/observability';
import { buildProblemReport } from '@/features/diagnostics/report';

export const EVIDENCE_SCHEMA = 'kalam.hybrid-evidence/1';
/** Newest runs kept in one file. */
export const EVIDENCE_RUN_LIMIT = 500;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const LABEL = /^[A-Za-z0-9._:/-]{1,64}$/;
const whole = z.number().int().min(0).max(1_000_000_000);
const PLATFORMS = ['web', 'android', 'ios', 'other', 'unknown'] as const;
const ERRORS = [
  'offline', 'consent_denied', 'model_unavailable', 'not_configured', 'timeout', 'invalid_output', 'provider_error', 'quota',
  'unsupported_modality', 'cancelled', 'app_check_failed', 'bad_request',
] as const;

export const evidenceRunSchema = z.object({
  taskId: z.string().regex(ID),
  task: z.enum(Object.keys(TASK_POLICIES) as [string, ...string[]]),
  at: z.number().int().min(0).max(8_640_000_000_000_000),
  platform: z.enum(PLATFORMS),
  /** Where the work really ran. */
  source: z.enum(['deterministic', 'on_device', 'cloud']),
  route: z.enum(['deterministic', 'template', 'on_device', 'cloud', 'specialist']),
  provider: z.enum(['firebase', 'claude', 'nebius', 'deterministic', 'none']),
  model: z.string().regex(LABEL).optional(),
  promptVersion: z.string().regex(LABEL).optional(),
  schemaVersion: z.string().regex(LABEL).optional(),
  completed: z.boolean(),
  /** The model call only. */
  modelLatencyMs: z.number().min(0).max(3_600_000),
  fallbackUsed: z.boolean(),
  cacheHit: z.boolean(),
  retries: whole.optional(),
  error: z.enum(ERRORS).optional(),
  tokens: z.object({ input: whole.optional(), output: whole.optional() }).strict().optional(),
  inputChars: whole.optional(),
  outputChars: whole.optional(),
}).strict();
export type EvidenceRun = z.infer<typeof evidenceRunSchema>;

export interface HybridEvidence {
  schema: typeof EVIDENCE_SCHEMA;
  createdAt: string;
  appVersion: string;
  limitsVersion: string;
  platform: 'web' | 'android' | 'ios' | 'other';
  osVersion: string;
  /** Oldest first. */
  runs: EvidenceRun[];
  /** Events that did not pass the schema and were left out. */
  skippedRuns: number;
  summary: HybridMetrics;
  /** Work done on this device, not model time. */
  localSteps: TimingSummary[];
  latencyBasis: string;
}

export interface EvidenceInput {
  /** Any order. Only the newest `EVIDENCE_RUN_LIMIT` are used. */
  events: readonly InferenceEvent[];
  timings: readonly TimingSummary[];
  device: { appVersion: unknown; platform: unknown; osVersion: unknown };
  /** Epoch milliseconds. */
  now: number;
}

const opt = <T>(value: T | undefined | null): T | undefined => (value === null ? undefined : value);

function runOf(e: InferenceEvent): unknown {
  const tokens = e.tokens ? { input: opt(e.tokens.input), output: opt(e.tokens.output) } : undefined;
  return {
    taskId: e.taskId,
    task: e.taskType,
    at: e.at,
    platform: e.platform ?? 'unknown',
    source: e.source,
    route: e.route,
    provider: e.provider,
    model: opt(e.model),
    promptVersion: opt(e.promptVersion),
    schemaVersion: opt(e.schemaVersion),
    completed: e.success,
    modelLatencyMs: e.latencyMs,
    fallbackUsed: e.fallbackUsed,
    cacheHit: e.cacheHit === true,
    retries: opt(e.retries),
    error: opt(e.errorCode),
    ...(tokens ? { tokens } : {}),
    inputChars: opt(e.inputChars),
    outputChars: opt(e.outputChars),
  };
}

export function buildEvidence(input: EvidenceInput): HybridEvidence {
  const newest = [...input.events].sort((a, b) => b.at - a.at).slice(0, EVIDENCE_RUN_LIMIT).reverse();
  const runs: EvidenceRun[] = [];
  const kept: InferenceEvent[] = [];
  for (const e of newest) {
    const parsed = evidenceRunSchema.safeParse(runOf(e));
    if (!parsed.success) continue;
    runs.push(parsed.data);
    kept.push({ ...e, platform: parsed.data.platform === 'unknown' ? undefined : parsed.data.platform });
  }
  // The report builder already checks the version, the platform and the system line against strict formats.
  const device = buildProblemReport({
    now: input.now, appVersion: input.device.appVersion, platform: input.device.platform, osVersion: input.device.osVersion,
    timings: input.timings,
  });
  return {
    schema: EVIDENCE_SCHEMA,
    createdAt: device.createdAt,
    appVersion: device.appVersion,
    limitsVersion: device.limitsVersion,
    platform: device.platform,
    osVersion: device.osVersion,
    runs,
    skippedRuns: newest.length - runs.length,
    summary: hybridMetrics(kept),
    localSteps: device.timings,
    latencyBasis: 'modelLatencyMs is the model call only. localSteps are measured on this device and are not part of it.',
  };
}

export const evidenceJson = (evidence: HybridEvidence): string => JSON.stringify(evidence, null, 2);

/** The file name for the saved evidence, from the export day. */
export function evidenceFileName(now: number): string {
  const day = new Date(now);
  return `kalam-hybrid-evidence-${Number.isNaN(day.getTime()) ? 'unknown' : day.toISOString().slice(0, 10)}.json`;
}
