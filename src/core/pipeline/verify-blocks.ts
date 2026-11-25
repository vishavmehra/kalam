/**
 * The 'verifying' build stage: AI steps are checked while the app is built (docs/00 §10 step 8,
 * docs/04 §8.10, docs/05 §9.8, docs/07 §13.4; lead decisions 5 and 18). Runs after the spec validates.
 *
 * - Grading is deterministic first; the cloud judge is used only for open-ended kinds (summarise,
 *   translate). Both live in AIBlockService.verify.
 * - Cheap checks come first, so no cloud call is spent on a result that cannot count. No Gemini Nano,
 *   offline, cloud help off or offline-only mode, cloud not set up, or a model still loading each give
 *   an honest "not checked yet" report and make no model call. Photo steps need real sample photos,
 *   so at build time they are reported as waiting for samples.
 * - Bounded: the whole stage gets VERIFY_BUDGET_MS. A step still running at the deadline is aborted and
 *   reported as not checked, so the app is ready to save within that time.
 * - A step is marked checked in the spec only when its tests really ran (recordVerification).
 */
import type {
  AIBlockService, AIBlockVerificationReason, AIBlockVerificationReport, AIOrchestrator, StoredApp, UnderstandingSummary,
} from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { recordVerification, verificationReport } from '../tasks/ai-block-service';
import { VERIFY_COPY } from './copy';
import { withDeadline } from './deadline';

/** The verifying stage adds at most this much to a build: 30 s, about two typical AI steps. */
export const VERIFY_BUDGET_MS = 30_000;

/** Reasons that hold for every remaining step, so testing the rest now is pointless. */
const STOPS_ALL: ReadonlySet<AIBlockVerificationReason> = new Set<AIBlockVerificationReason>([
  'device_unsupported', 'device_not_ready', 'device_loading', 'offline', 'cloud_off', 'not_configured', 'cancelled',
]);

export interface VerifyStageDeps {
  ai: AIOrchestrator;
  aiBlocks: Pick<AIBlockService, 'verify'>;
  /** False when cloud help is off or offline-only mode is on. Absent: the orchestrator still enforces consent. */
  cloudConsent?: () => boolean | Promise<boolean>;
  now: () => number;
  budgetMs?: number;
}

export interface VerifyStageResult {
  spec: KalamSpec;
  /** One report per AI block, in block order. */
  reports: AIBlockVerificationReport[];
  /** Reasons of the steps that were not attempted at all (no model call was made for them). */
  skipped: AIBlockVerificationReason[];
}

/** Why no step can be tested right now, or undefined when testing can start. Makes no model call. */
async function blockedBy(deps: VerifyStageDeps): Promise<AIBlockVerificationReason | undefined> {
  const status = await deps.ai.status();
  const device = status.onDevice;
  if (device.availability === 'unavailable') return 'device_unsupported';
  if (device.availability !== 'available') return 'device_not_ready';
  if (!status.online) return 'offline';
  let consent: boolean;
  try {
    consent = deps.cloudConsent ? await deps.cloudConsent() : true;
  } catch {
    consent = false; // settings could not be read: never assume consent
  }
  if (!consent) return 'cloud_off';
  if (!status.cloudConfigured) return 'not_configured';
  if (device.warm === false) {
    // A cold model needs about 40 s to load. Warm it for next time instead of paying for tests it cannot finish.
    void deps.ai.warmUpOnDevice().catch(() => {});
    return 'device_loading';
  }
  return undefined;
}

