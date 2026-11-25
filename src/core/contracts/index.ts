/**
 * Cross-module contracts for Kalam. Every module codes against these interfaces so that
 * Web and Android share one core (docs/04 §2.2). Pure TypeScript: no React Native imports.
 *
 * Changing a contract is an integration decision — coordinate before editing.
 */
import type { Operation } from 'fast-json-patch';
import type {
  KalamAIBlock, KalamCollection, KalamComponent, KalamField, KalamScreen, KalamSpec, KalamAction, ThemePreset,
} from '../spec/schema';

// ═══ Validation (docs/05 §13) ═════════════════════════════════════════════════
export interface SpecIssue {
  code: string;
  /** JSON-ish path, e.g. `screens[0].children[2].action`. */
  path: string;
  message: string;
  severity: 'error' | 'warning';
  recoverable: boolean;
}
export interface ValidationResult {
  ok: boolean;
  /** Present only when ok — the parsed, normalised spec. */
  spec?: KalamSpec;
  errors: SpecIssue[];
  warnings: SpecIssue[];
}
/** Implemented by `src/core/spec/validate.ts` → `export function validateSpec(input: unknown): ValidationResult`. */
export type ValidateSpec = (input: unknown) => ValidationResult;

// ═══ Formula engine (docs/05 §8) ══════════════════════════════════════════════
/**
 * Grammar (jsep-parsed, whitelist-evaluated, ≤10 000 steps, no member access on globals):
 * - literals: numbers, 'strings', true/false/null
 * - identifiers: `collection` (record list), `collection.field` (value list), `form.field`,
 *   `state.key` (counter/app state), `today` (YYYY-MM-DD), `now` (epoch ms)
 * - operators: + - * / % ; == != < <= > >= ; && || ! ; ternary `a ? b : c`
 * - functions: sum, count, avg, min, max (over lists or varargs), filter(collection, predicate),
 *   if(cond, a, b), round(x, digits?), abs(x), len(text), concat(...), month(date) → 'YYYY-MM'
 * - inside filter/list predicates, bare identifiers are fields of the current record.
 * Examples: `count(orders)`, `sum(expenses.amount)`, `count(filter(doses, date == today))`,
 *   `form.a + form.b`, `if(sum(ledger.amount) > 0, 'Credit', 'Debit')`,
 *   `sum(filter(expenses, month(date) == month(today)).amount)`.
 */
export type FormulaValue = number | string | boolean | null | ReadonlyArray<unknown>;
export interface FormulaContext {
  collections: Readonly<Record<string, ReadonlyArray<Readonly<Record<string, unknown>>>>>;
  form: Readonly<Record<string, unknown>>;
  state: Readonly<Record<string, unknown>>;
  now: Date;
  /** Current record when evaluating list predicates. */
  record?: Readonly<Record<string, unknown>>;
}
export interface FormulaScope {
  /** collection id → field ids */
  collections: Readonly<Record<string, readonly string[]>>;
  formFields: readonly string[];
  stateKeys: readonly string[];
  /** When true (list filter), bare identifiers resolve to these record fields. */
  recordFields?: readonly string[];
}
export type FormulaResult = { ok: true; value: FormulaValue } | { ok: false; error: string };
export interface FormulaDependencies { collections: string[]; form: string[]; state: string[] }
/** Implemented by `src/core/formula/index.ts`:
 *  validateFormula(src, scope): string[] (empty = valid)
 *  evaluateFormula(src, ctx): FormulaResult
 *  formulaDependencies(src): FormulaDependencies
 */

