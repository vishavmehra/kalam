/**
 * Shapes for the golden evaluation set and the metric report (docs/13 §6-9, §19).
 * No I/O: safe to import from Node scripts, Vitest and the dev-only /lab screen.
 */
import type { CompileAttempt, ComplexityLevel, TaskType, TemplateId, UnderstandingSummary } from '@/core/contracts';
import type { KalamComponentType, KalamFieldType, KalamSpec } from '@/core/spec/schema';

export type GoldenLanguage = 'en' | 'hinglish' | 'hi';
export type ModalityName = 'image' | 'audio' | 'video' | 'mixed';
/** One score per modality, never blended (docs/13 §7.4, §18). */
export type Dataset = 'text' | 'sketch' | ModalityName;
export const DATASETS: readonly Dataset[] = ['text', 'sketch', 'image', 'audio', 'video', 'mixed'];
export type Route = 'template' | 'cloud';

/** A field the generated app must have. Matches when ANY collection field's label or id contains ANY keyword. */
export interface FieldExpectation {
  anyOf: string[];
  type?: KalamFieldType;
}

/**
 * What a good result looks like. Human-reviewed labels: they are NOT tuned to the current classifier
 * (docs/13 §7.3). `route` is where the request should be built: a deterministic template, or the cloud compiler.
 */
export interface GoldenExpected {
  complexity: ComplexityLevel;
  taskType: TaskType;
  route: Route;
  /** Required when route is "template". */
  template?: TemplateId;
  /** Sketches and other visual input need cloud vision. Default: false for text, true for sketches. */
  multimodal?: boolean;
  /** The request is too vague to build from; the classifier should report low confidence. */
  lowConfidence?: boolean;
  minScreens: number;
  minCollections: number;
  requiredFields: FieldExpectation[];
  requiredComponents: KalamComponentType[];
  /** Strings that must never appear in the generated spec (prompt-injection checks). Case-insensitive. */
  forbiddenText?: string[];
}

export type ReviewStatus = 'needs_human_review' | 'human_reviewed';

/** Who checked the expected result (docs/13 §7.1, §18.2). Absent means nobody has: the labels are machine-authored. */
export interface Review {
  status: ReviewStatus;
  reviewer?: string;
  /** ISO date of the review. */
  date?: string;
  notes?: string;
}

interface GoldenCaseBase {
  id: string;
  tags: string[];
  /** True when reasonable reviewers could label the case differently (docs/13 §7.3). Reported separately. */
  ambiguous?: boolean;
  notes?: string;
  review?: Review;
  /**
   * The case needs a real asset that only a person can supply (a photo of a paper sketch, a screen recording,
   * a voice note). The set carries a synthetic placeholder so routing can be tested; the placeholder is never sent
   * to a model, and live runs skip the case.
   */
  needsAssets?: string;
}

export interface GoldenTextCase extends GoldenCaseBase {
  text: string;
  language: GoldenLanguage;
  expected: GoldenExpected;
}

// ─── Sketches: a tiny layout language that expands to a real DrawingDocument ───────────────
export type StampName = 'bigButton' | 'list' | 'textInput' | 'heading' | 'stat' | 'photo' | 'toggle';

/** Items are stacked top to bottom on the page, like a person placing stamps in the Drawing Studio. */
export type SketchItem =
  | { stamp: StampName; label?: string }
  | { text: string; fontSize?: number }
  | { box: 'rect' | 'ellipse'; label?: string; h?: number };

export interface SketchPageDef {
  title: string;
  items: SketchItem[];
}

export interface SketchExpected extends GoldenExpected {
  /**
   * Labels the drawing summary must recover (deterministic extraction, docs/08 §15). Optional: when absent they
   * are derived from the layout (page titles, stamp labels, text and box labels).
   */
  labels?: string[];
  /** Number of stamps per component the summary must report. Optional: derived from the layout when absent. */
  stamps?: Partial<Record<StampName, number>>;
}

export interface GoldenSketchCase extends GoldenCaseBase {
  title: string;
  /** docs/13 §7.2 category. */
  category: string;
  pages: SketchPageDef[];
  expected: SketchExpected;
}

/**
 * Image, audio, video and mixed-input cases (docs/13 §7.4, §18). Media is described, not stored: placeholders stand in
 * for photos and frames, and a voice note is its transcript. They test routing and normalisation, not vision.
 */
