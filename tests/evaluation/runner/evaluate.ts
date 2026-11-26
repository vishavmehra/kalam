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
  CreationResult,
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
import {
  builtDetail,
  modalityReviewInput,
  notBuiltDetail,
  sketchReviewInput,
  textReviewInput,
  titleOf,
} from './review';
import type {
  BuildResult,
  CaseDetail,
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
  /** Keep the built spec, its plain-language summary and the automatic checks on each case, for the scoring page. */
  captureDetail?: boolean;
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
  /** What the scoring page shows about the request. Used only when opts.captureDetail is set. */
  detailBase?: Pick<CaseDetail, 'title' | 'tags' | 'input' | 'expected' | 'goldenNote'>;
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
  let created: CreationResult | undefined;
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
      created = res;
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
        ...(res.compileAttempts?.length ? { attempts: res.compileAttempts } : {}),
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
    if (!build.ok) {
      // Name the pass and stage that stopped it, and its first codes, not only the person-facing message.
      const last = build.attempts?.[build.attempts.length - 1];
      const where = last
        ? ` [${last.pass} pass, ${last.stage}${last.issues.length ? `: ${last.issues.slice(0, 3).join('; ')}` : ''}]`
        : '';
      failures.push(`build (${build.stage}): ${build.errors[0] ?? 'failed'}${where}`);
    } else if (!build.valid) failures.push('build: final spec failed validateSpec');
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

  let detail: CaseDetail | undefined;
  if (opts.captureDetail && c.detailBase) {
    if (spec && created && build.ok) {
      detail = builtDetail(
        c.detailBase,
        {
          spec,
          ...(created.understanding ? { understanding: created.understanding } : {}),
          clarifications: created.clarifications ?? [],
        },
        {
          expected: c.expected,
          valid: build.valid,
          warnings: created.warnings,
          route: created.route,
          semantic,
          runtime,
          classificationRoute: cls.route,
          describeOk: build.describeOk,
        },
      );
    } else {
      const vague = checks.lowConfidence;
      detail = notBuiltDetail(
        c.detailBase,
        build.skippedReason ?? offline?.message ?? build.errors[0] ?? 'No app was built.',
        vague
          ? [
              {
                id: 'vague',
                label: 'Kalam noticed the request is too vague to build from, so it should ask first',
                status: vague.ok ? 'pass' : 'fail',
              },
            ]
          : [],
      );
    }
  }

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
    ...(detail ? { detail } : {}),
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
      detailBase: {
        title: titleOf(c),
        tags: c.tags,
        input: textReviewInput(c),
        expected: c.expected,
        ...(c.notes ? { goldenNote: c.notes } : {}),
      },
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

/** A real photo of a hand-drawn sketch, read from disk by scripts/eval.mjs (never stored in the report). */
export interface SketchPhoto {
  file: string;
  bytes: number;
  mimeType: 'image/jpeg' | 'image/png';
  base64: string;
  width: number;
  height: number;
}

/** What the app does with a photographed sketch: one photo, no drawing summary. */
export function photoCaseInput(id: string, photo: SketchPhoto): NormalizedInput {
  return {
    text: '',
    modalities: ['image'],
    images: [
      {
        id: `img_${id}_photo`,
        mimeType: photo.mimeType,
        base64: photo.base64,
        width: photo.width,
        height: photo.height,
        source: 'photo',
      },
    ],
    language: 'en',
  };
}

export function evaluateSketchCase(
  c: GoldenSketchCase,
  deps: EvalDeps,
  opts: EvalOptions,
  photo?: SketchPhoto,
): Promise<CaseResult> {
  const summary = deps.summarizeDrawing(buildSketchDocument(c));
  return runCase(
    {
      id: c.id,
      dataset: 'sketch',
      category: c.category,
      ambiguous: !!c.ambiguous,
      review: reviewOf(c),
      ...(c.needsAssets ? { needsAssets: c.needsAssets } : {}),
      input: photo ? photoCaseInput(c.id, photo) : sketchCaseInput(summary),
      expected: c.expected,
      // A photo has no stamps to count, so the drawing-summary checks only apply to the layout version.
      ...(photo ? {} : { extraction: checkExtraction(summary, c.pages.length, expectedExtraction(c)) }),
      detailBase: {
        title: c.title,
        tags: [...c.tags, ...(photo ? ['real-photo'] : [])],
        input: sketchReviewInput(c, photo ? { file: photo.file, bytes: photo.bytes } : undefined),
        expected: c.expected,
        ...(c.notes ? { goldenNote: c.notes } : {}),
      },
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

export function modalityCaseInput(
  c: GoldenModalityCase,
  sketchSummary?: DrawingSummary,
  frames?: readonly NormalizedImage[],
): NormalizedInput {
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
      frames: frames
        ? [...frames]
        : Array.from({ length: c.video.frames }, (_, i) => placeholder(c.id, i, 'video_frame')),
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
  /** Real image frames for a video case (stills standing in for a decoded video). The case then runs live instead of being skipped. */
  frames?: readonly NormalizedImage[],
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
      ...(c.needsAssets && !frames ? { needsAssets: c.needsAssets } : {}),
      input: modalityCaseInput(c, summary, frames),
      expected: c.expected,
      detailBase: {
        title: titleOf(c),
        tags: c.tags,
        input: modalityReviewInput(c, sketch),
        expected: c.expected,
        ...(c.notes ? { goldenNote: c.notes } : {}),
      },
    },
    deps,
    opts,
  );
}