// ═══ Data (docs/04 §13, docs/09) ══════════════════════════════════════════════
export type RecordValue = string | number | boolean | null;
export interface KalamRecord {
  id: string;
  appId: string;
  collectionId: string;
  createdAt: number;
  updatedAt: number;
  values: Record<string, RecordValue>;
}
export interface StoredApp {
  id: string;
  spec: KalamSpec;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
  pinned?: boolean;
  /** How the current version was produced (shown in Shelf / review). */
  origin: { route: CreationRoute; provider?: string; model?: string; templateId?: string };
  /** Original user intent, preserved separately from the spec (docs/06). */
  creationInput?: { text: string; modalities: InputModality[]; drawingId?: string };
  /** Latest AI-step check per block id (docs/13 §8.2), kept on this device beside the spec. Never published. */
  aiVerification?: Record<string, AIBlockVerificationReport>;
}
export interface AppVersion {
  appId: string;
  version: number;
  createdAt: number;
  kind: 'snapshot' | 'patch';
  snapshot?: KalamSpec;
  /** RFC 6902 ops transforming version-1 → version. */
  patch?: Operation[];
  summary: string;
  source: 'create' | 'edit' | 'restore' | 'import';
}
export interface AppRepository {
  list(): Promise<StoredApp[]>;
  get(id: string): Promise<StoredApp | undefined>;
  /** Persists the app and appends a version entry atomically. */
  save(app: StoredApp, change: { summary: string; source: AppVersion['source'] }): Promise<StoredApp>;
  /** Deletes app, its versions, records and state. */
  remove(id: string): Promise<void>;
  touch(id: string): Promise<void>;
}
export interface VersionRepository {
  list(appId: string): Promise<AppVersion[]>;
  /** Rebuilds the spec of a historical version from snapshots + patches. */
  materialize(appId: string, version: number): Promise<KalamSpec | undefined>;
}
export interface RecordRepository {
  list(appId: string, collectionId: string): Promise<KalamRecord[]>;
  listAll(appId: string): Promise<Record<string, KalamRecord[]>>;
  insert(appId: string, collectionId: string, values: Record<string, RecordValue>): Promise<KalamRecord>;
  update(appId: string, collectionId: string, id: string, values: Record<string, RecordValue>): Promise<KalamRecord>;
  remove(appId: string, collectionId: string, id: string): Promise<void>;
  /** Called after any change to the app's records; returns unsubscribe. */
  subscribe(appId: string, listener: () => void): () => void;
}
export interface KeyValueRepository {
  all(appId: string): Promise<Record<string, RecordValue>>;
  set(appId: string, key: string, value: RecordValue): Promise<void>;
  subscribe(appId: string, listener: () => void): () => void;
}
export interface InferenceEventRepository {
  add(event: InferenceEvent): Promise<void>;
  list(limit?: number): Promise<InferenceEvent[]>;
  clear(): Promise<void>;
}
export interface AccessModes {
  large: boolean;
  highContrast: boolean;
  simple: boolean;
  readAloud: boolean;
  leftHanded: boolean;
  /** Voice-only operation: spoken prompts + voice commands drive the app (docs/10 §3.3, §4.5). */
  voiceOnly?: boolean;
}
/** Speech preferences (docs/10 §4.4, §16.2; docs/11 §7.3 — raw audio is not kept unless opted in). */
export interface SpeechPreferences {
  /** BCP-47 tag for speech-to-text, e.g. 'en-IN', 'hi-IN'. */
  sttLanguage: string;
  /** BCP-47 tag for text-to-speech. */
  ttsLanguage: string;
  /** Platform voice identifier (web voiceURI / expo-speech identifier). */
  voiceId?: string;
  /** 0.5–2.0 */
  rate: number;
  /** Keep raw recordings on this device. Default false. Never uploaded. */
  keepRecordings: boolean;
}
export const DEFAULT_SPEECH: SpeechPreferences = { sttLanguage: 'en-IN', ttsLanguage: 'en-IN', rate: 1, keepRecordings: false };
export interface KalamSettings {
  onboarded: boolean;
  /** Hybrid = local first, cloud with consent. offline_only = never call cloud. */
  aiMode: 'hybrid' | 'offline_only';
  /** Consent to send inputs to Firebase cloud inference. */
  allowCloud: boolean;
  /** Consent to use Claude / Nebius specialist providers (server-side). */
  allowExternalProviders: boolean;
  accessModes: AccessModes;
  language: string;
  colorScheme: 'system' | 'light' | 'dark';
  reducedMotion: 'system' | 'on' | 'off';
  /** Count of successful on-device AI actions (docs/07 §13.6). */
  onDeviceActionCount: number;
  /** Speech preferences; absent → DEFAULT_SPEECH. */
  speech?: SpeechPreferences;
  /** Set once the user has seen the first-cloud-send notice (docs/03 §23, docs/11 §8.3). */
  cloudNoticeSeen?: boolean;
  /** Default language for NEW apps (docs/10 §11.2); UI language is `language`. */
  newAppLanguage?: string;
}
export const DEFAULT_SETTINGS: KalamSettings = {
  onboarded: false,
  aiMode: 'hybrid',
  allowCloud: true,
  allowExternalProviders: false,
  accessModes: { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false },
  language: 'en',
  colorScheme: 'system',
  reducedMotion: 'system',
  onDeviceActionCount: 0,
};
export interface SettingsRepository {
  get(): Promise<KalamSettings>;
  update(patch: Partial<KalamSettings>): Promise<KalamSettings>;
}
export interface DrawingRepository {
  save(doc: DrawingDocument): Promise<void>;
  get(id: string): Promise<DrawingDocument | undefined>;
  list(): Promise<DrawingDocument[]>;
  remove(id: string): Promise<void>;
}
/** Implemented by `src/infrastructure/storage/database(.web|.native).ts` → `getDatabase()`. */
export interface KalamDatabase {
  apps: AppRepository;
  versions: VersionRepository;
  records: RecordRepository;
  state: KeyValueRepository;
  events: InferenceEventRepository;
  settings: SettingsRepository;
  drawings: DrawingRepository;
  /** Export everything for backup (records + specs), JSON-serialisable. */
  exportAll(): Promise<KalamBackup>;
  /** Backup files are untrusted: the envelope, every spec and every record are validated. */
  importAll(backup: unknown): Promise<ImportSummary>;
  /** Saves the design of `version` as a NEW current version. Later history and records are kept. */
  restore(appId: string, version: number): Promise<StoredApp>;
  /** Remix: copies the design (not the records) under a new id at version 1 with meta.basedOn. */
  duplicate(appId: string): Promise<StoredApp>;
  // ── Wave-3 repositories (optional until every platform implements them) ──
  /** Per-app translated label views, separate from the canonical spec (docs/05 §11.3, docs/09 §12.3). */
  translations?: TranslationCacheRepository;
  /** Local-only binary attachments (originals, frames, page PNGs). Never uploaded by the store itself. */
  blobs?: BlobRepository;
  /** LRU cache of validated AI results (docs/07 §16.2, cap 500). */
  aiCache?: AICacheRepository;
  /** Recoverable creation sessions (docs/06 §15, docs/03 §7). */
  sessions?: CreationSessionRepository;
}
export interface TranslationCacheEntry {
  appId: string;
  version: number;
  lang: string;
  /** Hash of the source label set, so edits invalidate stale translations. */
  sourceHash: string;
  /** label key → translated text */
  strings: Record<string, string>;
  createdAt: number;
  source: InferenceSource;
  /** User corrected or approved this translation. */
  reviewed?: boolean;
}
export interface TranslationCacheRepository {
  get(appId: string, lang: string): Promise<TranslationCacheEntry | undefined>;
  put(entry: TranslationCacheEntry): Promise<void>;
  listForApp(appId: string): Promise<TranslationCacheEntry[]>;
  removeForApp(appId: string): Promise<void>;
}
export interface StoredBlob {
  id: string;
  kind: 'image' | 'image_original' | 'audio' | 'video_frame' | 'drawing_png' | 'listing_asset';
  mimeType: string;
  base64: string;
  bytes: number;
  createdAt: number;
  /** Owning session / app / drawing id, for cascade cleanup. */
  ownerId?: string;
}
export interface BlobRepository {
  put(blob: Omit<StoredBlob, 'createdAt' | 'bytes'>): Promise<StoredBlob>;
  get(id: string): Promise<StoredBlob | undefined>;
  remove(id: string): Promise<void>;
  removeByOwner(ownerId: string): Promise<number>;
  usage(): Promise<{ count: number; bytes: number }>;
}
export interface AICacheRepository {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, meta: { taskType: TaskType; source: InferenceSource }): Promise<void>;
  clear(): Promise<void>;
  size(): Promise<number>;
}
export interface CreationSession {
  id: string;
  state: 'draft' | 'compiling' | 'review' | 'saved' | 'failed';
  createdAt: number;
  updatedAt: number;
  text: string;
  /** BlobRepository ids for photos, frames and audio kept for this session. */
  attachmentIds: string[];
  drawingId?: string;
  audioTranscript?: string;
  preferences?: NormalizedInput['preferences'];
  lastError?: string;
  resultAppId?: string;
}
export interface CreationSessionRepository {
  save(session: CreationSession): Promise<void>;
  get(id: string): Promise<CreationSession | undefined>;
  latest(): Promise<CreationSession | undefined>;
  remove(id: string): Promise<void>;
}
export interface ImportSummary {
  apps: number;
  records: number;
  skippedApps: number;
  skippedRecords: number;
  skippedState: number;
}
export interface KalamBackup {
  format: 'kalam-backup';
  formatVersion: 1;
  exportedAt: number;
  apps: StoredApp[];
  records: KalamRecord[];
  state: Array<{ appId: string; key: string; value: RecordValue }>;
}