export interface GoldenModalityCase extends GoldenCaseBase {
  modality: ModalityName;
  language: GoldenLanguage;
  /** Typed request. */
  text?: string;
  /** Speech-to-text result of a voice note. */
  audioTranscript?: string;
  /** A voice note that has no transcript yet (needs cloud audio reasoning). */
  untranscribedAudio?: boolean;
  /** Placeholder photos. They carry no pixels worth reading and are never sent to a model. */
  images?: { count: number; source: 'photo' | 'screenshot' | 'drawing' };
  /** Placeholder video frames. */
  video?: { frames: number; durationSec: number; summary?: string };
  /** A golden sketch to include as Drawing Studio input (mixed-modality cases). */
  sketch?: string;
  expected: GoldenExpected;
}

export interface GoldenDataset {
  name: string;
  datasetVersion: string;
  description: string;
  rules: string[];
  changelog: Array<{ version: string; note: string }>;
  /** docs/13 §7: the original benchmark is 25 hand-drawn sketches photographed on paper. */
  handDrawnPhotos?: { required: number; present: number; note: string };
}

// ─── Results ────────────────────────────────────────────────────────────────────────────────
export type EvalMode = 'deterministic' | 'live';

export interface Check {
  ok: boolean;
  expected?: unknown;
  actual?: unknown;
}

export interface ClassificationResult {
  complexity: ComplexityLevel;
  taskType: TaskType;
  route: Route;
  template?: TemplateId;
  confidence: number;
  multimodal: boolean;
  requiresCloud: boolean;
  method: string;
}

export interface SemanticResult {
  screens: Check;
  collections: Check;
  fields: { found: number; total: number; missing: string[] };
  components: { found: number; total: number; missing: string[] };
  forbiddenText: Check;
}

export interface ExtractionResult {
  pageCount: Check;
  labels: { found: number; total: number; missing: string[] };
  stamps: { found: number; total: number; missing: string[] };
}

export type BuildStage = 'template' | 'cloud' | 'skipped';

export interface BuildResult {
  /** "template": the deterministic pipeline built an app. "cloud": a real compile ran. "skipped": needs cloud, not run. */
  stage: BuildStage;
  skippedReason?: string;
  ok: boolean;
  /** Final spec passed validateSpec (checked again here, independent of the pipeline). */
  valid: boolean;
  describeOk: boolean;
  route?: string;
  provider?: string;
  model?: string;
  /** Live mode: the first model answer was valid without the repair pass. */
  firstPassValid?: boolean;
  httpCalls?: number;
  errors: string[];
  warnings: number;
  /** Cloud compile passes: the stage each stopped at and its exact validator codes (docs/13 §6.1, §21). */
  attempts?: CompileAttempt[];
}

export interface CaseResult {
  id: string;
  dataset: Dataset;
  language?: GoldenLanguage;
  category?: string;
  ambiguous: boolean;
  classification: ClassificationResult;
  checks: {
    complexity: Check;
    taskType: Check;
    route: Check;
    template?: Check;
    multimodal: Check;
    lowConfidence?: Check;
  };
  extraction?: ExtractionResult;
  build: BuildResult;
  /** Cloud-route cases in deterministic mode: the pipeline must fail gracefully with the model unreachable (docs/13 §9.1 E). */
  offline?: { graceful: boolean; message?: string };
  semantic?: SemanticResult;
  /** The built app's formulas and defaults ran without error on empty data (docs/15 §11.3 runtime success). */
  runtime?: { ok: boolean; evaluated: number; failed: string[] };
  review: ReviewStatus;
  needsAssets?: string;
  latencyMs: { classify: number; build: number; total: number };
  failures: string[];
  /** Scoring-page material. Present when the run captured detail (scripts/eval.mjs always does). */
  detail?: CaseDetail;
  /** Live runs: requests, tokens and per-request latency attributed to this case. */
  usage?: CaseUsage;
  /** Added by scripts/eval-judge.mjs. Advice for the person scoring, never a human score. */
  aiPreScore?: AIPreScore;
  mayDisagree?: DisagreementRisk;
}

export interface Rate {
  correct: number;
  total: number;
  /** 0..1, or null when total is 0. */
  rate: number | null;
}

