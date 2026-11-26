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
 * - Steps that waited for the network, consent or the model are finished later by recheckPending,
 *   whose reports the caller merges into the app as it is then (applyChecks).
 */
import type {
  AIBlockService, AIBlockVerificationOutcome, AIBlockVerificationReason, AIBlockVerificationReport, AIOrchestrator,
  AppRepository, StoredApp, UnderstandingSummary, ValidateSpec,
} from '../contracts';
import { featureEnabled } from '../ai/remote-config';
import type { KalamSpec } from '../spec/schema';
import { validateSpec as defaultValidate } from '../spec/validate';
import { blockHash, blockPolicy, recordVerification, verificationReport } from '../tasks/ai-block-service';
import { notCheckedMessage, VERIFY_COPY } from './copy';
import { withDeadline } from './deadline';

/** The verifying stage adds at most this much to a build: 30 s, about two typical AI steps. */
export const VERIFY_BUDGET_MS = 30_000;

/** Reasons that hold for every remaining step, so testing the rest now is pointless. */
const STOPS_ALL: ReadonlySet<AIBlockVerificationReason> = new Set<AIBlockVerificationReason>([
  'device_unsupported', 'device_not_ready', 'device_loading', 'offline', 'cloud_off', 'needs_cloud_ok', 'not_configured', 'cancelled',
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
  /** Reasons of the steps that ended without a check, photo steps waiting for samples included. */
  skipped: AIBlockVerificationReason[];
  /** Steps whose check was started, so a model call may have been made for them. */
  attempted: string[];
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
  // Remote kill switch (docs/04 §11.6, feature_ai_block_verification): no step is tested and every step stays unverified.
  if (!featureEnabled('aiBlockVerification')) return { spec, reports: [], skipped: [], attempted: [] };
  const ids = Object.keys(spec.aiBlocks).filter((id) => !opts.only || opts.only.includes(id));
  const testable = ids.filter((id) => spec.aiBlocks[id]?.kind !== 'extractFromPhoto');
  const started = deps.now();
  const budget = deps.budgetMs ?? VERIFY_BUDGET_MS;
  let blocked = testable.length ? await blockedBy(deps) : undefined;
  let out = spec;
  let n = 0;
  const reports: AIBlockVerificationReport[] = [];
  const skipped: AIBlockVerificationReason[] = [];
  const attempted: string[] = [];
  const deviceOnly = (id: string) => {
    const b = spec.aiBlocks[id];
    return !!b && blockPolicy(b).fallback === 'none';
  };
  const notChecked = (id: string, reason: AIBlockVerificationReason) => {
    skipped.push(reason);
    reports.push(verificationReport(out, id, {
      status: 'unverified', testCount: 0, passCount: 0, details: [], reason, message: notCheckedMessage(reason, deviceOnly(id)),
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
    attempted.push(id);
    let outcome: AIBlockVerificationOutcome | undefined;
    try {
      outcome = await withDeadline((signal) => deps.aiBlocks.verify(out, id, { signal }), left, opts.signal);
    } catch {
      notChecked(id, 'failed'); // the check itself broke: not a time-out, and not worth retrying by itself
      continue;
    }
    if (!outcome) {
      notChecked(id, opts.signal?.aborted ? 'cancelled' : 'timeout');
      continue;
    }
    out = recordVerification(out, id, outcome, deps.now());
    if (outcome.status === 'unverified') skipped.push(outcome.reason ?? 'failed');
    // An early stop for a reason that is not about this step reads better in the build's own words.
    const general = outcome.status === 'unverified' && outcome.reason && STOPS_ALL.has(outcome.reason) ? outcome.reason : undefined;
    reports.push(verificationReport(out, id, general ? { ...outcome, message: notCheckedMessage(general, deviceOnly(id)) } : outcome, deps.now()));
    if (general) blocked = general;
  }
  return { spec: out, reports, skipped, attempted };
}

/**
 * The review shows the check's own words for steps that are still unverified ("Not checked yet. ..."),
 * and for steps set to run only on this device that did not pass, since "works best when online"
 * would be wrong for them.
 */
export function withCheckMessages(
  u: UnderstandingSummary, reports: readonly AIBlockVerificationReport[], spec?: KalamSpec,
): UnderstandingSummary {
  if (!reports.length) return u;
  return {
    ...u,
    aiFeatures: u.aiFeatures.map((f) => {
      const r = reports.find((x) => x.blockId === f.id);
      if (!r?.message) return f;
      const block = spec && Object.hasOwn(spec.aiBlocks, f.id) ? spec.aiBlocks[f.id] : undefined;
      const weakDeviceOnly = r.status === 'cloudPreferred' && !!block && blockPolicy(block).fallback === 'none';
      return r.status === 'unverified' || weakDeviceOnly ? { ...f, verified: r.message } : f;
    }),
  };
}

/** Reports keyed by block id for `StoredApp.aiVerification`, without steps no longer in `spec`. */
export function reportsByBlock(
  spec: KalamSpec, reports: readonly AIBlockVerificationReport[] = [],
): Record<string, AIBlockVerificationReport> {
  return Object.fromEntries(reports.filter((r) => Object.hasOwn(spec.aiBlocks, r.blockId)).map((r) => [r.blockId, r]));
}

/**
 * Reasons that can clear up by themselves; photos without samples, unsupported devices and failures do not.
 * A cloud notice the person did not accept is not here: opening the app must not ask again, Edit does.
 */
const RETRY: ReadonlySet<AIBlockVerificationReason> = new Set<AIBlockVerificationReason>([
  'offline', 'cloud_off', 'not_configured', 'device_not_ready', 'device_loading', 'timeout', 'cancelled',
]);

/** AI steps of a saved app whose build-time check is still waiting for the network, consent or the model. */
export function pendingChecks(app: Pick<StoredApp, 'spec' | 'aiVerification'>): string[] {
  return Object.keys(app.spec.aiBlocks).filter((id) => {
    const r = app.aiVerification?.[id];
    return !!r && r.status === 'unverified' && !!r.reason && RETRY.has(r.reason);
  });
}

/**
 * Finishes the checks that were waiting. Call it when a saved app is opened. Same rules and deadline
 * as the build stage, so it makes no call while still offline.
 *
 * Returns the reports to keep for the steps it really started, or undefined when it started none.
 * It never returns an app: the check can take VERIFY_BUDGET_MS and the app may change meanwhile, so
 * the caller re-reads the app and merges with applyChecks. A step that times out a second time is
 * kept as 'failed', so it is not retried by itself again (at most two tries per step).
 */
export async function recheckPending(
  app: Pick<StoredApp, 'spec' | 'aiVerification'>, deps: VerifyStageDeps, signal?: AbortSignal,
): Promise<AIBlockVerificationReport[] | undefined> {
  const only = pendingChecks(app);
  if (!only.length) return undefined;
  const checked = await verifyAIBlocks(app.spec, deps, { signal, only });
  const reports = checked.reports
    .filter((r) => checked.attempted.includes(r.blockId) && r.reason !== 'cancelled')
    .map((r): AIBlockVerificationReport => (r.reason === 'timeout' && app.aiVerification?.[r.blockId]?.reason === 'timeout'
      ? { ...r, reason: 'failed', message: VERIFY_COPY.tooSlowAgain }
      : r));
  return reports.length ? reports : undefined;
}

/**
 * Merges check reports into the app as it is now (re-read it just before). A report counts only while
 * its step is unchanged (same blockHash), so a newer edit is never overwritten; the merged spec is
 * validated again. Returns the app to save, or undefined when nothing applies.
 */
export function applyChecks(
  app: StoredApp, reports: readonly AIBlockVerificationReport[], validate: ValidateSpec = defaultValidate,
): StoredApp | undefined {
  const fresh = reports.filter((r) => Object.hasOwn(app.spec.aiBlocks, r.blockId) && r.blockHash === blockHash(app.spec, r.blockId));
  if (!fresh.length) return undefined;
  let spec = app.spec;
  for (const r of fresh) {
    spec = recordVerification(spec, r.blockId, { status: r.status, testCount: r.testCount, passCount: r.passCount, model: r.model, details: [] }, r.checkedAt);
  }
  const v = validate(spec);
  if (!v.ok || !v.spec) return undefined;
  return { ...app, spec: v.spec, aiVerification: { ...app.aiVerification, ...reportsByBlock(v.spec, fresh) } };
}

/**
 * On app open: finishes the checks that were waiting and saves them into the app as it is by then
 * (read again after the check, merged with applyChecks). Returns the saved app, or undefined when
 * nothing changed. Never throws, because the check is optional.
 */
export async function finishPendingChecks(
  id: string, deps: VerifyStageDeps & { apps: Pick<AppRepository, 'get' | 'save'> }, signal?: AbortSignal,
): Promise<StoredApp | undefined> {
  try {
    const app = await deps.apps.get(id);
    const reports = app ? await recheckPending(app, deps, signal) : undefined;
    if (!reports) return undefined;
    const now = await deps.apps.get(id);
    const next = now ? applyChecks(now, reports) : undefined;
    return next ? await deps.apps.save(next, { summary: VERIFY_COPY.savedSummary, source: 'edit' }) : undefined;
  } catch {
    return undefined;
  }
}