// ═══ Drawing document (docs/08) ═══════════════════════════════════════════════
export interface DrawingPoint { x: number; y: number; pressure?: number }
/** Per-object state shared by every element kind (docs/08 §5.6). */
export interface DrawingElementCommon {
  zIndex?: number;
  locked?: boolean;
  hidden?: boolean;
  /** Rotation in degrees. */
  rotation?: number;
  /** Optional semantic hint for the compiler, e.g. 'header', 'nav', 'total' (docs/08 §11). */
  hint?: string;
  /** Group membership (docs/08 later phase). */
  groupId?: string;
}
export type DrawingElement = DrawingElementCommon & (
  | { id: string; kind: 'stroke'; points: DrawingPoint[]; color: string; size: number; tool: 'pen' | 'marker' | 'highlighter' }
  | { id: string; kind: 'rect' | 'ellipse' | 'line' | 'arrow'; x: number; y: number; w: number; h: number; color: string; size: number }
  | { id: string; kind: 'text'; x: number; y: number; text: string; color: string; fontSize: number }
  | { id: string; kind: 'stamp'; x: number; y: number; w: number; h: number; component: KalamComponent['type']; label?: string }
  /** Placed image; bytes live in BlobRepository (never inline in the document). */
  | { id: string; kind: 'image'; x: number; y: number; w: number; h: number; blobId: string; alt?: string }
);
export interface DrawingPage {
  id: string;
  title: string;
  width: number;
  height: number;
  elements: DrawingElement[];
  background?: 'plain' | 'grid' | 'dots';
  backgroundColor?: string;
}
export interface DrawingDocument {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pages: DrawingPage[];
  /** Document format version; absent = 1 (validate + migrate on load, docs/08 §13). */
  schemaVersion?: number;
  activePageId?: string;
}

// ═══ AI (docs/07 §3.3, §10.1) ═════════════════════════════════════════════════
export type ComplexityLevel = 'simple' | 'medium' | 'complex';
export type TaskType =
  | 'create_app' | 'modify_app' | 'interpret_sketch' | 'generate_patch' | 'extract_data' | 'classify'
  | 'summarize' | 'translate' | 'voice_action' | 'verify_ai_block' | 'safety_review'
  | 'extract_template_params' | 'repair_spec' | 'plan_app';
export type InferenceSource = 'deterministic' | 'on_device' | 'cloud';
export type AIProviderName = 'firebase' | 'claude' | 'nebius' | 'deterministic' | 'none';
export type AIErrorCode =
  | 'offline' | 'consent_denied' | 'model_unavailable' | 'not_configured' | 'timeout' | 'invalid_output'
  | 'provider_error' | 'quota' | 'unsupported_modality' | 'cancelled' | 'app_check_failed'
  /** The provider rejected the request itself (HTTP 400). A request/config problem: never retried. */
  | 'bad_request';

export interface TaskClassification {
  taskType: TaskType;
  complexity: ComplexityLevel;
  estimatedScreens: number;
  estimatedCollections: number;
  estimatedActions: number;
  requiresMultimodalReasoning: boolean;
  requiresCloudReasoning: boolean;
  matchingTemplate?: TemplateId;
  confidence: number;
  method: 'deterministic' | 'on_device' | 'cloud';
  reasons: string[];
}

export interface AIExecutionContext {
  taskId: string;
  taskType: TaskType;
  appId?: string;
  complexity: ComplexityLevel;
  allowCloud: boolean;
  allowExternalProviders: boolean;
  offlineOnly: boolean;
  online: boolean;
}