export interface LatencyStats {
  count: number;
  medianMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface DatasetMetrics {
  cases: number;
  ambiguousCases: number;
  classifier: {
    complexity: Rate;
    complexityExcludingAmbiguous: Rate;
    route: Rate;
    template: Rate;
    taskType: Rate;
    multimodal: Rate;
    lowConfidence: Rate;
    confusion: Record<string, Record<string, number>>;
  };
  build: {
    templateRoute: { attempted: number; built: number; valid: Rate; described: Rate };
    cloudRequired: {
      cases: number;
      skipped: number;
      attempted: number;
      /** Deterministic mode: cloud-route requests that failed gracefully with no model reachable (docs/13 §9.1 E). */
      offlineGraceful: Rate;
    };
  };
  /** Built apps whose formulas and defaults ran on empty data without error (docs/15 §11.3 runtime success). */
  runtime: Rate;
  /** Human review state of the expected labels (docs/13 §7.3, §18.2). */
  review: { pending: number; reviewed: number; needsAssets: number };
  semantic: {
    cases: number;
    screens: Rate;
    collections: Rate;
    fields: Rate;
    components: Rate;
    forbiddenText: Rate;
  };
  extraction?: { pageCount: Rate; labels: Rate; stamps: Rate };
  live?: {
    attempted: number;
    firstPassValid: Rate;
    validAfterRepair: Rate;
    repairSuccess: Rate;
    sources: Record<string, number>;
  };
  latency: { classifier: LatencyStats; templateBuild: LatencyStats; cloudBuild: LatencyStats };
}

export interface EvalReport {
  schema: 'kalam-eval-report/1';
  evaluationId: string;
  createdAt: string;
  mode: EvalMode;
  datasetVersion: string;
  platform: string;
  /** Model ids seen in live mode. Empty in deterministic mode. */
  models: string[];
  /** Short content hashes so a run can be reproduced (docs/13 §7.3, §19). */
  promptVersion: string;
  datasetHash: string;
  inferenceSource: 'deterministic' | 'cloud';
  /** Real model requests made. Always 0 in deterministic mode. */
  cloudCalls: number;
  totalCases: number;
  /** Per-dataset results. Modalities are never merged into one score (docs/13 §7.4). */
  datasets: Partial<Record<Dataset, DatasetMetrics>>;
  /** docs/13 §19 headline numbers (live mode only; null otherwise). */
  firstPassValid: number | null;
  validAfterRepair: number | null;
  latency: { medianMs: number | null; p95Ms: number | null };
  failures: Array<{ id: string; dataset: Dataset; reasons: string[] }>;
  /** Failed checks per stage, so a failure is attributable to one stage (docs/13 §6.1). */
  failuresByStage: Record<string, number>;
  /** Cloud compile passes that did not end valid, by stage and by validator code (docs/13 §21). Absent without cloud compiles. */
  compileFailures?: { passes: number; byStage: Record<string, number>; byCode: Record<string, number> };
  /** Inference-source accounting from the orchestrator's events (docs/13 §9.2, §9.3). */
  hybrid: HybridSummary;
  /** docs/13 §9.1 scenarios A to E: what this run really exercised, and what it did not. */
  scenarios: ScenarioStatus[];
  /** Which golden labels a person has checked, and what still needs a person (docs/13 §7.3, §18). */
  humanReview: HumanReviewSummary;
  /** Live runs: what the model requests used. Absent in deterministic runs. */
  usage?: ReportUsage;
  /** Set by scripts/eval-judge.mjs: how the AI pre-scores were made. */
  judge?: JudgeSummary;
  cases: CaseResult[];
  notes: string[];
}

export interface ReportUsage {
  httpCalls: number;
  inputTokens: number;
  outputTokens: number;
  byModel: Record<string, { httpCalls: number; inputTokens: number; outputTokens: number }>;
}

export interface JudgeSummary {
  model: string;
  budget: number;
  httpCalls: number;
  inputTokens: number;
  outputTokens: number;
  scored: number;
  failed: number;
  notBuilt: number;
  distribution: Record<Verdict, number>;
  flaggedMayDisagree: number;
}

export interface HybridSummary {
  events: number;
  /** Requests that reached a model. 0 in a deterministic run. */
  modelCalls: number;
  bySource: Record<string, { count: number; success: number; medianMs: number | null; p95Ms: number | null }>;
  /** Events whose reported source cannot be true (docs/13 §9.3). Must stay empty. */
  sourceViolations: string[];
}

export interface ScenarioStatus {
  id: 'A' | 'B' | 'C' | 'D' | 'E';
  title: string;
  status: 'exercised' | 'not_run';
  evidence: string;
}

export interface HumanReviewSummary {
  rubric: string[];
  scale: string;
  pending: string[];
  reviewed: string[];
  needsAssets: Array<{ id: string; asset: string }>;
  handDrawnPhotos?: { required: number; present: number; note: string };
}

export interface GateThresholds {
  /** Template-route apps that must be valid (docs/07 §20.4: 100%). */
  templateValidity: number;
  textComplexity: number;
  textRoute: number;
  sketchRoute: number;
  sketchExtraction: number;
  /** Route accuracy for each of the image, audio, video and mixed sets. */
  modalityRoute: number;
  /** Cloud-route requests that must fail gracefully when no model is reachable. */
  offlineGraceful: number;
  /** Built apps whose formulas must run on empty data. */
  runtime: number;
}

export interface GateResult {
  pass: boolean;
  reasons: string[];
}

// ─── Review: what a person scores, the AI pre-score and the human scores ───────────────────────
/** One verdict per case. Maps to the docs/13 §18.1 scale: wrong 0, partly right 1, right 2. */
export type Verdict = 'correct' | 'partly' | 'wrong';
export const VERDICTS: readonly Verdict[] = ['correct', 'partly', 'wrong'];

/** What the person asked for, in a form the scoring page can show. Never contains pixels. */
export interface ReviewInput {
  kind: Dataset;
  text?: string;
  audioTranscript?: string;
  untranscribedAudio?: boolean;
  images?: { count: number; source: string };
  video?: { frames: number; durationSec: number; summary?: string };
  /** The golden sketch layout (stamps and text), so the page can draw it. */
  sketch?: { title: string; pages: SketchPageDef[] };
  /** A real photo was used instead of the layout. The file is not embedded (see the page's photo picker). */
  photo?: { file: string; bytes: number };
  /** Plain-English description of the media a person still has to supply. */
  assetNote?: string;
}

export interface FormulaNote {
  where: string;
  label: string;
  expr: string;
}

export interface DeterministicCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'info';
  detail?: string;
}

