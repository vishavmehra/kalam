/**
 * Firebase cloud compiler (docs/07 §11, CP5): request IR → convert → validate → at most ONE
 * repair pass → validated KalamSpec, or a plain-language failure with clarifications.
 * Never returns an invalid spec. Optional specialist planning (Claude/Nebius, consented) only
 * produces a constrained plan; Firebase stays the compiler (docs/07 §6.4, §11.5).
 */
import type { ZodType } from 'zod';
import { toJsonSchema as defaultToJsonSchema } from '../ai/json-schema';
import type {
  AIErrorCode, AIExecutionResult, AIOrchestrator, AIProviderName, CreationStage, InferenceMode,
  InferenceSource, NormalizedInput, SpecIssue, TaskClassification, TaskType, ValidateSpec,
} from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { validateSpec as defaultValidate } from '../spec/validate';
import { irToSpec } from './convert';
import { appPlanSchema, compilerIRSchema, zodParser, type AppPlan, type CompilerIR } from './ir';
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
  const parse = zodParser(compilerIRSchema);
  const images = collectImages(input);

  let provider: AIProviderName = 'none';
  let model: string | undefined;
  let source: InferenceSource | undefined;
  let usedPlan = false;
  const base = () => ({ provider, model, source, usedPlan });
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
      { taskType: 'plan_app', complexity, escalationReason: 'complex request; external provider consented' },
    );
    if (r.success && r.output) {
      plan = r.output;
      usedPlan = true;
    }
  }

  /** Converts + validates; returns the validated spec or the exact problems for repair. */
  const attempt = (ir: CompilerIR, r: AIExecutionResult<CompilerIR>) => {
    onStage?.('validating');
    const candidate = irToSpec(ir, {
      appId: deps.appId,
      now: now(),
      lang: input.language,
      themePreset: input.preferences?.themePreset,
      generator: { route: r.source === 'on_device' ? 'on_device' : 'cloud', provider: r.provider, model: r.model },
    });
    const v = validate(candidate);
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
      ok: true, spec, route, errors: [], warnings: w, assumptions: ir.assumptions ?? [],
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
      jsonSchema, parse, mode, role: 'compiler', temperature: 0.2, maxOutputTokens: 8192, timeoutMs: 90_000, signal,
    },
    // No escalationReason: it would let the orchestrator hand compilation to a specialist.
    { taskType, complexity, classification: { method: classification.method, confidence: classification.confidence } },
  );
  note(first);

  let previous: CompilerIR | undefined;
  let problems: string[];
  let lastErrors: SpecIssue[] = [];
  let lastWarnings: SpecIssue[] = [];
  if (!first.success || !first.output) {
    if (first.errorCode !== 'invalid_output') {
      return fail({ route: 'cloud', errorCode: first.errorCode, message: friendlyAIError(first.errorCode) });
    }
    problems = [`The output did not match the IR schema: ${first.errorMessage ?? 'invalid JSON'}`];
  } else {
    if (first.output.screens.length === 0) return needsDetail(first.output);
    const a = attempt(first.output, first);
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
      temperature: 0.1, maxOutputTokens: 8192, timeoutMs: 90_000, signal,
    },
    { taskType: 'repair_spec', complexity, classification: { method: classification.method, confidence: classification.confidence } },
  );
  const cantBuild = "Kalam couldn't turn this description into a working app. Your description is kept. Answering a question below usually helps.";
  if (!repair.success || !repair.output) {
    return fail({
      route: 'cloud+repair', errorCode: repair.errorCode, errors: lastErrors, warnings: lastWarnings,
      message: repair.errorCode && repair.errorCode !== 'invalid_output' ? friendlyAIError(repair.errorCode) : cantBuild,
      clarifications: previous?.clarifications?.length ? previous.clarifications : DEFAULT_CLARIFICATIONS,
    });
  }
  note(repair);
  if (repair.output.screens.length === 0) return { ...needsDetail(repair.output), route: 'cloud+repair' };
  const b = attempt(repair.output, repair);
  if (b.ok) return success(repair.output, b.spec, b.warnings, 'cloud+repair');
  return fail({
    route: 'cloud+repair', errorCode: 'invalid_output', errors: b.errors, warnings: b.warnings, message: cantBuild,
    clarifications: repair.output.clarifications?.length ? repair.output.clarifications : DEFAULT_CLARIFICATIONS,
  });
}
