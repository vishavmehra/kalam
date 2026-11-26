/** Pure aggregation and naming of inference events for the Activity dashboard (no React; unit-tested). */
import type { ComplexityLevel, InferenceEvent, InferenceSource, TaskType } from '@/core/contracts';
import type { TranslationKey } from '@/i18n/keys';
import type { TFunction } from '@/i18n/translator';

export interface SourceSummary {
  source: InferenceSource;
  count: number;
  succeeded: number;
  medianLatencyMs: number | null;
  /** Slowest 5% boundary (docs/13 §9.2): what a slow day feels like. */
  p95LatencyMs: number | null;
}

export interface ActivitySummary {
  total: number;
  /** In display order: on-device, cloud, deterministic. */
  bySource: SourceSummary[];
  /** Events where a provider fell back (e.g. on-device → cloud). */
  fallbacks: number;
  failures: number;
  /** Why work left the device, most frequent first. */
  escalations: Array<{ reason: string; count: number }>;
  /** Usage ledger (docs/07 §16.4, §19.3), from events that report it. */
  retries: number;
  tokensIn: number;
  tokensOut: number;
  cacheHits: number;
}

export const SOURCE_ORDER: readonly InferenceSource[] = ['on_device', 'cloud', 'deterministic'];

export function median(values: readonly number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Nearest-rank percentile (p in 0..100) of finite values, or null when there are none. */
export function percentile(values: readonly number[], p: number): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const rank = Math.min(v.length, Math.max(1, Math.ceil((p / 100) * v.length)));
  return v[rank - 1];
}

