/**
 * Runs one golden case through Kalam's stages and records what happened (docs/13 §6.1: a failure
 * must be attributable to a stage). Dependencies are injected, so the same code runs against the
 * real modules (scripts/eval.mjs, /lab) and against fakes (unit tests).
 *
 * Deterministic stages: classify -> template build -> validateSpec -> describeSpec -> runtime smoke, plus the
 * drawing summary for sketches. Cloud-route requests are only compiled in live mode, under an explicit budget;
 * in deterministic mode they are checked for a graceful failure with no model reachable (docs/13 §9.1 E).
 */
import type {
  CreateApplication,
  DrawingDocument,
  DrawingSummary,
  NormalizedImage,
  NormalizedInput,
  TaskClassification,
  UnderstandingSummary,
  ValidateSpec,
} from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import {
  checkClassification,
  checkExtraction,
  checkSpec,
  semanticPassed,
  toClassificationResult,
} from './expectations';
import { buildSketchDocument, expectedExtraction } from './sketch-builder';
import type {
  BuildResult,
  CaseResult,
  Dataset,
  EvalMode,
  ExtractionResult,
  GoldenExpected,
  GoldenModalityCase,
  GoldenSketchCase,
  GoldenTextCase,
  ReviewStatus,
} from './types';

export interface RuntimeSmoke {
  ok: boolean;
  evaluated: number;
  failed: string[];
}

export interface EvalDeps {
  classify: (input: NormalizedInput) => TaskClassification | Promise<TaskClassification>;
  /** Deterministic mode passes a pipeline wired to an offline orchestrator; live mode the real one. */
  createApplication: CreateApplication;
  validate: ValidateSpec;
  describe: (spec: KalamSpec) => UnderstandingSummary;
  summarizeDrawing: (doc: DrawingDocument) => DrawingSummary;
  /** Runs the built app's formulas on empty data through the real runtime engine. Optional. */
  runtimeSmoke?: (spec: KalamSpec) => RuntimeSmoke;
  /** Monotonic milliseconds (performance.now). */
  now: () => number;
}

export interface EvalOptions {
  mode: EvalMode;
  /** Live only. Called before a cloud-route case. Return a reason to skip it (for example, budget used up). */
  beforeCloud?: () => string | undefined;
  /** Live only. Total model requests made so far, to attribute calls to cases. */
  httpCalls?: () => number;
}

const ms = (n: number): number => Math.round(n * 100) / 100;

interface CaseInput {
  id: string;
  dataset: Dataset;
  language?: GoldenTextCase['language'];
  category?: string;
  ambiguous: boolean;
  review: ReviewStatus;
  needsAssets?: string;
  input: NormalizedInput;
  expected: GoldenExpected;
  extraction?: ExtractionResult;
}

function describeOk(spec: KalamSpec, describe: EvalDeps['describe']): boolean {
  try {
    const u = describe(spec);
    return u.appName.trim().length > 0 && u.screens.length === spec.screens.length && u.purpose.trim().length > 0;
  } catch {
    return false;
  }
}

const skipped = (reason: string): BuildResult => ({
  stage: 'skipped',
  skippedReason: reason,
  ok: false,
  valid: false,
  describeOk: false,
  errors: [],
  warnings: 0,
});

const ASSET_SKIP = 'Needs a real asset from a person. A placeholder is never sent to a model.';

/** A person-readable failure, not a stack trace or a raw error code. */
function isGracefulMessage(message: string | undefined): boolean {
  if (!message || message.trim().length < 10 || message.length > 400) return false;
  return !/\b(?:undefined|null|NaN|stack|exception)\b|\bat \S+:\d+|[{}]|\b[a-z]+_[a-z_]+\b/.test(message);
}

