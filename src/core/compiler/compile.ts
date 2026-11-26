/**
 * Firebase cloud compiler (docs/07 §11, CP5): request IR → convert → validate → at most ONE
 * repair pass → validated KalamSpec, or a plain-language failure with clarifications.
 * Never returns an invalid spec. Optional specialist planning (Claude/Nebius, consented) only
 * produces a constrained plan; Firebase stays the compiler (docs/07 §6.4, §11.5).
 */
import type { ZodType } from 'zod';
import { AI_COPY, needsCloudOk } from '../ai/copy';
import { toJsonSchema as defaultToJsonSchema } from '../ai/json-schema';
import type {
  AIErrorCode, AIExecutionResult, AIOrchestrator, AIProviderName, CompileAttempt, CompilerRequest, CreationStage, InferenceMode,
  InferenceSource, NormalizedInput, SpecIssue, TaskClassification, TaskType, ValidateSpec, ValidationResult,
} from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { validateSpec as defaultValidate } from '../spec/validate';
import { completeSpec } from './complete';
import { irToSpec } from './convert';
import { appPlanSchema, compilerIRSchema, zodParser, type AppPlan, type CompilerIR } from './ir';
import { normalizeIR } from './normalize';
import {
  COMPILER_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT, buildCompilerPrompt, buildRepairPrompt, collectImages,
  hasVisualInput, wrapUntrusted,
} from './prompt';

export type JsonSchemaFn = (schema: ZodType) => Record<string, unknown>;

export interface CompileDeps {
  ai: AIOrchestrator;
  appId: string;
  now?: () => number;
  validate?: ValidateSpec;
  toJsonSchema?: JsonSchemaFn;
  /**
   * The typed hand-off (docs/06 §13.2). Its sessionId is recorded on every model call of this build. Built by
   * `buildCompilerRequest`; without it the calls carry no session.
   */
  request?: CompilerRequest;
  /** True only when the user consented to external providers AND one is configured. */
  useSpecialistPlan?: boolean;
  signal?: AbortSignal;
  onStage?: (stage: CreationStage, detail?: string) => void;
}

export interface CompileOutcome {
  ok: boolean;
  spec?: KalamSpec;
  route: 'cloud' | 'cloud+repair';
  provider: AIProviderName;
  model?: string;
  source?: InferenceSource;
  errors: SpecIssue[];
  warnings: SpecIssue[];
  assumptions: string[];
  message?: string;
  clarifications?: string[];
  errorCode?: AIErrorCode;
  usedPlan: boolean;
  /** Each pass in order, with its stage and exact validator codes (docs/13 §6.1, §21). */
  attempts?: CompileAttempt[];
}

/**
 * Output budget for a compile or a repair pass: the compiler role's ceiling (model-config.ts). At 8192 the
 * repair of a large app ran out and returned cut-off JSON (eval 2026-11-25).
 */
const OUTPUT_TOKENS = 16_384;
/**
 * Wait for a compile or a repair. A large app is up to 16k tokens of JSON and took 100 s or more to write (eval 2026-11-25: s25 repair and mx03
 * both ran out of 90 s). A timeout is not retried (`maxRetries`): it would double the wait, and the repair pass is the retry.
 */
const COMPILE_TIMEOUT_MS = 150_000;
const SLOW_CALL = { timeout: 0 } as const;

function categoryOf(code: AIErrorCode | undefined, pass: CompileAttempt['pass']): CompileAttempt['category'] {
  switch (code) {
    case 'offline': return 'NETWORK_UNAVAILABLE';
    case 'timeout': return 'INFERENCE_TIMEOUT';
    case 'quota': return 'RATE_LIMITED';
    case 'invalid_output': return pass === 'repair' ? 'REPAIR_FAILED' : 'OUTPUT_INVALID';
    default: return 'INFERENCE_FAILED';
  }
}

/** Everything the person typed, said or wrote on a sketch, for the deterministic repair. */
export function requestText(input: NormalizedInput): string {
  const d = input.drawing;
  return [
    input.text, input.audioTranscript ?? '', input.video?.summary ?? '',
    ...(d?.texts ?? []), ...(d?.elements.map((e) => e.label ?? '') ?? []),
  ].join('\n');
}

/** A request for separate users: roles, logins, permissions. Not "admin" or "log in" alone ("log in my workouts"). */
const ROLES = /\b(?:roles?|logins?|sign[ -]?in|permissions?|only see (?:their|his|her|my) own|access control|multi.?user)\b/i;
/** Access words in an assumption: who may see or change what. */
const ACCESS = /\b(?:roles?|logins?|permissions?|access|only see|can see|cannot see|restricted)\b/i;
/** A claim that something enforces that access. Kalam apps run on one device; nothing does. */
const ENFORCED = /\b(?:server|backend|runtime|enforc\w*)\b/i;
const ROLES_NOTE = 'Kalam apps run on one device for one person, so logins and roles are not built. Anyone holding this device sees every entry.';