export function summarize(events: readonly InferenceEvent[]): ActivitySummary {
  const bySource = SOURCE_ORDER.map((source): SourceSummary => {
    // Reused answers (cache hits) are not runs: they would pull the median latency towards zero (C1).
    const es = events.filter((e) => e.source === source && !e.cacheHit);
    return {
      source,
      count: es.length,
      succeeded: es.filter((e) => e.success).length,
      medianLatencyMs: median(es.map((e) => e.latencyMs)),
      p95LatencyMs: percentile(es.map((e) => e.latencyMs), 95),
    };
  });
  const reasons = new Map<string, number>();
  for (const e of events) {
    const r = e.escalationReason?.trim();
    if (r) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  return {
    total: events.length,
    bySource,
    fallbacks: events.filter((e) => e.fallbackUsed).length,
    failures: events.filter((e) => !e.success).length,
    escalations: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    retries: events.reduce((n, e) => n + (e.retries ?? 0), 0),
    tokensIn: events.reduce((n, e) => n + (e.tokens?.input ?? 0), 0),
    tokensOut: events.reduce((n, e) => n + (e.tokens?.output ?? 0), 0),
    cacheHits: events.filter((e) => e.cacheHit).length,
  };
}

/** Task types the Activity screen names in the person's language; anything newer falls back to plain words. */
const TASK_KEY: Record<TaskType, TranslationKey> = {
  create_app: 'activity.task.create_app', modify_app: 'activity.task.modify_app', interpret_sketch: 'activity.task.interpret_sketch',
  generate_patch: 'activity.task.generate_patch', extract_data: 'activity.task.extract_data', classify: 'activity.task.classify',
  summarize: 'activity.task.summarize', translate: 'activity.task.translate', voice_action: 'activity.task.voice_action',
  verify_ai_block: 'activity.task.verify_ai_block', safety_review: 'activity.task.safety_review',
  extract_template_params: 'activity.task.extract_template_params', repair_spec: 'activity.task.repair_spec', plan_app: 'activity.task.plan_app',
};

/** "extract_template_params" in the UI language, or "Extract template params" for a task type with no key yet. */
export function taskName(task: string, t: TFunction): string {
  const key = TASK_KEY[task as TaskType];
  if (key) return t(key);
  const s = task.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const COMPLEXITY_KEY: Record<ComplexityLevel, TranslationKey> = {
  simple: 'activity.complexity.simple', medium: 'activity.complexity.medium', complex: 'activity.complexity.complex',
};

/** 'unknown' is what the metrics use for events that did not record a platform. */
const PLATFORM_KEY: Record<NonNullable<InferenceEvent['platform']> | 'unknown', TranslationKey> = {
  web: 'activity.platform.web', android: 'activity.platform.android', ios: 'activity.platform.ios', other: 'activity.platform.otherDevice',
  unknown: 'activity.platform.unknown',
};

export function platformName(platform: string, t: TFunction): string {
  const key = PLATFORM_KEY[platform as keyof typeof PLATFORM_KEY];
  return key ? t(key) : platform;
}

/** Whole notes the orchestrator and the pipelines write into `escalationReason` (English, joined with "; "). */
const REASON_KEY: Record<string, TranslationKey> = {
  'complex request': 'activity.reason.complexRequest',
  'external provider consented': 'activity.reason.externalConsented',
  'cloud compiler required but unavailable': 'activity.reason.compilerUnavailable',
  'template parameters incomplete': 'activity.reason.templateIncomplete',
  'template produced an invalid spec': 'activity.reason.templateInvalid',
  'on-device translation failed': 'activity.reason.translationFailed',
  'task requires cloud reasoning': 'activity.reason.needsCloud',
  'cloud fallback skipped by the client rate limit': 'activity.reason.rateLimited',
  'no time left for the cloud fallback': 'activity.reason.noTime',
  'one Firebase cloud fallback': 'activity.reason.cloudFallback',
  'run time budget spent, no more retries': 'activity.reason.budgetSpent',
  'hybrid fallback to cloud': 'activity.reason.toCloud',
  'hybrid fallback to on_device': 'activity.reason.toDevice',
};

/** The deterministic helpers note what they did as `<helper>: <why>`. */
const HELPER_KEY: Record<string, TranslationKey> = {
  assistant: 'activity.reason.assistant', 'formula helper': 'activity.reason.formula', reports: 'activity.reason.reports',
};
const WHY_KEY: Record<string, TranslationKey> = {
  'help from the spec': 'activity.reason.why.fromSpec',
  'rule-based calculation': 'activity.reason.why.ruleCalc',
  'rule-based formula': 'activity.reason.why.ruleFormula',
  'period a formula cannot express': 'activity.reason.why.period',
  refused: 'activity.reason.why.refused',
  'nothing to explain, plain sentence': 'activity.reason.why.nothing',
  'offline, plain sentence': 'activity.reason.why.offline',
  'no model available, plain sentence': 'activity.reason.why.noModel',
};

function reasonPart(part: string, t: TFunction): string {
  const key = REASON_KEY[part];
  if (key) return t(key);
  if (/^cloud unavailable \(.+\)$/.test(part)) return t('activity.reason.cloudUnavailable');
  if (/^on-device model lacks /.test(part)) return t('activity.reason.deviceLacks');
  if (/^on-device failed \(.+\)$/.test(part)) return t('activity.reason.deviceFailed');
  const retried = /^retried (once|(\d+) times) after /.exec(part);
  if (retried) return t('activity.reason.retried', { count: retried[2] ? Number(retried[2]) : 1 });
  const skipped = /^build-time check not done for (\d+) AI step/.exec(part);
  if (skipped) return t('activity.reason.checkSkipped', { count: Number(skipped[1]) });
  const helper = /^(assistant|formula helper|reports): (.+)$/.exec(part);
  if (helper) {
    const why = WHY_KEY[helper[2]];
    return t(HELPER_KEY[helper[1]], { why: why ? t(why) : helper[2] });
  }
  return part; // a note this screen does not know yet: shown as written
}

/**
 * An escalation reason in the UI language. Reasons are English notes joined with "; "; each known note is
 * translated and anything unknown is kept as written. Never holds user content (docs/07 §16.4).
 */
export function describeReason(reason: string, t: TFunction): string {
  return reason.split(';').map((p) => p.trim()).filter(Boolean).map((p) => reasonPart(p, t)).join('; ');
}

/** Share of `part` in `whole` as a whole-number percentage string. */
export function percent(part: number, whole: number): string {
  if (!whole) return '0%';
  const p = (part / whole) * 100;
  return `${p > 0 && p < 1 ? '<1' : Math.round(p)}%`;
}