export type InferenceMode = 'only_on_device' | 'prefer_on_device' | 'only_in_cloud' | 'prefer_in_cloud';
export interface AIImage { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }
export interface StructuredRequest<T> {
  taskType: TaskType;
  system?: string;
  prompt: string;
  images?: AIImage[];
  /** JSON Schema (draft 2020-12 subset) describing the expected output. */
  jsonSchema: Record<string, unknown>;
  /** Final authority: Zod-backed parser. Output is rejected unless this succeeds. */
  parse: (raw: unknown) => { success: true; data: T } | { success: false; error: string };
  mode: InferenceMode;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** Named logical role → model resolved from central config (docs/07 §5.5). */
  role?: ModelRole;
  /**
   * Languages (primary subtags) of the text, for the on-device model's expected inputs and outputs.
   * Absent means ['en']. Only the on-device leg uses it; the cloud model ignores it.
   */
  languages?: readonly string[];
  signal?: AbortSignal;
  /**
   * A provider calls this with the token counts the model reported (Firebase `usageMetadata`) so the
   * orchestrator can record them (docs/07 §16.4). Counts only, never content.
   */
  onUsage?: (usage: { input?: number; output?: number }) => void;
}
export type ModelRole =
  | 'compiler' | 'local_assistant' | 'edit' | 'voice' | 'ai_block' | 'judge' | 'safety' | 'translation' | 'repair';

export interface AIExecutionResult<T> {
  success: boolean;
  output?: T;
  provider: AIProviderName;
  source: InferenceSource;
  model?: string;
  latencyMs: number;
  fallbackUsed: boolean;
  errorCode?: AIErrorCode;
  errorMessage?: string;
  /** Inference event id recorded for this execution. */
  eventId?: string;
  /** Fields the model read but marked as unsure, e.g. smudged handwriting (docs/16 R-016). Photo AI steps only. */
  uncertainFields?: string[];
}

/**
 * Why on-device AI cannot run right now, where the platform can tell (Android: AICore through ML Kit, reported by
 * modules/kalam-nano). `detail` says the same in plain English.
 */
export type OnDeviceReason =
  | 'aicore_missing' | 'binding_failure' | 'aicore_not_ready' | 'needs_system_update' | 'device_not_supported'
  | 'model_downloadable' | 'model_downloading' | 'low_storage' | 'battery_or_network_conditions' | 'unknown';

export interface OnDeviceStatus {
  platform: 'web' | 'android' | 'ios' | 'other';
  /** Prompt API / native on-device bridge exists on this platform. */
  apiExposed: boolean;
  availability: 'unavailable' | 'downloadable' | 'downloading' | 'available' | 'unknown';
  progress?: number;
  detail?: string;
  /** Set when the model cannot run now and the platform said why. */
  reason?: OnDeviceReason;
  /** The AICore or ML Kit error code behind `reason`, for example 601 (AICore could not be bound). */
  reasonCode?: number;
  /**
   * Model is loaded in memory (a session exists), so a prompt answers in about a second instead of
   * waiting for the first-load cost. Only reported where the platform can tell (web Prompt API).
   */
  warm?: boolean;
}

export interface InferenceEvent {
  id: string;
  at: number;
  taskId: string;
  taskType: TaskType;
  appId?: string;
  complexity?: ComplexityLevel;
  classificationMethod?: TaskClassification['method'];
  route: 'deterministic' | 'template' | 'on_device' | 'cloud' | 'specialist';
  provider: AIProviderName;
  model?: string;
  source: InferenceSource;
  latencyMs: number;
  success: boolean;
  fallbackUsed: boolean;
  escalationReason?: string;
  errorCode?: AIErrorCode;
  inputChars?: number;
  outputChars?: number;
  // Richer observability (docs/04 §20.2, docs/07 §16.4, §19.3) — optional.
  promptVersion?: string;
  retries?: number;
  tokens?: { input?: number; output?: number };
  platform?: 'web' | 'android' | 'other';
  cacheHit?: boolean;
  classificationConfidence?: number;
  /** KalamSpec schema version in force for this run (docs/04 §20.2). */
  schemaVersion?: string;
}

export interface AIProvider {
  readonly name: AIProviderName;
  isConfigured(): boolean;
  onDeviceStatus(): Promise<OnDeviceStatus>;
  /** Triggers on-device model download where supported (needs user gesture on web). */
  prepareOnDevice?(onProgress?: (p: number) => void): Promise<OnDeviceStatus>;
  /** Loads an already-downloaded on-device model into memory. Never downloads; no user gesture needed. */
  warmUpOnDevice?(): Promise<OnDeviceStatus>;
  generateStructured<T>(req: StructuredRequest<T>): Promise<AIExecutionResult<T>>;
}

/** Implemented by `src/core/ai/orchestrator.ts` → `createOrchestrator(deps)`. */
export interface AIOrchestrator {
  run<T>(
    req: StructuredRequest<T>,
    ctx: {
      taskType: TaskType; complexity?: ComplexityLevel; appId?: string; escalationReason?: string;
      /** How the request was classified, recorded on the event (docs/07 §3.5). */
      classification?: Pick<TaskClassification, 'method' | 'confidence'>;
    },
  ): Promise<AIExecutionResult<T>>;
  /** Records a deterministic/template decision (no model call) for observability. */
  recordDeterministic(e: Omit<InferenceEvent, 'id' | 'at' | 'provider' | 'source' | 'fallbackUsed'>): Promise<void>;
  /** Time-boxed: a slow on-device availability check reports `unknown` instead of stalling callers. */
  status(): Promise<{ onDevice: OnDeviceStatus; cloudConfigured: boolean; online: boolean; specialistConfigured: boolean }>;
  prepareOnDevice(onProgress?: (p: number) => void): Promise<OnDeviceStatus>;
  /**
   * Fire-and-forget warm-up for screens that will soon need Gemini Nano (e.g. /create on open).
   * Only acts when the model is already `available`: no download, no user gesture. Safe to call often.
   */
  warmUpOnDevice(): Promise<OnDeviceStatus>;
}

