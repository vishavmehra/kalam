/**
 * Runtime engine types (docs/09 §6–7). Pure TypeScript — no React / RN imports — so the whole
 * behaviour of a generated app can be exercised under Vitest.
 */
import type { AccessModes, InferenceSource, KalamRecord, RecordValue, RuntimeServices } from '@/core/contracts';
import type { KalamFieldType, KalamSpec, KalamThen } from '@/core/spec/schema';

/**
 * Raw form values. Number inputs may hold the user's in-progress text ("12.") until they are
 * coerced at validation / insert time, so this is deliberately wider than RecordValue.
 */
export type FormValues = Record<string, RecordValue>;

export interface FieldDef {
  id: string;
  type: KalamFieldType;
  label: string;
  required: boolean;
  min?: number;
  max?: number;
  decimals?: number;
  unit?: string;
  maxLength?: number;
  options?: readonly string[];
  defaultValue?: RecordValue;
}

export interface Selection {
  collection: string;
  recordId: string;
}

export interface RuntimeState {
  /** Screen ids; the last entry is the current screen. Bounded by the number of screens. */
  stack: string[];
  /** Raw form values per screen. Absent → defaults. */
  forms: Record<string, FormValues>;
  /** Validation messages for the current screen, keyed by field id. */
  errors: Record<string, string>;
  selection: Selection | null;
  /**
   * The entry each screen on the stack was opened with, by screen id. Going back to a page restores its
   * entry as the selection, so a customer's page still totals that customer after an entry's page was open.
   */
  opened?: Record<string, Selection>;
}

export interface DataSnapshot {
  records: Record<string, KalamRecord[]>;
  state: Record<string, RecordValue>;
}

/** Honest execution-source badge (docs/02 §2.1 G). */
export type ExecutionBadge = 'on_device' | 'cloud' | 'deterministic' | 'offline';

export interface AIProposal {
  blockId: string;
  screenId: string;
  /** Validated values, ready to merge into the form after the user accepts. */
  values: FormValues;
  /** Fields the model returned that failed validation (never applied). */
  rejected: Array<{ field: string; reason: string }>;
  /** Filled fields the model was unsure of (low confidence or smudged), docs/16 R-016. The review should mark these, never present them as confirmed. */
  uncertain?: string[];
  /** The model's own confidence and rough place on the page for each filled field (docs/14 §9.4). Its estimate, not a measurement. */
  readings?: Record<string, { confidence?: 'high' | 'medium' | 'low'; area?: string }>;
  source: InferenceSource;
  provider: string;
  model?: string;
  latencyMs: number;
  then?: KalamThen;
}

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export type RuntimeEffect =
  | { type: 'toast'; message: string; tone: ToastTone }
  | { type: 'speak'; text: string }
  | { type: 'aiProposal'; proposal: AIProposal }
  | { type: 'aiUnavailable'; blockId: string; badge: ExecutionBadge; message: string };

export type RuntimeErrorCode =
  | 'unknown_action' | 'missing_collection' | 'invalid_screen' | 'validation_failed' | 'no_selection'
  | 'record_not_found' | 'storage_failed' | 'cancelled' | 'ai_unavailable' | 'ai_failed' | 'missing_input' | 'formula_failed';

export interface ActionResult {
  ok: boolean;
  state: RuntimeState;
  effects: RuntimeEffect[];
  error?: RuntimeErrorCode;
  /** Key-value writes already persisted, so the UI can update optimistically before the subscription fires. */
  kvWrites?: Record<string, RecordValue>;
}

export interface EngineEnv {
  spec: KalamSpec;
  appId: string;
  services: RuntimeServices;
  data: DataSnapshot;
  now: Date;
}

export type { AccessModes };