/** Everything the scoring page needs about one case. Added to a report only when the runner captures detail. */
export interface CaseDetail {
  title: string;
  tags: string[];
  input: ReviewInput;
  expected: GoldenExpected;
  /** The golden case's own note, for example why it is ambiguous. */
  goldenNote?: string;
  /** Why nothing was built (no model call, placeholder media, too vague). */
  notBuilt?: string;
  spec?: KalamSpec;
  understanding?: UnderstandingSummary;
  formulas: FormulaNote[];
  clarifications?: string[];
  checks: DeterministicCheck[];
}

/** One model request of one case, attributed from the orchestrator's own event. */
export interface UsageEvent {
  taskType: string;
  model?: string;
  source: string;
  success: boolean;
  latencyMs: number;
  errorCode?: string;
  /** The provider's own error text, scrubbed of config values. Explains a failed request. */
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface CaseUsage {
  /** Requests that really left the machine for this case (retries count). */
  httpCalls: number;
  inputTokens: number;
  outputTokens: number;
  events: UsageEvent[];
}

/** The AI's pre-score. It is advice for the person scoring, never a human score. */
export interface AIPreScore {
  /** null when the judge could not answer or nothing was built. */
  score: Verdict | null;
  reasons: string[];
  confidence: number | null;
  model?: string;
  httpCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  /** Why there is no score (nothing built, judge failed, budget used up). */
  note?: string;
}

export interface DisagreementRisk {
  /** True when the person may well score this case differently from the AI. */
  flag: boolean;
  reasons: string[];
}

/** The file the scoring page exports. */
export interface HumanScoresFile {
  schema: 'kalam-human-scores/1';
  /** evaluationId of the report these scores belong to. */
  evaluationId: string;
  datasetHash?: string;
  reviewer?: string;
  exportedAt: string;
  scores: Array<{ id: string; score: Verdict; note?: string }>;
}