// ═══ Generation (docs/07 §4, §11) ═════════════════════════════════════════════
export type InputModality = 'text' | 'image' | 'audio' | 'video' | 'drawing';
export type TemplateId =
  | 'calculator' | 'counter' | 'checklist' | 'notes' | 'expense_tracker' | 'habit_tracker' | 'contact_book'
  | 'inventory' | 'simple_form' | 'measurement_log' | 'reminder_list';

export interface NormalizedImage extends AIImage {
  id: string;
  width: number;
  height: number;
  source: 'photo' | 'drawing' | 'video_frame' | 'screenshot';
  label?: string;
}
export interface DrawingSummary {
  drawingId: string;
  pageCount: number;
  /** Deterministically extracted structure (stamps, text labels, boxes) — docs/07 §14.5. */
  elements: Array<{
    kind: string; label?: string; page: number; bbox: [number, number, number, number];
    /** User-tagged role: 'header' | 'nav' | 'total' | 'list_item' (docs/08 §15.5). User intent beats visual inference. */
    hint?: string;
  }>;
  texts: string[];
  /** Spatial cues in plain sentences (arrows, repeated rows, title, bottom bar). Suggestions, not facts (docs/08 §15.4, §15.7). */
  notes?: string[];
  /** Rasterised pages (PNG/JPEG) for cloud vision when needed. */
  images: NormalizedImage[];
}
/** Every modality normalises into this before the pipeline (docs/07 §11.3 stage 2). */
export interface NormalizedInput {
  text: string;
  modalities: InputModality[];
  images: NormalizedImage[];
  audioTranscript?: string;
  video?: { frames: NormalizedImage[]; durationSec: number; summary?: string };
  drawing?: DrawingSummary;
  language?: string;
  preferences?: { themePreset?: ThemePreset; currency?: string };
  /** Present when editing an existing app. */
  existingSpec?: KalamSpec;
}

export interface TemplateDefinition<P = Record<string, unknown>> {
  id: TemplateId;
  title: string;
  description: string;
  keywords: string[];
  /** Example requests used for matching + classifier benchmarks. */
  examples: string[];
  /** Zod schema for parameters (also the on-device structured-output schema). */
  paramsSchema: import('zod').ZodType<P>;
  defaults: P;
  /** Deterministic parameter extraction from text (no LLM). */
  extractParams(text: string): Partial<P>;
  build(params: P, opts: { appId: string; now: number; lang: string }): KalamSpec;
}
export interface TemplateMatch { templateId: TemplateId; score: number; matchedKeywords: string[] }

export type CreationRoute = 'template' | 'template+on_device' | 'cloud' | 'cloud+repair' | 'specialist' | 'import' | 'manual';
export type CreationStage =
  | 'normalizing' | 'classifying' | 'matching_template' | 'extracting_params' | 'generating_cloud'
  | 'planning_specialist' | 'validating' | 'repairing' | 'verifying' | 'done' | 'failed';

export interface UnderstandingSummary {
  appName: string;
  purpose: string;
  screens: Array<{ id: string; title: string; items: string[] }>;
  collections: Array<{ id: string; name: string; fields: Array<{ label: string; type: string; required: boolean }> }>;
  actions: string[];
  aiFeatures: Array<{ id: string; kind: string; description: string; verified: string }>;
  assumptions: string[];
}
export interface CreationResult {
  ok: boolean;
  spec?: KalamSpec;
  classification: TaskClassification;
  route: CreationRoute;
  provider: AIProviderName;
  model?: string;
  understanding?: UnderstandingSummary;
  warnings: SpecIssue[];
  errors: SpecIssue[];
  /** User-facing message on failure (never raw stack traces). */
  message?: string;
  /** Questions to ask when the request is ambiguous (docs/07 §11.4). */
  clarifications?: string[];
  latencyMs: number;
  /** Build-time AI-step checks, one per AI block (docs/00 §10 step 8, docs/04 §8.12). */
  verification?: AIBlockVerificationReport[];
}
/** Implemented by `src/core/pipeline/create-application.ts` → `createApplicationPipeline(deps)`. */
export type CreateApplication = (
  input: NormalizedInput,
  opts?: { signal?: AbortSignal; onStage?: (stage: CreationStage, detail?: string) => void },
) => Promise<CreationResult>;

// ═══ Editing (docs/07 §15) ════════════════════════════════════════════════════
export type SpecPatchOp =
  | { op: 'setThemeToken'; token: 'primary' | 'secondary' | 'background' | 'surface' | 'text'; value: string }
  | { op: 'setThemeNumber'; token: 'radius' | 'fontScale'; value: number }
  | { op: 'setThemePreset'; preset: ThemePreset }
  /** fontFamily ∈ FONT_FAMILIES; spacing ∈ compact | comfortable | spacious. */
  | { op: 'setThemeOption'; option: 'fontFamily' | 'spacing'; value: string }
  | { op: 'setAppName'; value: string }
  | { op: 'setLanguage'; value: string }
  | { op: 'renameComponent'; component: string; label: string }
  | { op: 'setComponentProperty'; component: string; property: string; value: string | number | boolean }
  | { op: 'addComponent'; screen: string; component: KalamComponent; index?: number }
  | { op: 'removeComponent'; component: string }
  | { op: 'moveComponent'; component: string; direction: 'up' | 'down' }
  | { op: 'addScreen'; screen: KalamScreen; after?: string }
  | { op: 'removeScreen'; screen: string }
  | { op: 'renameScreen'; screen: string; title: string }
  | { op: 'addCollection'; id: string; collection: KalamCollection }
  | { op: 'updateCollectionField'; collection: string; field: string; definition: KalamField }
  | { op: 'addAction'; id: string; action: KalamAction }
  | { op: 'addAIBlock'; id: string; block: KalamAIBlock };