export async function verifyAIBlocks(
  spec: KalamSpec,
  deps: VerifyStageDeps,
  opts: { signal?: AbortSignal; onProgress?: (n: number, total: number) => void; only?: readonly string[] } = {},
): Promise<VerifyStageResult> {
  const ids = Object.keys(spec.aiBlocks).filter((id) => !opts.only || opts.only.includes(id));
  const testable = ids.filter((id) => spec.aiBlocks[id]?.kind !== 'extractFromPhoto');
  const started = deps.now();
  const budget = deps.budgetMs ?? VERIFY_BUDGET_MS;
  let blocked = testable.length ? await blockedBy(deps) : undefined;
  let out = spec;
  let n = 0;
  const reports: AIBlockVerificationReport[] = [];
  const skipped: AIBlockVerificationReason[] = [];
  const notChecked = (id: string, reason: AIBlockVerificationReason, attempted = false) => {
    if (!attempted) skipped.push(reason);
    reports.push(verificationReport(out, id, {
      status: 'unverified', testCount: 0, passCount: 0, details: [], reason, message: VERIFY_COPY.notChecked[reason],
    }, deps.now()));
  };

  for (const id of ids) {
    if (spec.aiBlocks[id]?.kind === 'extractFromPhoto') {
      notChecked(id, 'needs_samples');
      continue;
    }
    if (!blocked && opts.signal?.aborted) blocked = 'cancelled';
    const left = budget - (deps.now() - started);
    if (blocked || left <= 0) {
      notChecked(id, blocked ?? 'timeout');
      continue;
    }
    opts.onProgress?.(++n, testable.length);
    const outcome = await withDeadline((signal) => deps.aiBlocks.verify(out, id, { signal }), left, opts.signal);
    if (!outcome) {
      notChecked(id, opts.signal?.aborted ? 'cancelled' : 'timeout', true);
      continue;
    }
    out = recordVerification(out, id, outcome, deps.now());
    // An early stop for a reason that is not about this step reads better in the build's own words.
    const general = outcome.testCount === 0 && outcome.reason && STOPS_ALL.has(outcome.reason);
    reports.push(verificationReport(out, id, general && outcome.reason
      ? { ...outcome, message: VERIFY_COPY.notChecked[outcome.reason] }
      : outcome, deps.now()));
    if (general) blocked = outcome.reason;
  }
  return { spec: out, reports, skipped };
}

/** The review shows the check's own words for steps that are still unverified ("Not checked yet. ..."). */
export function withCheckMessages(u: UnderstandingSummary, reports: readonly AIBlockVerificationReport[]): UnderstandingSummary {
  if (!reports.length) return u;
  return {
    ...u,
    aiFeatures: u.aiFeatures.map((f) => {
      const r = reports.find((x) => x.blockId === f.id);
      return r && r.status === 'unverified' && r.message ? { ...f, verified: r.message } : f;
    }),
  };
}

/** Reports keyed by block id for `StoredApp.aiVerification`, without steps no longer in `spec`. */
export function reportsByBlock(
  spec: KalamSpec, reports: readonly AIBlockVerificationReport[] = [],
): Record<string, AIBlockVerificationReport> {
  return Object.fromEntries(reports.filter((r) => Object.hasOwn(spec.aiBlocks, r.blockId)).map((r) => [r.blockId, r]));
}

/** Reasons that can clear up by themselves; photos without samples, unsupported devices and failures do not. */
const RETRY: ReadonlySet<AIBlockVerificationReason> = new Set<AIBlockVerificationReason>([
  'offline', 'cloud_off', 'not_configured', 'device_not_ready', 'device_loading', 'timeout', 'cancelled',
]);

/** AI steps of a saved app whose build-time check is still waiting for the network, consent or the model. */
export function pendingChecks(app: Pick<StoredApp, 'spec' | 'aiVerification'>): string[] {
  return Object.keys(app.spec.aiBlocks).filter((id) => {
    const r = app.aiVerification?.[id];
    return !!r && r.testCount === 0 && !!r.reason && RETRY.has(r.reason);
  });
}

/**
 * Finishes the checks that were waiting (the "Kalam will check it when you are online" promise). Call
 * it when a saved app is opened. Same rules and deadline as the build stage, so it makes no call while
 * still offline. Returns the app to save, or undefined when nothing changed.
 */
export async function recheckPending(
  app: StoredApp, deps: VerifyStageDeps, signal?: AbortSignal,
): Promise<StoredApp | undefined> {
  const only = pendingChecks(app);
  if (!only.length) return undefined;
  const checked = await verifyAIBlocks(app.spec, deps, { signal, only });
  const ran = checked.reports.filter((r) => r.testCount > 0);
  if (!ran.length) return undefined;
  return { ...app, spec: checked.spec, aiVerification: { ...app.aiVerification, ...reportsByBlock(checked.spec, ran) } };
}
