/**
 * The single AI router (docs/07 §9.1). Feature modules call `run()`; they never pick providers.
 * Policy:
 * - consent and connectivity clamp the inference mode, and the capability registry keeps inputs off
 *   an on-device model that cannot take them (routing.ts, docs/07 §14.6);
 * - identical requests in flight share one call, and answers of safe-to-repeat tasks are reused
 *   (cache.ts, docs/07 §16.2). What is shared and stored is the model's raw JSON; every caller runs
 *   its own parser on it;
 * - oversized input is refused before any call, every call has an output token cap per role, and a
 *   run (first call, retries, fallback) fits a time budget of twice its timeout (docs/07 §16.2);
 * - a token bucket per task limits cloud calls, and retriable cloud failures (429, 5xx, network,
 *   timeout) get at most two retries with exponential backoff and full jitter, on the same provider.
 *   The on-device leg and a provider that threw are never retried (limits.ts, docs/04 §11.9);
 * - the one-time cloud notice: while settings.cloudNoticeSeen is not true, the first call that would reach
 *   Firebase (a cloud-only task, a device model that is not ready, or the single cloud fallback) asks
 *   `askCloudNotice`. No OK, no call: the result says Kalam needs the person's OK (AI_COPY.needsCloudOk);
 * - no provider cascades: a failed specialist does NOT go to Firebase or back, and on-device-first
 *   tasks may make one Firebase cloud fallback (lead decision 2). The failed device attempt and the
 *   fallback are two events with one taskId, so on-device metrics count the failure;
 * - the caller's request is never mutated, and every model call is recorded as an InferenceEvent with
 *   its prompt and schema versions, retries, tokens, platform and cache hit (docs/04 §20.2, docs/07 §16.4).
 * Pure TypeScript: providers, storage and network are injected.
 */
import type {
  AICacheRepository, AIErrorCode, AIExecutionResult, AIOrchestrator, AIProvider, InferenceEvent, InferenceEventRepository,
  KalamSettings, ModelRole, NetworkMonitor, OnDeviceStatus, SettingsRepository, StructuredRequest, TaskType,
} from '../contracts';
import { SCHEMA_VERSION } from '../spec/schema';
import { reportError, track } from '../telemetry';
import { CACHEABLE_TASKS, createInflight, createResultCache, requestKey } from './cache';
import { AI_COPY, CLOUD_NOTICE_NOTE } from './copy';
import {
  backoffDelay, createTokenBuckets, DEFAULT_TIMEOUT_MS, inputTooLarge, MIN_ATTEMPT_MS, RETRY_LIMITS, RUN_BUDGET_FACTOR, sleep,
} from './limits';
import { modelForRole, outputTokensFor, promptVersionFor } from './model-config';
import { localStatus, localTaskFor, type LocalStatus, type LocalTask } from './local-ready';
import { deviceGap, isFallback, onDeviceEligible, planRoute, TASK_POLICIES } from './routing';

export interface OrchestratorDeps {
  firebase: AIProvider;
  specialist: AIProvider;
  events: InferenceEventRepository;
  settings: SettingsRepository;
  network: NetworkMonitor;
  now?: () => number;
  /** Ceiling for an on-device availability check before it counts as `unknown`. */
  statusBudgetMs?: number;
  /** Wait before retry number `attempt` (from 0). Default: exponential backoff with full jitter. */
  retryDelayMs?: (attempt: number) => number;
  /**
   * Persistence for reused answers (db.aiCache). Without it they are kept in memory only. Wire it only
   * once the repository can purge rows by app (C1 CONTRACT CHANGE REQUEST), or a deleted app's AI
   * answers stay on disk until LRU eviction.
   */
  aiCache?: AICacheRepository;
  /** false: never reuse a finished answer (evaluation runs that must reach the model every time). */
  cacheResults?: boolean;
  /** false: no client token bucket (evaluation scripts). */
  rateLimit?: boolean;
  /**
   * Platform recorded on events and used with the capability registry. The composition root should
   * pass it from Platform.OS: detection cannot tell iOS from Android.
   */
  platform?: OnDeviceStatus['platform'];
  /**
   * The UI's answer to the one-time cloud notice (docs/03 §23, docs/11 §8.3). Asked, one question at a time,
   * before the first cloud-bound call while settings.cloudNoticeSeen is not true. Resolve true only when the
   * person accepted (the callback also saves cloudNoticeSeen), false for "Not now". It gets the task name and
   * app id, never content. Without it nothing is asked, for scripts and evaluations that have no screen;
   * the app's composition root always passes it.
   */
  /** true: allowed. false: the person said "Not now" (starts a short pause before asking again). undefined: nobody could be asked (no pause). */
  askCloudNotice?: (ask: { taskType: TaskType; appId?: string }) => Promise<boolean | undefined>;
  /** The per-task local-ready gate (docs/07 §6.7). Default: the recorded benchmarks in local-ready.ts. */
  localReady?: (task: LocalTask, platform: OnDeviceStatus['platform']) => LocalStatus;
}