export type EditClass = 'small' | 'structural';
export interface PatchResult { ok: boolean; spec?: KalamSpec; errors: SpecIssue[] }
/** Implemented by `src/core/edit/index.ts`:
 *  applyPatchOps(spec, ops): PatchResult  (validates; never mutates input)
 *  classifyEdit(text, spec): { editClass: EditClass; reasons: string[] }
 *  parseSmallEdit(text, spec): { ops: SpecPatchOp[]; confidence: number; unmatched: string[] }  (deterministic)
 */

// ═══ Runtime (docs/09) ════════════════════════════════════════════════════════
export interface AIBlockRunInput {
  appId: string;
  blockId: string;
  block: KalamAIBlock;
  spec: KalamSpec;
  image?: AIImage;
  formValues: Record<string, RecordValue>;
}
// ═══ Application services (composed in src/services/index.ts) ═════════════════
export interface EditOutcome {
  ok: boolean;
  spec?: KalamSpec;
  ops?: SpecPatchOp[];
  editClass: EditClass;
  route: 'deterministic' | 'on_device' | 'cloud' | 'specialist';
  provider: AIProviderName;
  /** Plain-language summary of the change, stored as the version summary. */
  summary: string;
  errors: SpecIssue[];
  message?: string;
  latencyMs: number;
}
/** Implemented by `src/core/tasks/edit-service.ts` → `createEditService(deps)`. */
export interface EditService {
  /** Small edits: deterministic parser → Nano patch. Structural: Firebase cloud. Never mutates input. */
  applyInstruction(spec: KalamSpec, instruction: string, opts?: { signal?: AbortSignal }): Promise<EditOutcome>;
  applyOps(spec: KalamSpec, ops: SpecPatchOp[], summary: string): EditOutcome;
}
/** Why an AI-step check gave no final answer (docs/13 §8.2). */
export type AIBlockVerificationReason =
  | 'needs_samples' | 'device_unsupported' | 'device_not_ready' | 'device_loading' | 'offline' | 'cloud_off'
  | 'not_configured' | 'timeout' | 'cancelled' | 'failed';
