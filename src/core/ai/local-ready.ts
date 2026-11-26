/**
 * Per-task local-ready benchmark gate (docs/07 §6.7, §20.4, §20.5).
 *
 * "A task should only be marked local-ready when it passes its benchmark." Nothing here marks a task ready by
 * hand: a task is `ready` only when a recorded benchmark of the task on that platform clears every threshold,
 * `failed` when a measured result misses one, and `unproven` when there is no run, too few cases, or the
 * offline check was not done. The status is always computed from the numbers, so a record cannot claim
 * more than it measured. Routing treats `failed` as "do not use the device model for this task" and lets the
 * simple-app local attempt run only when `ready` (routing.ts). `unproven` keeps today's behaviour for the
 * tasks that already prefer the device, and is shown as unproven rather than hidden.
 *
 * Add a record only from a real run: `node scripts/local-ready.mjs --task <task> --cdp-port 9333` prints the
 * record and writes the raw run to docs/evidence. Pure data and pure functions: no SDK, no network.
 */
import { z } from 'zod';
import type { ComplexityLevel, OnDeviceStatus, TaskType } from '../contracts';

/** Tasks the router may hand to the device model, plus the local attempt at a simple app without a template. */
export const LOCAL_TASKS = [
  'classify', 'summarize', 'translate', 'voice_action', 'generate_patch', 'extract_data', 'extract_template_params',
  'create_simple_app',
] as const;
export type LocalTask = (typeof LOCAL_TASKS)[number];
export type LocalStatus = 'ready' | 'unproven' | 'failed';
export type LocalPlatform = Exclude<OnDeviceStatus['platform'], 'other'>;

/** The gate key for a task run. Only a simple app counts as the local attempt; every other create_app is cloud work. */
export function localTaskFor(taskType: TaskType, complexity?: ComplexityLevel): LocalTask | undefined {
  if (taskType === 'create_app') return complexity === 'simple' ? 'create_simple_app' : undefined;
  return (LOCAL_TASKS as readonly string[]).includes(taskType) ? (taskType as LocalTask) : undefined;
}

/** One measured run of one task on one platform. Counts, not rates, so the numbers can be checked. */
export const localBenchmarkSchema = z.object({
  task: z.enum(LOCAL_TASKS),
  platform: z.enum(['web', 'android', 'ios']),
  /** Model and device, plain text, for example "gemini-nano, Chrome 157". */
  model: z.string().min(1),
  /** YYYY-MM-DD of the run. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cases: z.number().int().min(1),
  /** Answers that passed the task's schema. */
  schemaValid: z.number().int().min(0),
  /** Schema-valid answers that were right. */
  correct: z.number().int().min(0),
  /** Answers that invented something the request did not contain. */
  hallucinated: z.number().int().min(0),
  p95LatencyMs: z.number().min(0),
  /** Ran with the network off. Absent: not checked, so the task cannot be ready. */
  offlineOk: z.boolean().optional(),
  /** Where the raw run is kept, for example docs/evidence/local-ready-classify-web-2026-11-26.json. */
  evidence: z.string().min(1),
}).refine((b) => b.schemaValid <= b.cases && b.correct <= b.schemaValid && b.hallucinated <= b.cases, 'counts do not add up');
export type LocalBenchmark = z.infer<typeof localBenchmarkSchema>;

export interface LocalGate {
  /** Fewer cases than this is not evidence either way. */
  minCases: number;
  /** Rate of answers that pass the schema (docs/07 §20.4: at least 95% for local structured output). */
  schemaValid: number;
  /** Rate of cases answered correctly. */
  accuracy: number;
  /** Highest allowed rate of invented content. */
  hallucination: number;
  /** 95th percentile latency, ms. */
  p95LatencyMs: number;
}

const gate = (accuracy: number, p95LatencyMs: number, hallucination = 0.05): LocalGate =>
  ({ minCases: 20, schemaValid: 0.95, accuracy, hallucination, p95LatencyMs });

/**
 * Thresholds per task, never averaged across tasks (docs/07 §20.4). The schema rate is the document's 95% target;
 * the others are proposed engineering targets: a small edit must not touch unrelated content, so its bar is highest.
 */
export const LOCAL_GATES: Readonly<Record<LocalTask, LocalGate>> = {
  classify: gate(0.85, 4_000),
  extract_template_params: gate(0.9, 6_000),
  voice_action: gate(0.85, 10_000),
  translate: gate(0.9, 15_000),
  summarize: gate(0.8, 15_000),
  extract_data: gate(0.9, 15_000),
  generate_patch: gate(0.95, 15_000, 0.02),
  create_simple_app: gate(0.9, 30_000),
};