/**
 * Drops assumptions that claim access is enforced (mx05 "roles are enforced by a runtime or server policy"),
 * and says plainly what was left out. "Late fee policy is set by the admin" is about the app's data and stays.
 */
export function honestAssumptions(assumptions: readonly string[] | undefined, request: string): string[] {
  const out = (assumptions ?? []).filter((a) => !(ACCESS.test(a) && ENFORCED.test(a)));
  if (ROLES.test(request) && !out.includes(ROLES_NOTE)) out.push(ROLES_NOTE);
  return out;
}

/**
 * Warnings the compiler treats as errors. A stored app with one of them still opens; a new app must not have
 * them, so the cloud repair pass is asked to fix them.
 */
const BLOCKING_WARNINGS: ReadonlySet<string> = new Set(['NO_OP_UPDATE']);

function strict(v: ValidationResult): ValidationResult {
  const block = v.warnings.filter((w) => BLOCKING_WARNINGS.has(w.code));
  if (!block.length) return v;
  return {
    ...v, ok: false, spec: undefined,
    errors: [...v.errors, ...block.map((w) => ({ ...w, severity: 'error' as const }))],
    warnings: v.warnings.filter((w) => !BLOCKING_WARNINGS.has(w.code)),
  };
}

/** Sketches, other visual input and complex apps must use cloud; otherwise prefer it. */
export function compileMode(input: NormalizedInput, c: TaskClassification): InferenceMode {
  return hasVisualInput(input) || c.requiresMultimodalReasoning || c.complexity === 'complex'
    ? 'only_in_cloud'
    : 'prefer_in_cloud';
}

/** Plain-language explanation for an AI failure (never raw provider errors). */
export function friendlyAIError(code: AIErrorCode | undefined, what = 'build this app'): string {
  switch (code) {
    case 'offline':
      return `You're offline. Kalam needs its cloud model to ${what}. Your description is kept. Try again when you're back online, or pick a simpler app (counter, checklist, notes, expenses) that builds offline.`;
    case 'consent_denied':
      return `Cloud AI is turned off in Settings, and Kalam needs it to ${what}. Turn on cloud help in Settings, or describe a simpler app that builds on this device.`;
    case 'not_configured':
      return `Kalam's cloud model isn't set up in this build, so it can't ${what}. Simple apps from templates still work.`;
    case 'app_check_failed':
      return `Kalam couldn't verify this device with Firebase App Check, so cloud AI is blocked. Please try again later.`;
    case 'quota':
      return `Kalam's cloud model has reached its usage limit for now. Please try again in a few minutes.`;
    case 'timeout':
      return `The AI model took too long to respond. Please try again.`;
    case 'cancelled':
      return 'Cancelled.';
    case 'model_unavailable':
      return `The AI model needed to ${what} isn't available right now.`;
    case 'bad_request':
      return `Kalam's cloud model turned this request down. Your description is kept. Please try again later.`;
    case 'unsupported_modality':
      return `The available model can't read this kind of input. Try a photo or a written description instead.`;
    default:
      return `Something went wrong while trying to ${what}. Your description is kept. Please try again.`;
  }
}

/** friendlyAIError for a failed model call: a cloud notice that was not accepted has its own honest sentence. */
export function friendlyAIFailure(r: { errorCode?: AIErrorCode; errorMessage?: string }, what?: string): string {
  return needsCloudOk(r) ? AI_COPY.needsCloudOk : friendlyAIError(r.errorCode, what);
}

const DEFAULT_CLARIFICATIONS = [
  'What should the app keep for each entry (for example name, amount, date)?',
  'Which screens or buttons do you need?',
];

