/**
 * Per-run AI evidence the person can export (docs/17 §5.4, D17-029): for each model run, which platform, which model, where
 * it ran (device or cloud) and how long it took. This is what shows that a hybrid build really used both legs.
 * Pure TypeScript.
 *
 * Content-free by construction, like the problem report: the builder does not copy an event. It reads a short list of
 * known fields and keeps a value only when it is a number, a boolean, a name from a closed list, or a string in a strict
 * format (a model name, a version). Prompts, answers, app ids, app names and free-text notes have nowhere to go, so an
 * export can be pasted into an issue or a submission without reading it twice.
 */
import type { AIErrorCode, AIProviderName, InferenceEvent, InferenceSource, OnDeviceStatus, TaskType } from '@/core/contracts';

import type { ReportPlatform } from './report';

export const EVIDENCE_KIND = 'kalam-inference-evidence';
export const EVIDENCE_VERSION = 1;
/** Newest events kept in one export. */
export const EVIDENCE_MAX_EVENTS = 200;

const TASKS = [
  'create_app', 'modify_app', 'interpret_sketch', 'generate_patch', 'extract_data', 'classify', 'summarize', 'translate',
  'voice_action', 'verify_ai_block', 'safety_review', 'extract_template_params', 'repair_spec', 'plan_app',
] as const satisfies readonly TaskType[];
const ROUTES = ['deterministic', 'template', 'on_device', 'cloud', 'specialist'] as const satisfies readonly InferenceEvent['route'][];
const SOURCES = ['deterministic', 'on_device', 'cloud'] as const satisfies readonly InferenceSource[];
const PROVIDERS = ['firebase', 'claude', 'nebius', 'deterministic', 'none'] as const satisfies readonly AIProviderName[];
const ERRORS = [
  'offline', 'consent_denied', 'model_unavailable', 'not_configured', 'timeout', 'invalid_output', 'provider_error', 'quota',
  'unsupported_modality', 'cancelled', 'app_check_failed', 'bad_request',
] as const satisfies readonly AIErrorCode[];
const PLATFORMS = ['web', 'android', 'ios', 'other'] as const;
const AVAILABILITY = ['unavailable', 'downloadable', 'downloading', 'available', 'unknown'] as const;

/** A model name such as gemini-3.8-flash, or a prompt or schema version such as compiler-v1 or 1.1.0. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
/** Ids this app makes for a creation session: a prefix, then one to three parts of lowercase letters and digits. */
const SESSION = /^[a-z]{2,12}(?:_[a-z0-9]{4,24}){1,3}$/;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}(-[0-9A-Za-z.]{1,16})?$/;

export interface EvidenceRow {
  /** ISO time the run was recorded. */
  at: string;
  platform: ReportPlatform;
  task: TaskType | 'other';
  route: InferenceEvent['route'] | 'other';
  source: InferenceSource | 'other';
  provider: AIProviderName | 'other';
  model?: string;
  latencyMs: number;
  success: boolean;
  /** The device was asked first and the cloud answered instead (or the reverse for a cloud-first task). */
  fallback: boolean;
  cacheHit?: boolean;
  error?: AIErrorCode | 'other';
  retries?: number;
  tokens?: { input?: number; output?: number };
  promptVersion?: string;
  schemaVersion?: string;
  sessionId?: string;
}

export interface EvidenceSourceSummary {
  runs: number;
  failed: number;
  medianMs: number;
  slowestMs: number;
}

export interface EvidenceExport {
  kind: typeof EVIDENCE_KIND;
  version: typeof EVIDENCE_VERSION;
  createdAt: string;
  appVersion: string;
  platform: ReportPlatform;
  /** What the on-device model reported when the export was made. */
  onDevice?: { apiExposed: boolean; availability: (typeof AVAILABILITY)[number] };
  summary: Partial<Record<InferenceSource, EvidenceSourceSummary>>;
  events: EvidenceRow[];
}