async function runCase(c: CaseInput, deps: EvalDeps, opts: EvalOptions): Promise<CaseResult> {
  const t0 = deps.now();
  const classification = await deps.classify(c.input);
  const t1 = deps.now();
  const cls = toClassificationResult(classification);
  const checks = checkClassification(cls, c.expected, c.dataset === 'sketch' ? 'sketch' : 'text');

  let build: BuildResult;
  let spec: KalamSpec | undefined;
  let offline: CaseResult['offline'];
  const tb = deps.now();
  if (cls.route === 'template' || opts.mode === 'live') {
    const reason =
      cls.route !== 'cloud'
        ? undefined
        : c.expected.lowConfidence
          ? 'Too vague to build. Kalam should ask first, so no model request is spent.'
          : c.needsAssets
            ? ASSET_SKIP
            : opts.beforeCloud?.();
    if (reason) {
      build = skipped(reason);
    } else {
      const callsBefore = opts.httpCalls?.() ?? 0;
      const res = await deps.createApplication(c.input);
      spec = res.spec;
      const check = spec ? deps.validate(spec) : undefined;
      const errors = res.ok
        ? []
        : [
            res.message ?? 'No app was created.',
            ...res.errors.slice(0, 6).map((e) => `${e.path || '(root)'}: ${e.message}`),
          ];
      const cloud = cls.route === 'cloud';
      build = {
        stage: cloud ? 'cloud' : 'template',
        ok: res.ok,
        valid: !!check?.ok,
        describeOk: spec ? describeOk(spec, deps.describe) : false,
        route: res.route,
        provider: res.provider,
        ...(res.model ? { model: res.model } : {}),
        ...(cloud && opts.mode === 'live' ? { firstPassValid: res.ok && res.route === 'cloud' } : {}),
        ...(opts.httpCalls ? { httpCalls: opts.httpCalls() - callsBefore } : {}),
        errors,
        warnings: res.warnings.length,
      };
    }
  } else {
    build = skipped('Needs the cloud compiler. Not run in deterministic mode.');
    // The model is unreachable here, so the pipeline must say so plainly and keep the input (docs/13 §9.1 E).
    const res = await deps.createApplication(c.input);
    offline = {
      graceful: !res.ok && !res.spec && res.provider === 'none' && isGracefulMessage(res.message),
      ...(res.message ? { message: res.message } : {}),
    };
  }
  const t2 = deps.now();

  const semantic = spec ? checkSpec(spec, c.expected) : undefined;
  const runtime = spec && build.ok && deps.runtimeSmoke ? deps.runtimeSmoke(spec) : undefined;
  const failures: string[] = [];
  for (const [name, check] of Object.entries(checks)) {
    if (check && !check.ok)
      failures.push(`classifier.${name}: expected ${String(check.expected)}, got ${String(check.actual)}`);
  }
  if (c.extraction) {
    const x = c.extraction;
    if (!x.pageCount.ok)
      failures.push(`extraction.pages: expected ${String(x.pageCount.expected)}, got ${String(x.pageCount.actual)}`);
    if (x.labels.missing.length) failures.push(`extraction.labels missing: ${x.labels.missing.join(', ')}`);
    if (x.stamps.missing.length) failures.push(`extraction.stamps: ${x.stamps.missing.join(', ')}`);
  }
  if (build.stage !== 'skipped') {
    if (!build.ok) failures.push(`build (${build.stage}): ${build.errors[0] ?? 'failed'}`);
    else if (!build.valid) failures.push('build: final spec failed validateSpec');
    else if (!build.describeOk) failures.push('build: describeSpec did not produce a usable summary');
  }
  if (offline && !offline.graceful)
    failures.push(`offline: the pipeline did not fail gracefully (${offline.message ?? 'no message'})`);
  if (semantic && build.ok && !semanticPassed(semantic)) {
    if (!semantic.screens.ok)
      failures.push(`semantic.screens: ${String(semantic.screens.actual)} (need ${String(semantic.screens.expected)})`);
    if (!semantic.collections.ok)
      failures.push(
        `semantic.collections: ${String(semantic.collections.actual)} (need ${String(semantic.collections.expected)})`,
      );
    if (semantic.fields.missing.length) failures.push(`semantic.fields missing: ${semantic.fields.missing.join(', ')}`);
    if (semantic.components.missing.length)
      failures.push(`semantic.components missing: ${semantic.components.missing.join(', ')}`);
    if (!semantic.forbiddenText.ok)
      failures.push(`semantic.forbiddenText leaked: ${String(semantic.forbiddenText.actual)}`);
  }
  if (runtime && !runtime.ok) failures.push(`runtime: ${runtime.failed.slice(0, 3).join('; ')}`);

  return {
    id: c.id,
    dataset: c.dataset,
    ...(c.language ? { language: c.language } : {}),
    ...(c.category ? { category: c.category } : {}),
    ambiguous: c.ambiguous,
    classification: cls,
    checks,
    ...(c.extraction ? { extraction: c.extraction } : {}),
    build,
    ...(offline ? { offline } : {}),
    ...(semantic && build.ok ? { semantic } : {}),
    ...(runtime ? { runtime } : {}),
    review: c.review,
    ...(c.needsAssets ? { needsAssets: c.needsAssets } : {}),
    latencyMs: { classify: ms(t1 - t0), build: ms(t2 - tb), total: ms(t2 - t0) },
    failures,
  };
}