type RunCtx = Parameters<AIOrchestrator['run']>[1];
type Usage = NonNullable<InferenceEvent['tokens']>;
interface RunInfo {
  role: ModelRole;
  promptVersion: string;
  /** Set when the answer may be stored for reuse. */
  cacheKey?: string;
}
/** One execution: its result (output parsed by the parser of the caller that started it) and the raw JSON that parser accepted. */
interface Execution {
  res: AIExecutionResult<unknown>;
  raw?: { value: unknown };
}

const UNKNOWN_DEVICE: OnDeviceStatus = { platform: 'other', apiExposed: false, availability: 'unknown' };
/** Chrome answers `availability()` in milliseconds; anything slower must not hold up the UI or a run. */
const STATUS_BUDGET_MS = 1_500;
/** After "Not now" the notice is not asked again for this long, so a run of voice commands is not a run of prompts. */
export const NOTICE_COOLDOWN_MS = 10 * 60_000;

/** Resolves `fallback` if `p` has not settled within `ms` (or rejects). */
export async function withBudget<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p.catch(() => fallback),
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fallback when the composition root passes no platform. A React Native runtime is reported as
 * Android, which mislabels iOS; `deps.platform` from Platform.OS avoids that.
 */
export function detectPlatform(): OnDeviceStatus['platform'] {
  const g = globalThis as { navigator?: { product?: string }; document?: unknown; HermesInternal?: unknown };
  if (g.navigator?.product === 'ReactNative' || g.HermesInternal !== undefined) return 'android';
  return typeof g.document === 'undefined' ? 'other' : 'web';
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Results made from a provider exception: a single failure, never retried. */
const THROWN = new WeakSet<object>();

async function safeCall<T>(provider: AIProvider, req: StructuredRequest<T>): Promise<AIExecutionResult<T>> {
  try {
    return await provider.generateStructured(req);
  } catch (e) {
    // Providers should not throw; if one does, it is still a normal, recorded failure.
    const res: AIExecutionResult<T> = {
      success: false, provider: provider.name, source: req.mode === 'only_on_device' ? 'on_device' : 'cloud', latencyMs: 0,
      fallbackUsed: false, errorCode: 'provider_error', errorMessage: e instanceof Error ? e.message : String(e),
    };
    THROWN.add(res);
    return res;
  }
}

/** The caller's parser on a shared or stored raw answer. A parser that throws counts as a rejection. */
function parseWith<T>(req: StructuredRequest<T>, raw: unknown): ReturnType<StructuredRequest<T>['parse']> {
  try {
    return req.parse(raw);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The result for one caller of a shared execution. The caller that started it already has its own
 * parsed output; a caller that joined gets the same raw answer through its own parser.
 */
function adopt<T>(shared: Execution, req: StructuredRequest<T>, started: boolean): AIExecutionResult<T> {
  const res = { ...shared.res } as AIExecutionResult<T>;
  if (started || !res.success || !shared.raw) return res;
  const parsed = parseWith(req, shared.raw.value);
  return parsed.success
    ? { ...res, output: parsed.data }
    : { ...res, success: false, output: undefined, errorCode: 'invalid_output', errorMessage: `Model output failed validation: ${parsed.error}` };
}

const CANCELLED: AIExecutionResult<unknown> = {
  success: false, provider: 'none', source: 'deterministic', latencyMs: 0, fallbackUsed: false,
  errorCode: 'cancelled', errorMessage: AI_COPY.cancelled,
};

const finite = (x?: number) => (x !== undefined && Number.isFinite(x) ? x : undefined);
const sum = (a?: number, b?: number) => {
  const x = finite(a);
  const y = finite(b);
  return x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
};
const addUsage = (a: Usage | undefined, b: Usage): Usage => ({ input: sum(a?.input, b.input), output: sum(a?.output, b.output) });
const sizeOf = (v: unknown) => (v === undefined ? undefined : JSON.stringify(v)?.length);

export function createOrchestrator(deps: OrchestratorDeps): AIOrchestrator {
  const now = deps.now ?? Date.now;
  const platform = deps.platform ?? detectPlatform();
  // The platform says online; Connectivity's `can('cloud')` also holds cloud work back briefly after a network failure.
  const cloudOnline = () => (deps.network.can ? deps.network.can('cloud') : deps.network.online());
  // A slow or failed status check still names this platform (iOS showed "other" in Settings, CI run 45615319769).
  const unknownDevice: OnDeviceStatus = { ...UNKNOWN_DEVICE, platform };
  const cache = deps.cacheResults === false ? undefined : createResultCache({ now, store: deps.aiCache });
  const buckets = deps.rateLimit === false ? undefined : createTokenBuckets(now);
  const inflight = createInflight<Execution>(() => ({ res: { ...CANCELLED } }));
  const retryDelay = deps.retryDelayMs ?? ((attempt: number) => backoffDelay(attempt));

  let noticeAccepted = false;
  let noticeDeclinedAt = -Infinity;
  let noticeAsk: Promise<boolean | undefined> | undefined;
  /** True when no notice is owed (seen, accepted, or nothing to ask). Runs that overlap share one question. */
  async function noticeOk(settings: Pick<KalamSettings, 'cloudNoticeSeen'>, ctx: RunCtx): Promise<boolean> {
    const ask = deps.askCloudNotice;
    if (!ask || noticeAccepted || settings.cloudNoticeSeen) return true;
    if (now() - noticeDeclinedAt < NOTICE_COOLDOWN_MS) return false;
    noticeAsk ??= Promise.resolve()
      .then(() => ask({ taskType: ctx.taskType, appId: ctx.appId }))
      .catch(() => undefined)
      .finally(() => { noticeAsk = undefined; });
    const answer = await noticeAsk;
    if (answer === true) noticeAccepted = true;
    // Only a real "Not now" starts the pause. No screen to ask on, or no answer in time, asks again next time.
    else if (answer === false) noticeDeclinedAt = now();
    return answer === true;
  }

  async function record(e: Omit<InferenceEvent, 'id' | 'at'>): Promise<string> {
    const id = newId();
    try {
      await deps.events.add({ id, at: now(), ...e });
    } catch {
      // Observability must never break or fail an inference run.
    }
    // Opt-in local counters (docs/14 §30): a reused answer or a refusal is not AI work, and cancelled
    // or consent-denied runs are the person's own choice, so reportError drops them.
    if (e.success && !e.cacheHit) track('ai_source', e.source);
    else if (!e.success && e.errorCode) reportError(e.errorCode);
    return id;
  }

  async function bumpOnDeviceCount(): Promise<void> {
    try {
      // ponytail: read-then-write can drop a count under concurrent runs; a counter metric tolerates it.
      const s = await deps.settings.get();
      await deps.settings.update({ onDeviceActionCount: s.onDeviceActionCount + 1 });
    } catch {
      /* counter only */
    }
  }

  async function onDeviceStatus(): Promise<OnDeviceStatus> {
    try {
      return await withBudget(deps.firebase.onDeviceStatus(), deps.statusBudgetMs ?? STATUS_BUDGET_MS, {
        ...unknownDevice, detail: 'On-device status check timed out',
      });
    } catch {
      return unknownDevice; // a provider that throws synchronously
    }
  }

  /** Fields every event of a run carries (docs/04 §20.2, docs/07 §3.5, §16.4). */
  function baseEvent(req: StructuredRequest<unknown>, ctx: RunCtx, info: RunInfo) {
    return {
      taskId: newId(), taskType: ctx.taskType, appId: ctx.appId, complexity: ctx.complexity,
      inputChars: req.prompt.length + (req.system?.length ?? 0),
      classificationMethod: ctx.classification?.method, classificationConfidence: ctx.classification?.confidence,
      promptVersion: info.promptVersion, schemaVersion: SCHEMA_VERSION, platform,
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
    };
  }

  /** A stored answer, checked again with the caller's own parser, or undefined. */
  async function fromCache<T>(req: StructuredRequest<T>, ctx: RunCtx, info: RunInfo, key: string): Promise<AIExecutionResult<T> | undefined> {
    const started = now();
    const hit = await cache?.get(key);
    if (!hit) return undefined;
    const parsed = parseWith(req, hit.raw);
    if (!parsed.success) return undefined; // this parser wants another shape: ask the model again
    const latencyMs = now() - started;
    const eventId = await record({
      ...baseEvent(req as StructuredRequest<unknown>, ctx, info), route: hit.source, provider: hit.provider, model: hit.model,
      source: hit.source, latencyMs, success: true, fallbackUsed: false, escalationReason: ctx.escalationReason,
      retries: 0, cacheHit: true, outputChars: sizeOf(parsed.data),
    });
    return {
      success: true, output: parsed.data, provider: hit.provider, source: hit.source, model: hit.model,
      latencyMs, fallbackUsed: false, eventId,
    };
  }

  async function execute(req: StructuredRequest<unknown>, ctx: RunCtx, info: RunInfo): Promise<Execution> {
    const started = now();
    const policy = TASK_POLICIES[ctx.taskType];
    const base = baseEvent(req, ctx, info);
    const join = (...parts: Array<string | undefined>) => parts.filter(Boolean).join('; ') || undefined;

    const stop = async (source: 'on_device' | 'cloud', errorCode: AIErrorCode, errorMessage: string, note?: string): Promise<Execution> => {
      const latencyMs = now() - started;
      const eventId = await record({
        ...base, route: source, provider: 'none', source, latencyMs, success: false, fallbackUsed: false, errorCode,
        escalationReason: join(ctx.escalationReason, note), retries: 0, cacheHit: false,
      });
      return { res: { success: false, provider: 'none', source, latencyMs, fallbackUsed: false, errorCode, errorMessage, eventId } };
    };

    // Prompt length and inline data limits (docs/07 §16.2): refused before any provider sees it.
    const tooLarge = inputTooLarge(req);
    if (tooLarge) return stop(req.mode === 'only_on_device' ? 'on_device' : 'cloud', 'bad_request', AI_COPY.inputTooLarge, tooLarge);

    const settings = await deps.settings.get();
    const localTask = localTaskFor(ctx.taskType, ctx.complexity);
    const localReady = localTask ? (deps.localReady ?? localStatus)(localTask, platform) : undefined;
    const deviceEligible = onDeviceEligible(ctx.taskType, ctx.complexity, localReady);
    const device = deviceEligible ? (await onDeviceStatus()).availability : 'unavailable';
    const decision = planRoute({
      taskType: ctx.taskType,
      requestedMode: req.mode,
      complexity: ctx.complexity,
      escalationReason: ctx.escalationReason,
      settings,
      online: cloudOnline(),
      firebaseConfigured: deps.firebase.isConfigured(),
      specialistConfigured: deps.specialist.isConfigured(),
      onDevice: device,
      deviceLacks: deviceEligible ? deviceGap(platform, req) : undefined,
      localReady,
    });
    if (decision.kind === 'fail') return stop(decision.intended, decision.code, decision.message);

    /** One token per cloud-bound call. Undefined means go ahead. */
    const takeToken = async (): Promise<'quota' | 'cancelled' | undefined> => {
      if (!buckets) return undefined;
      const wait = buckets.reserve(ctx.taskType);
      if (wait < 0) return 'quota';
      await sleep(wait, req.signal);
      return req.signal?.aborted ? 'cancelled' : undefined;
    };

    const provider = decision.kind === 'specialist' ? deps.specialist : deps.firebase;
    const mode = decision.kind === 'firebase' ? decision.mode : 'only_in_cloud';
    const cloudBound = mode !== 'only_on_device' && !(mode === 'prefer_on_device' && device === 'available');
    if (cloudBound) {
      if (!(await noticeOk(settings, ctx))) {
        return req.signal?.aborted
          ? stop('cloud', 'cancelled', AI_COPY.cancelled)
          : stop('cloud', 'consent_denied', AI_COPY.needsCloudOk, CLOUD_NOTICE_NOTE);
      }
      const held = await takeToken();
      if (held === 'quota') return stop('cloud', 'quota', AI_COPY.rateLimited, 'client rate limit reached');
      if (held === 'cancelled') return stop('cloud', 'cancelled', AI_COPY.cancelled);
    }

    // Per-task execution budget (docs/07 §16.2): later attempts only get the time that is left.
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = started + RUN_BUDGET_FACTOR * timeoutMs;
    /** Timeout for a later attempt that starts after `waitMs`, or 0 when too little time is left. */
    const timeLeft = (waitMs = 0): number => {
      const left = deadline - now() - waitMs;
      return left >= Math.min(MIN_ATTEMPT_MS, timeoutMs) ? Math.min(timeoutMs, left) : 0;
    };

    const usage: { tokens?: Usage } = {};
    const call: StructuredRequest<unknown> = {
      ...req,
      mode,
      role: info.role,
      timeoutMs,
      maxOutputTokens: outputTokensFor(info.role, req.maxOutputTokens),
      onUsage: (u) => {
        usage.tokens = addUsage(usage.tokens, u);
        req.onUsage?.(u);
      },
    };
    /** One provider call. Keeps the raw JSON the caller's parser accepted, for sharing and reuse. */
    const attempt = async (over: Pick<StructuredRequest<unknown>, 'mode' | 'timeoutMs'>): Promise<Execution> => {
      const seen: { raw?: { value: unknown } } = {};
      const res = await safeCall(provider, {
        ...call,
        ...over,
        parse: (value) => {
          const parsed = req.parse(value);
          if (parsed.success) seen.raw = { value };
          return parsed;
        },
      });
      return { res, raw: res.success ? seen.raw : undefined };
    };

    let legStarted = started;
    let out = await attempt({ mode, timeoutMs });
    let retries = 0;
    const notes: string[] = [];
    let needsOk = false;
    const first = out.res;
    const localFailure = !first.success && first.source === 'on_device' && first.errorCode !== 'cancelled' && !req.signal?.aborted;
    if (localFailure && decision.kind === 'firebase' && mode === 'prefer_on_device' && (policy.cloudFallback || policy.localWhenReady)) {
      // planRoute keeps prefer_on_device only when cloud is allowed, so this is the one permitted
      // fallback (lead decision 2). Whatever the cloud answers is final: no retry, no cascade.
      const failed = `on-device failed (${first.errorCode ?? 'error'})`;
      const noticeMissing = !(await noticeOk(settings, ctx));
      const held = noticeMissing ? undefined : await takeToken();
      const left = timeLeft();
      if (noticeMissing) {
        needsOk = !req.signal?.aborted;
        notes.push(`${failed}; cloud fallback skipped, the cloud notice is not accepted`);
      } else if (held === 'quota') {
        notes.push(`${failed}; cloud fallback skipped by the client rate limit`);
      } else if (held !== 'cancelled' && !left) {
        notes.push(`${failed}; no time left for the cloud fallback`);
      } else if (held !== 'cancelled') {
        // The failed device attempt is an event of its own, so on-device metrics count it (docs/13 §9.2).
        await record({
          ...base, route: 'on_device', provider: first.provider, model: first.model, source: 'on_device', latencyMs: now() - started,
          success: false, fallbackUsed: false, errorCode: first.errorCode,
          escalationReason: join(ctx.escalationReason, decision.note), retries: 0, cacheHit: false,
        });
        notes.push(`${failed}; one Firebase cloud fallback`);
        legStarted = now();
        out = await attempt({ mode: 'only_in_cloud', timeoutMs: left });
      }
    } else {
      const after: AIErrorCode[] = [];
      for (;;) {
        const { res } = out;
        if (res.success || !res.errorCode || res.source === 'on_device' || THROWN.has(res) || req.signal?.aborted) break;
        if (retries >= (req.maxRetries?.[res.errorCode] ?? RETRY_LIMITS[res.errorCode] ?? 0)) break;
        const wait = retryDelay(retries);
        const left = timeLeft(wait);
        if (!left) {
          notes.push('run time budget spent, no more retries');
          break;
        }
        after.push(res.errorCode);
        await sleep(wait, req.signal);
        if (req.signal?.aborted) break;
        retries += 1;
        out = await attempt({ mode, timeoutMs: left });
      }
      if (retries) notes.push(`retried ${retries === 1 ? 'once' : `${retries} times`} after ${[...new Set(after)].join(', ')}`);
    }
    let res = out.res;
    if (!res.success && req.signal?.aborted) res = { ...res, errorCode: 'cancelled', errorMessage: AI_COPY.cancelled };

    const source = res.source;
    const fallbackUsed = res.success && source !== 'deterministic' && isFallback(req.mode, source);
    const route: InferenceEvent['route'] = decision.kind === 'specialist'
      ? 'specialist'
      : res.success && source !== 'deterministic' ? source : mode === 'only_on_device' ? 'on_device' : 'cloud';
    const escalationReason = join(
      ctx.escalationReason,
      decision.note && decision.note !== ctx.escalationReason ? decision.note : undefined,
      fallbackUsed ? `hybrid fallback to ${source}` : undefined,
      ...notes,
    );

    const eventId = await record({
      ...base, route, provider: res.provider, model: res.model, source, latencyMs: now() - legStarted, success: res.success, fallbackUsed,
      escalationReason, errorCode: res.errorCode, retries, cacheHit: false, outputChars: sizeOf(res.output),
      ...(usage.tokens ? { tokens: usage.tokens } : {}),
    });
    if (res.success && source === 'on_device' && policy.userFacing) await bumpOnDeviceCount();
    const p = res.provider;
    const raw = res.success ? out.raw : undefined;
    if (info.cacheKey && raw && source !== 'deterministic' && (p === 'firebase' || p === 'claude' || p === 'nebius')) {
      cache?.set(info.cacheKey, { raw: raw.value, provider: p, source, ...(res.model ? { model: res.model } : {}) }, ctx.taskType, ctx.appId);
    }
    // The event keeps the real on-device failure; the caller is told what would help.
    const answer = needsOk ? { ...res, errorCode: 'consent_denied' as const, errorMessage: AI_COPY.needsCloudOk } : res;
    return { res: { ...answer, latencyMs: now() - started, fallbackUsed, eventId }, raw };
  }

  const orchestrator: AIOrchestrator = {
    async run<T>(req: StructuredRequest<T>, ctx: RunCtx): Promise<AIExecutionResult<T>> {
      const role = req.role ?? TASK_POLICIES[ctx.taskType].role;
      const info: RunInfo = { role, promptVersion: promptVersionFor(role) };
      if (req.signal?.aborted) return adopt(await execute(req, ctx, info), req, true);
      const key = requestKey(req as StructuredRequest<unknown>, {
        taskType: ctx.taskType, role, mode: req.mode, appId: ctx.appId, escalationReason: ctx.escalationReason,
        promptVersion: info.promptVersion, model: modelForRole(role),
      });
      // only_on_device must really run on the device (privacy mode, on-device verification).
      const reusable = !!cache && CACHEABLE_TASKS.has(ctx.taskType) && req.mode !== 'only_on_device';
      if (reusable) {
        const hit = await fromCache(req, ctx, info, key);
        if (hit) return hit;
      }
      // The key does not cover the parser, so joiners share the raw answer, not the parsed one.
      const mine: { execution?: Execution } = {};
      const shared = await inflight.run(key, req.signal, async (signal) => {
        mine.execution = await execute({ ...req, signal }, ctx, { ...info, cacheKey: reusable ? key : undefined });
        return mine.execution;
      });
      return adopt(shared, req, shared === mine.execution);
    },

    async recordDeterministic(e) {
      await record({ platform, schemaVersion: SCHEMA_VERSION, ...e, provider: 'deterministic', source: 'deterministic', fallbackUsed: false });
    },

    async status() {
      return {
        onDevice: await onDeviceStatus(),
        cloudConfigured: deps.firebase.isConfigured(),
        online: cloudOnline(),
        specialistConfigured: deps.specialist.isConfigured(),
      };
    },

    async prepareOnDevice(onProgress) {
      return deps.firebase.prepareOnDevice ? deps.firebase.prepareOnDevice(onProgress) : onDeviceStatus();
    },

    async warmUpOnDevice() {
      try {
        return deps.firebase.warmUpOnDevice ? await deps.firebase.warmUpOnDevice() : await onDeviceStatus();
      } catch {
        return unknownDevice; // warm-up is best effort
      }
    },
  };
  return orchestrator;
}