export async function compileWithCloud(
  input: NormalizedInput,
  classification: TaskClassification,
  deps: CompileDeps,
): Promise<CompileOutcome> {
  const validate = deps.validate ?? defaultValidate;
  const toJson = deps.toJsonSchema ?? defaultToJsonSchema;
  const now = deps.now ?? Date.now;
  const { ai, signal, onStage } = deps;
  const mode = compileMode(input, classification);
  const taskType: TaskType = hasVisualInput(input) ? 'interpret_sketch' : 'create_app';
  const complexity = classification.complexity;
  const jsonSchema = toJson(compilerIRSchema);
  const zodParse = zodParser(compilerIRSchema);
  // Clean the raw answer first (lengths the cloud schema cannot carry), then let Zod decide.
  let normalised: string[] = [];
  const parse = (raw: unknown) => {
    const n = normalizeIR(raw);
    normalised = n.notes;
    return zodParse(n.value);
  };
  const images = collectImages(input);
  const request = requestText(input);
  const sessionId = deps.request?.sessionId;
  const session = sessionId ? { sessionId } : {};

  let provider: AIProviderName = 'none';
  let model: string | undefined;
  let source: InferenceSource | undefined;
  let usedPlan = false;
  const attempts: CompileAttempt[] = [];
  const base = () => ({ provider, model, source, usedPlan, attempts });
  /** Logs a pass that the model or the IR schema check stopped. */
  const modelFailed = (pass: CompileAttempt['pass'], r: AIExecutionResult<CompilerIR>) => {
    const ir = r.errorCode === 'invalid_output';
    attempts.push({
      pass, stage: ir ? 'structured_output' : 'model', category: categoryOf(r.errorCode, pass), errorCode: r.errorCode,
      issues: ir && r.errorMessage ? r.errorMessage.split('; ').slice(0, 20).map((m) => `IR ${m}`.slice(0, 200)) : [],
      repairs: normalised.slice(0, 40),
    });
  };
  const fail = (o: Partial<CompileOutcome> & { route: CompileOutcome['route'] }): CompileOutcome => ({
    ok: false, errors: [], warnings: [], assumptions: [], ...base(), ...o,
  });
  const note = (r: AIExecutionResult<unknown>) => {
    provider = r.provider;
    model = r.model;
    source = r.source;
  };

  // Optional constrained plan from a consented specialist. Failure is non-fatal.
  let plan: AppPlan | undefined;
  if (deps.useSpecialistPlan && complexity === 'complex') {
    onStage?.('planning_specialist');
    const r = await ai.run<AppPlan>(
      {
        taskType: 'plan_app', system: PLAN_SYSTEM_PROMPT,
        prompt: `Plan this app.\n\n${wrapUntrusted('user_request', [input.text, input.audioTranscript ?? ''].join('\n'))}`,
        jsonSchema: toJson(appPlanSchema), parse: zodParser(appPlanSchema),
        mode: 'only_in_cloud', role: 'compiler', temperature: 0.2, signal,
      },
      { taskType: 'plan_app', complexity, escalationReason: 'complex request; external provider consented', ...session },
    );
    if (r.success && r.output) {
      plan = r.output;
      usedPlan = true;
    }
  }

  /**
   * Converts, repairs deterministically, validates; returns the validated spec or the exact problems for the
   * cloud repair. The deterministic repair never makes things worse: if only the unrepaired app is valid, it wins.
   */
  const attempt = (ir: CompilerIR, r: AIExecutionResult<CompilerIR>, pass: CompileAttempt['pass']) => {
    onStage?.('validating');
    const candidate = irToSpec(ir, {
      appId: deps.appId,
      now: now(),
      lang: input.language,
      themePreset: input.preferences?.themePreset,
      currency: input.preferences?.currency,
      generator: { route: r.source === 'on_device' ? 'on_device' : 'cloud', provider: r.provider, model: r.model },
    });
    let repaired = { spec: candidate, notes: [] as string[] };
    try {
      repaired = completeSpec(candidate, { request, currency: input.preferences?.currency });
    } catch {
      // A repair bug must never cost the person their app: validate what the model gave.
    }
    let v = strict(validate(repaired.spec));
    let repairs = [...normalised, ...repaired.notes];
    if (!v.ok && repaired.spec !== candidate) {
      // The unrepaired app wins when it is valid. When both are invalid, the cloud repair is told about the
      // model's own app: the deterministic repair adds and moves screens and parts, so its paths would mislead.
      v = strict(validate(candidate));
      repairs = [...normalised, v.ok ? 'deterministic repair skipped: it left the app invalid' : 'deterministic repair skipped: the app was invalid before it'];
    }
    attempts.push({
      pass, stage: v.ok ? 'ok' : 'validation', category: v.ok ? undefined : pass === 'repair' ? 'REPAIR_FAILED' : 'OUTPUT_INVALID',
      ...(v.ok ? {} : { errorCode: 'invalid_output' as const }),
      issues: v.errors.slice(0, 20).map((e) => `${e.code} ${e.path || '(root)'}`),
      repairs: repairs.slice(0, 40),
    });
    return v.ok && v.spec
      ? { ok: true as const, spec: v.spec, warnings: v.warnings }
      : {
          ok: false as const, errors: v.errors, warnings: v.warnings,
          problems: v.errors.map((e) => `${e.path || '(root)'}: ${e.message}`),
        };
  };
  const success = (ir: CompilerIR, spec: KalamSpec, warnings: SpecIssue[], route: CompileOutcome['route']): CompileOutcome => {
    const w = [...warnings];
    if (source === 'on_device') {
      w.push({
        code: 'generated_on_device', path: '', severity: 'warning', recoverable: true,
        message: 'The cloud model was unavailable, so the on-device model drafted this app. Review it carefully.',
      });
    }
    return {
      ok: true, spec, route, errors: [], warnings: w, assumptions: honestAssumptions(ir.assumptions, request),
      clarifications: ir.clarifications?.length ? ir.clarifications : undefined, ...base(),
    };
  };
  const needsDetail = (ir: CompilerIR) =>
    fail({
      route: 'cloud',
      message: "Kalam needs a little more detail before it can build this app.",
      clarifications: ir.clarifications?.length ? ir.clarifications : DEFAULT_CLARIFICATIONS,
    });

  onStage?.('generating_cloud');
  const first = await ai.run<CompilerIR>(
    {
      taskType, system: COMPILER_SYSTEM_PROMPT, prompt: buildCompilerPrompt(input, { plan }), images,
      jsonSchema, parse, mode, role: 'compiler', temperature: 0.2, maxOutputTokens: OUTPUT_TOKENS, timeoutMs: COMPILE_TIMEOUT_MS, maxRetries: SLOW_CALL, signal,
    },
    // No escalationReason: it would let the orchestrator hand compilation to a specialist.
    { taskType, complexity, classification: { method: classification.method, confidence: classification.confidence }, ...session },
  );
  note(first);

  let previous: CompilerIR | undefined;
  let problems: string[];
  let lastErrors: SpecIssue[] = [];
  let lastWarnings: SpecIssue[] = [];
  if (!first.success || !first.output) {
    modelFailed('first', first);
    if (first.errorCode !== 'invalid_output') {
      return fail({ route: 'cloud', errorCode: first.errorCode, message: friendlyAIFailure(first) });
    }
    problems = [`The output did not match the IR schema: ${first.errorMessage ?? 'invalid JSON'}`];
  } else {
    if (first.output.screens.length === 0) return needsDetail(first.output);
    const a = attempt(first.output, first, 'first');
    if (a.ok) return success(first.output, a.spec, a.warnings, 'cloud');
    previous = first.output;
    problems = a.problems;
    lastErrors = a.errors;
    lastWarnings = a.warnings;
  }

  // Exactly one repair pass (docs/07 §11.4).
  if (signal?.aborted) return fail({ route: 'cloud', errorCode: 'cancelled', message: friendlyAIError('cancelled'), errors: lastErrors });
  onStage?.('repairing', `${problems.length} problem(s)`);
  const repair = await ai.run<CompilerIR>(
    {
      taskType: 'repair_spec', system: COMPILER_SYSTEM_PROMPT, prompt: buildRepairPrompt(input, previous, problems),
      images: previous ? undefined : images, jsonSchema, parse, mode, role: 'repair',
      temperature: 0.1, maxOutputTokens: OUTPUT_TOKENS, timeoutMs: COMPILE_TIMEOUT_MS, maxRetries: SLOW_CALL, signal,
    },
    { taskType: 'repair_spec', complexity, classification: { method: classification.method, confidence: classification.confidence }, ...session },
  );
  const cantBuild = "Kalam couldn't turn this description into a working app. Your description is kept. Answering a question below usually helps.";
  if (!repair.success || !repair.output) {
    modelFailed('repair', repair);
    return fail({
      route: 'cloud+repair', errorCode: repair.errorCode, errors: lastErrors, warnings: lastWarnings,
      message: repair.errorCode && repair.errorCode !== 'invalid_output' ? friendlyAIFailure(repair) : cantBuild,
      clarifications: previous?.clarifications?.length ? previous.clarifications : DEFAULT_CLARIFICATIONS,
    });
  }
  note(repair);
  if (repair.output.screens.length === 0) return { ...needsDetail(repair.output), route: 'cloud+repair' };
  const b = attempt(repair.output, repair, 'repair');
  if (b.ok) return success(repair.output, b.spec, b.warnings, 'cloud+repair');
  return fail({
    route: 'cloud+repair', errorCode: 'invalid_output', errors: b.errors, warnings: b.warnings, message: cantBuild,
    clarifications: repair.output.clarifications?.length ? repair.output.clarifications : DEFAULT_CLARIFICATIONS,
  });
}