const reviewOf = (c: { review?: { status: ReviewStatus } }): ReviewStatus => c.review?.status ?? 'needs_human_review';

// ─── Text ──────────────────────────────────────────────────────────────────────────────────
export function textCaseInput(c: GoldenTextCase): NormalizedInput {
  return { text: c.text, modalities: ['text'], images: [], language: c.language === 'hi' ? 'hi' : 'en' };
}

export function evaluateTextCase(c: GoldenTextCase, deps: EvalDeps, opts: EvalOptions): Promise<CaseResult> {
  return runCase(
    {
      id: c.id,
      dataset: 'text',
      language: c.language,
      ambiguous: !!c.ambiguous,
      review: reviewOf(c),
      ...(c.needsAssets ? { needsAssets: c.needsAssets } : {}),
      input: textCaseInput(c),
      expected: c.expected,
    },
    deps,
    opts,
  );
}

// ─── Sketches ──────────────────────────────────────────────────────────────────────────────
/** The input the Drawing Studio hands to the pipeline for a sketch (no raster image in Node). */
export function sketchCaseInput(summary: DrawingSummary): NormalizedInput {
  return { text: '', modalities: ['drawing'], images: [], drawing: summary, language: 'en' };
}

export function evaluateSketchCase(c: GoldenSketchCase, deps: EvalDeps, opts: EvalOptions): Promise<CaseResult> {
  const summary = deps.summarizeDrawing(buildSketchDocument(c));
  return runCase(
    {
      id: c.id,
      dataset: 'sketch',
      category: c.category,
      ambiguous: !!c.ambiguous,
      review: reviewOf(c),
      ...(c.needsAssets ? { needsAssets: c.needsAssets } : {}),
      input: sketchCaseInput(summary),
      expected: c.expected,
      extraction: checkExtraction(summary, c.pages.length, expectedExtraction(c)),
    },
    deps,
    opts,
  );
}

// ─── Image, audio, video and mixed input ───────────────────────────────────────────────────
/** A valid 1x1 PNG. Stands in for a photo so routing can be tested; it is never sent to a model. */
export const PLACEHOLDER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const placeholder = (id: string, i: number, source: NormalizedImage['source']): NormalizedImage => ({
  id: `img_${id}_${i + 1}`,
  mimeType: 'image/png',
  base64: PLACEHOLDER_PNG,
  width: 800,
  height: 1200,
  source,
});

export function modalityCaseInput(c: GoldenModalityCase, sketchSummary?: DrawingSummary): NormalizedInput {
  const modalities: NormalizedInput['modalities'] = [];
  const input: NormalizedInput = {
    text: c.text ?? '',
    modalities,
    images: [],
    language: c.language === 'hi' ? 'hi' : 'en',
  };
  if (c.text?.trim()) modalities.push('text');
  if (c.images) {
    input.images = Array.from({ length: c.images.count }, (_, i) => placeholder(c.id, i, c.images!.source));
    modalities.push('image');
  }
  if (c.audioTranscript?.trim() || c.untranscribedAudio) {
    if (c.audioTranscript?.trim()) input.audioTranscript = c.audioTranscript;
    modalities.push('audio');
  }
  if (c.video) {
    input.video = {
      frames: Array.from({ length: c.video.frames }, (_, i) => placeholder(c.id, i, 'video_frame')),
      durationSec: c.video.durationSec,
      ...(c.video.summary ? { summary: c.video.summary } : {}),
    };
    modalities.push('video');
  }
  if (sketchSummary) {
    input.drawing = sketchSummary;
    modalities.push('drawing');
  }
  return input;
}

export function evaluateModalityCase(
  c: GoldenModalityCase,
  sketches: readonly GoldenSketchCase[],
  deps: EvalDeps,
  opts: EvalOptions,
): Promise<CaseResult> {
  const sketch = c.sketch ? sketches.find((s) => s.id === c.sketch) : undefined;
  if (c.sketch && !sketch) throw new Error(`${c.id}: unknown sketch "${c.sketch}"`);
  const summary = sketch ? deps.summarizeDrawing(buildSketchDocument(sketch)) : undefined;
  return runCase(
    {
      id: c.id,
      dataset: c.modality,
      language: c.language,
      ambiguous: !!c.ambiguous,
      review: reviewOf(c),
      ...(c.needsAssets ? { needsAssets: c.needsAssets } : {}),
      input: modalityCaseInput(c, summary),
      expected: c.expected,
    },
    deps,
    opts,
  );
}