export interface GateResult {
  status: LocalStatus;
  /** Plain reasons, empty when ready. */
  reasons: string[];
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/** Pure verdict for one record. */
export function evaluateGate(b: LocalBenchmark, gates: Readonly<Record<LocalTask, LocalGate>> = LOCAL_GATES): GateResult {
  const g = gates[b.task];
  if (b.cases < g.minCases) return { status: 'unproven', reasons: [`only ${b.cases} cases, ${g.minCases} needed`] };
  const missed: string[] = [];
  const valid = b.schemaValid / b.cases;
  if (valid < g.schemaValid) missed.push(`schema-valid ${pct(valid)}, needs ${pct(g.schemaValid)}`);
  const right = b.correct / b.cases;
  if (right < g.accuracy) missed.push(`correct ${pct(right)}, needs ${pct(g.accuracy)}`);
  const invented = b.hallucinated / b.cases;
  if (invented > g.hallucination) missed.push(`invented content ${pct(invented)}, allows ${pct(g.hallucination)}`);
  if (b.p95LatencyMs > g.p95LatencyMs) missed.push(`p95 ${Math.round(b.p95LatencyMs)} ms, allows ${g.p95LatencyMs} ms`);
  if (b.offlineOk === false) missed.push('did not work offline');
  if (missed.length) return { status: 'failed', reasons: missed };
  if (b.offlineOk === undefined) return { status: 'unproven', reasons: ['offline run not checked'] };
  return { status: 'ready', reasons: [] };
}

/**
 * Recorded runs, newest decide. Each is a real run of `node scripts/local-ready.mjs --task <task> --offline` against Gemini Nano in
 * Chrome with the tab's network off; the raw run is the file named in `evidence`. Not benchmarked yet, so unproven: extract_data,
 * generate_patch, extract_template_params, create_simple_app (no case set), and every task on Android and iOS (needs a phone).
 * A `failed` record keeps that task off the device on that platform until a better run replaces it (routing.ts), by design: the gates
 * are the proposed targets of docs/07 section 20.4 and can be changed in LOCAL_GATES. Do not add a record that was not measured.
 *
 * 2026-11-26 results on Chrome 158, web: voice_action ready; classify 83.3 percent against 85 (84 cases, the tie-break set); summarize
 * 60 percent, with some answers drifting into other languages (the cloud model got 90 percent on the same notes); translate 75 percent for English to Spanish and Japanese,
 * the only languages Chrome's Prompt API speaks besides English.
 */
export const LOCAL_EVIDENCE: readonly LocalBenchmark[] = [
  { task: 'classify', platform: 'web', model: 'gemini-nano, Chrome/158.0.0.0', date: '2026-11-26', cases: 84, schemaValid: 84, correct: 70, hallucinated: 0, p95LatencyMs: 1854, offlineOk: true,
    evidence: 'docs/evidence/local-ready-classify-web-2026-11-26.json' },
  { task: 'voice_action', platform: 'web', model: 'gemini-nano, Chrome/158.0.0.0', date: '2026-11-26', cases: 23, schemaValid: 23, correct: 21, hallucinated: 1, p95LatencyMs: 3826, offlineOk: true,
    evidence: 'docs/evidence/local-ready-voice_action-web-2026-11-26.json' },
  { task: 'summarize', platform: 'web', model: 'gemini-nano, Chrome/158.0.0.0', date: '2026-11-26', cases: 20, schemaValid: 20, correct: 12, hallucinated: 0, p95LatencyMs: 5362, offlineOk: true,
    evidence: 'docs/evidence/local-ready-summarize-web-2026-11-26.json' },
  { task: 'translate', platform: 'web', model: 'gemini-nano, Chrome/158.0.0.0', date: '2026-11-26', cases: 20, schemaValid: 20, correct: 15, hallucinated: 0, p95LatencyMs: 2567, offlineOk: true,
    evidence: 'docs/evidence/local-ready-translate-web-2026-11-26.json' },
];

/** The status of one task on one platform from the newest record, or `unproven` with no record. */
export function localStatus(
  task: LocalTask,
  platform: OnDeviceStatus['platform'],
  evidence: readonly LocalBenchmark[] = LOCAL_EVIDENCE,
): LocalStatus {
  const newest = evidence
    .filter((r) => r.task === task && r.platform === platform)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return newest ? evaluateGate(newest).status : 'unproven';
}