export interface AIBlockVerificationOutcome {
  status: 'onDevice' | 'cloudPreferred' | 'unverified';
  testCount: number;
  passCount: number;
  model?: string;
  details: Array<{
    input: string; expected: unknown; actual: unknown; pass: boolean; reason?: string;
    /** On-device run time and error, for the docs/07 §13.5 metrics. */
    latencyMs?: number; errorCode?: AIErrorCode;
  }>;
  message?: string;
  /** Set when status is 'unverified'. */
  reason?: AIBlockVerificationReason;
  /** The cloud judge graded at least one case (open-ended kinds only, lead decision 5). */
  judgeUsed?: boolean;
  /** Capability context the check ran in (docs/15 §9.5). Absent when it stopped before reading it. */
  device?: Pick<OnDeviceStatus, 'platform' | 'availability'>;
}
/** One AI-step check as kept with the app (docs/13 §8.2). Text test inputs are model-written, not user records. */
export interface AIBlockVerificationReport {
  blockId: string;
  /** spec.version the check ran against. */
  appVersion: number;
  /** Hash of the block definition: a different hash means the block changed and needs a new check (docs/13 §8.3). */
  blockHash: string;
  /** Version of Kalam's test-writing, device-run and judge prompts. */
  promptVersion: string;
  status: AIBlockVerificationOutcome['status'];
  reason?: AIBlockVerificationReason;
  testCount: number;
  passCount: number;
  model?: string;
  judgeUsed: boolean;
  /** Platform and on-device model state the check ran in (docs/15 §9.5). */
  device?: AIBlockVerificationOutcome['device'];
  /** Inputs, expected and actual outputs, outcomes. Photo checks keep only which fields were read. */
  cases: AIBlockVerificationOutcome['details'];
  message: string;
  checkedAt: number;
}
/** Implemented by `src/core/tasks/ai-block-service.ts` → `createAIBlockService(deps)`. */
export interface AIBlockService {
  run(input: AIBlockRunInput): Promise<AIExecutionResult<Record<string, RecordValue>>>;
  /** docs/07 §13.4: cloud generates 5 cases, on-device executes, deterministic+judge grading, ≥4/5 → onDevice. */
  verify(
    spec: KalamSpec,
    blockId: string,
    opts?: {
      signal?: AbortSignal;
      /** Real example photos for `extractFromPhoto` blocks. Without them such blocks stay `unverified`. */
      samplePhotos?: AIImage[];
      /** Re-runs these stored cases instead of writing new ones: reproducible, no cloud call for cases (docs/07 CP7). */
      cases?: Array<{ input: string; expected: string }>;
    },
  ): Promise<AIBlockVerificationOutcome>;
}
export interface VoiceActionResult {
  action: string | null;
  fields: Record<string, RecordValue>;
  confidence: 'high' | 'low';
  source: InferenceSource;
}
/** Implemented by `src/core/tasks/voice-service.ts` → `createVoiceService(deps)`. Intents first, then Nano. */
export interface VoiceService {
  interpret(spec: KalamSpec, screenId: string, transcript: string): Promise<VoiceActionResult>;
}
/** Implemented by `src/infrastructure/platform/network(.web|.native).ts` → `getNetworkMonitor()`. */
export interface NetworkMonitor {
  online(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}
export interface KalamServices {
  db: KalamDatabase;
  ai: AIOrchestrator;
  network: NetworkMonitor;
  createApplication: CreateApplication;
  edit: EditService;
  aiBlocks: AIBlockService;
  voice: VoiceService;
  /** Optional account (Firebase Auth). Never required to create or use apps (docs/04 §15.4). */
  auth: AuthService;
  /** Kalam Bazaar marketplace over the named Firestore database `kalam` (docs/12). */
  bazaar: BazaarService;
  /** App-label translation (TRANSLATE role, docs/17 §7.6). Optional until wired. */
  translate?: TranslateService;
  /** Encrypted backup / restore (docs/11 §12). Optional until wired. */
  backup?: BackupService;
}

// ═══ Translation (docs/05 §9.7, §11.3; docs/17 §7.6) ═════════════════════════
export interface TranslateAppResult {
  ok: boolean;
  lang: string;
  /** label key → translated text (keys from `collectTranslatableLabels`). */
  strings?: Record<string, string>;
  source: InferenceSource;
  cached: boolean;
  /** Keys that could not be translated or failed placeholder validation (fall back to original). */
  missing: string[];
  message?: string;
}
/** Implemented by `src/core/tasks/translate-service.ts` → `createTranslateService(deps)`. */
export interface TranslateService {
  translateApp(
    spec: KalamSpec,
    lang: string,
    /** `preferCloud`: the person asked for cloud quality, so the on-device model is skipped (docs/10 §15.3). */
    opts?: { signal?: AbortSignal; force?: boolean; preferCloud?: boolean },
  ): Promise<TranslateAppResult>;
  /** User correction of one label; marks the cache entry reviewed. */
  correct(appId: string, lang: string, key: string, text: string): Promise<void>;
}

// ═══ Backup (docs/11 §12, docs/04 §17) ═══════════════════════════════════════
export interface BackupManifest {
  format: 'kalam-encrypted-backup';
  formatVersion: 1;
  createdAt: number;
  appCount: number;
  recordCount: number;
  includes: Array<'apps' | 'versions' | 'records' | 'state' | 'drawings' | 'settings'>;
  /** SHA-256 of the plaintext payload, hex. */
  checksum: string;
}
/** Implemented by `src/core/backup/` → `createBackupService(deps)`. AES-GCM + PBKDF2 (@noble). */
export interface BackupService {
  exportEncrypted(passphrase: string): Promise<{ bytes: Uint8Array; manifest: BackupManifest }>;
  /** Reads the manifest without importing (preview before overwrite). Throws on wrong passphrase. */
  preview(bytes: Uint8Array, passphrase: string): Promise<BackupManifest>;
  importEncrypted(bytes: Uint8Array, passphrase: string, opts?: { overwrite?: boolean }): Promise<ImportSummary>;
}

export interface RuntimeServices {
  records: RecordRepository;
  state: KeyValueRepository;
  runAIBlock(input: AIBlockRunInput): Promise<AIExecutionResult<Record<string, RecordValue>>>;
  speak(text: string, lang: string): void;
  pickImage(): Promise<AIImage | undefined>;
  confirm(message: string): Promise<boolean>;
  online(): boolean;
}

// ═══ Account (docs/04 §15.4, docs/11 §9) ══════════════════════════════════════
/** Public view of the signed-in Firebase user. Tokens never leave the Firebase SDK. */
export interface KalamUser {
  uid: string;
  isAnonymous: boolean;
  displayName: string | null;
  email: string | null;
  /** Firebase provider ids, e.g. `password`, `google.com`. Empty for guests. */
  providers: string[];
}
export type AuthErrorCode =
  | 'not_configured' | 'offline' | 'cancelled' | 'invalid_credentials' | 'email_in_use' | 'weak_password'
  | 'invalid_email' | 'popup_blocked' | 'unsupported' | 'too_many_requests' | 'not_allowed'
  | 'unauthorized_domain' | 'requires_recent_login' | 'unknown';
export interface AuthResult {
  ok: boolean;
  user?: KalamUser;
  errorCode?: AuthErrorCode;
  /** Plain-language message for the person (never a raw Firebase error). */
  message?: string;
}
/** Implemented by `src/infrastructure/firebase/auth(.web|.native).ts` → `getAuthService()`. */
export interface AuthService {
  isConfigured(): boolean;
  current(): KalamUser | null;
  /** Resolves once Firebase has restored a saved session (immediately when not configured). */
  ready(): Promise<void>;
  subscribe(listener: (user: KalamUser | null) => void): () => void;
  /** Google sign-in needs a browser popup; the Android app needs the native SDK (not wired yet). */
  supportsGoogle(): boolean;
  /** Links to the current guest account when there is one, so the uid (likes, listings) is kept. */
  signInWithGoogle(): Promise<AuthResult>;
  signInWithEmail(email: string, password: string): Promise<AuthResult>;
  /** Upgrades a guest account in place when signed in as a guest. */
  signUpWithEmail(email: string, password: string, displayName?: string): Promise<AuthResult>;
  signInAsGuest(): Promise<AuthResult>;
  setDisplayName(name: string): Promise<AuthResult>;
  signOut(): Promise<void>;
}

// ═══ Kalam Bazaar (docs/12) ═══════════════════════════════════════════════════
import type {
  BazaarListing, BazaarPage, BazaarQuery, Entitlement, ListingStatus, ReportReason, Wallet, WalletTransaction,
} from '../bazaar/model';
import type { InstallMode } from '../bazaar/install';
import type { Screenshot } from '../bazaar/media';
import type { PublishForm } from '../bazaar/publish';
import type { BazaarReview } from '../bazaar/reviews';

export type BazaarPublishStage = 'validating' | 'checking' | 'saving';
export interface BazaarPublishOutcome {
  /** True when the listing was written (published, pending or needs changes). */
  ok: boolean;
  listingId?: string;
  status?: ListingStatus;
  message: string;
  /** Safety reasons the publisher can act on. */
  reasons?: string[];
  /** Spec validation issues (nothing is written when present). */
  issues?: SpecIssue[];
  /** Provenance of the cloud safety check, when it ran. `cached`: reused for identical content. */
  review?: { provider: AIProviderName; source: InferenceSource; model?: string; latencyMs: number; cached?: boolean };
}
export interface BazaarInstallOutcome {
  ok: boolean;
  appId?: string;
  message: string;
  /** True when the install was counted on the listing (signed in + online + first install). */
  counted?: boolean;
}
export type BazaarSpecResult =
  | { ok: true; spec: KalamSpec; fromCache: boolean }
  | { ok: false; message: string };
/** One row of My Library (docs/12 §4.1, §11.4, §19.1): installed copies plus account entitlements. */
export interface BazaarLibraryItem {
  listingId: string;
  /** Latest known listing (live or cached). */
  listing?: BazaarListing;
  /** The copy on this device, when there is one. */
  localAppId?: string;
  localName?: string;
  installedVersion?: number;
  entitlement?: Entitlement;
  updateAvailable: boolean;
}
/** A newer published version for an installed copy (docs/12 §10.3-10.4). */
export interface BazaarUpdateCheck {
  available: boolean;
  listing?: BazaarListing;
  installedVersion?: number;
  /** Plain-language differences between the installed design and the new one. */
  changes: string[];
  /** True when the person changed their copy; the safe path is then a separate copy. */
  localEdits: boolean;
  message?: string;
}
export interface BazaarWalletView {
  /** Credits are switched on in this build (EXPO_PUBLIC_BAZAAR_PAYMENTS). */
  enabled: boolean;
  signedIn: boolean;
  wallet?: Wallet;
  transactions: WalletTransaction[];
  message?: string;
}
/** A publish form kept on this device until it is sent (docs/12 §19.3). */
export interface BazaarDraft {
  appId: string;
  listingId?: string;
  form: PublishForm;
  makerName: string;
  savedAt: number;
}
export interface BazaarCreatorStats {
  listings: number;
  published: number;
  waiting: number;
  needsChanges: number;
  unpublished: number;
  installs: number;
  likes: number;
  ratingCount: number;
  ratingAvg: number;
  creditsEarned: number;
}
export interface BazaarReviewsView {
  reviews: BazaarReview[];
  mine?: BazaarReview;
  /** Signed in with an install or purchase of this listing (docs/12 §14.2). */
  canReview: boolean;
}
/** Implemented by `src/infrastructure/bazaar/bazaar-service.ts` → `createBazaarService(deps)`. */
export interface BazaarService {
  isConfigured(): boolean;
  /** Published listings, 20 per page. Offline: cached cards with `fromCache: true`. */
  browse(query: BazaarQuery): Promise<BazaarPage>;
  getListing(id: string): Promise<{ listing: BazaarListing; fromCache: boolean } | undefined>;
  /** Downloads (or reads the cached copy of) the spec, hash-checked and validated. Used for preview. */
  loadSpec(listing: BazaarListing): Promise<BazaarSpecResult>;
  /** Local copy on the shelf. Works offline when the spec was downloaded before. */
  install(listing: BazaarListing, mode: InstallMode): Promise<BazaarInstallOutcome>;
  /** Publishes a local app, or a new version when `listingId` is one of mine. Needs a full account. */
  publish(
    input: { appId: string; form: PublishForm; makerName: string; listingId?: string; screenshots?: Screenshot[] },
    onStage?: (stage: BazaarPublishStage) => void,
  ): Promise<BazaarPublishOutcome>;
  /** Changes title, description, category, tags, language, price, icon or screenshots, never the spec (§13.2). */
  editDetails(
    listingId: string,
    input: { form: PublishForm; makerName: string; screenshots?: Screenshot[] },
  ): Promise<BazaarPublishOutcome>;
  /** Runs the checks again for a listing that is waiting, or shows an unpublished one again. */
  recheck(listingId: string): Promise<BazaarPublishOutcome>;
  unpublish(listingId: string): Promise<BazaarPublishOutcome>;
  myListings(): Promise<BazaarListing[]>;
  isLiked(listingId: string): Promise<boolean>;
  setLiked(listingId: string, liked: boolean): Promise<{ ok: boolean; message?: string }>;
  report(listingId: string, reason: ReportReason, note: string): Promise<{ ok: boolean; message: string }>;
  /** Screenshots, validated from their bytes on every read. */
  loadMedia(listingId: string): Promise<Screenshot[]>;
  /** Credits switched on for this build (paid listings need the trusted purchase function). */
  paymentsEnabled(): boolean;
  /** Buys a paid listing through the trusted function, then installs it. */
  purchase(listing: BazaarListing): Promise<BazaarInstallOutcome>;
  wallet(): Promise<BazaarWalletView>;
  claimStarterCredits(): Promise<{ ok: boolean; message: string; credits?: number }>;
  reviews(listingId: string): Promise<BazaarReviewsView>;
  saveReview(listing: BazaarListing, rating: number, comment: string): Promise<{ ok: boolean; message: string }>;
  deleteReview(listing: BazaarListing): Promise<{ ok: boolean; message: string }>;
  respondToReview(listingId: string, reviewerUid: string, response: string): Promise<{ ok: boolean; message: string }>;
  library(): Promise<BazaarLibraryItem[]>;
  checkUpdate(appId: string): Promise<BazaarUpdateCheck>;
  /** `replace`: new design version in the same app (history kept). `copy`: a separate app, nothing touched. */
  applyUpdate(appId: string, mode: 'replace' | 'copy'): Promise<BazaarInstallOutcome>;
  creatorStats(listings: BazaarListing[]): Promise<BazaarCreatorStats>;
  drafts(): Promise<BazaarDraft[]>;
  saveDraft(draft: BazaarDraft): Promise<void>;
  removeDraft(appId: string): Promise<void>;
}