export interface EvidenceInput {
  now: number;
  appVersion?: unknown;
  platform?: unknown;
  onDevice?: Pick<OnDeviceStatus, 'apiExposed' | 'availability'>;
  /** Newest first, as the activity log returns them. */
  events: readonly unknown[];
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
const orOther = <T extends string>(list: readonly T[], v: unknown): T | 'other' => oneOf(list, v) ?? 'other';
const count = (v: unknown, max = 1_000_000_000): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined;
const named = (v: unknown, pattern: RegExp): string | undefined => (typeof v === 'string' && pattern.test(v) ? v : undefined);

function row(raw: unknown): EvidenceRow | undefined {
  const e = (raw ?? {}) as Record<string, unknown>;
  const at = typeof e.at === 'number' && Number.isFinite(e.at) && e.at > 0 ? new Date(e.at) : undefined;
  const latencyMs = count(e.latencyMs, 3_600_000);
  if (!at || Number.isNaN(at.getTime()) || latencyMs === undefined) return undefined;
  const tokens = (e.tokens ?? {}) as Record<string, unknown>;
  const input = count(tokens.input);
  const output = count(tokens.output);
  const model = named(e.model, NAME);
  const promptVersion = named(e.promptVersion, NAME);
  const schemaVersion = named(e.schemaVersion, VERSION);
  const sessionId = named(e.sessionId, SESSION);
  const retries = count(e.retries, 20);
  const error = e.errorCode === undefined ? undefined : orOther(ERRORS, e.errorCode);
  return {
    at: at.toISOString(),
    platform: oneOf(PLATFORMS, e.platform) ?? 'other',
    task: orOther(TASKS, e.taskType),
    route: orOther(ROUTES, e.route),
    source: orOther(SOURCES, e.source),
    provider: orOther(PROVIDERS, e.provider),
    ...(model ? { model } : {}),
    latencyMs,
    success: e.success === true,
    fallback: e.fallbackUsed === true,
    ...(typeof e.cacheHit === 'boolean' ? { cacheHit: e.cacheHit } : {}),
    ...(error ? { error } : {}),
    ...(retries !== undefined ? { retries } : {}),
    ...(input !== undefined || output !== undefined ? { tokens: { ...(input !== undefined ? { input } : {}), ...(output !== undefined ? { output } : {}) } } : {}),
    ...(promptVersion ? { promptVersion } : {}),
    ...(schemaVersion ? { schemaVersion } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function summarise(rows: readonly EvidenceRow[]): EvidenceExport['summary'] {
  const out: EvidenceExport['summary'] = {};
  for (const source of SOURCES) {
    const mine = rows.filter((r) => r.source === source);
    if (!mine.length) continue;
    const times = mine.map((r) => r.latencyMs).sort((a, b) => a - b);
    out[source] = { runs: mine.length, failed: mine.filter((r) => !r.success).length, medianMs: median(times), slowestMs: times.at(-1)! };
  }
  return out;
}

export function buildEvidenceExport(input: EvidenceInput): EvidenceExport {
  const events = input.events.slice(0, EVIDENCE_MAX_EVENTS).map(row).filter((r): r is EvidenceRow => !!r);
  const availability = oneOf(AVAILABILITY, input.onDevice?.availability);
  return {
    kind: EVIDENCE_KIND,
    version: EVIDENCE_VERSION,
    createdAt: Number.isFinite(input.now) ? new Date(input.now).toISOString() : 'unknown',
    appVersion: named(input.appVersion, VERSION) ?? 'unknown',
    platform: oneOf(PLATFORMS, input.platform) ?? 'other',
    ...(availability ? { onDevice: { apiExposed: input.onDevice?.apiExposed === true, availability } } : {}),
    summary: summarise(events),
    events,
  };
}

/** The JSON the person reads, copies or shares. */
export const formatEvidenceJson = (x: EvidenceExport): string => JSON.stringify(x, null, 2);
