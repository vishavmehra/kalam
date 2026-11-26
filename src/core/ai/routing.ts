/**
 * Task registry + routing policy (docs/07 §9.2–9.5). Pure functions so every decision is testable.
 * Deterministic/template handling happens BEFORE the orchestrator is called (caller's job); this
 * module only chooses between Gemini Nano (on-device), Firebase cloud and a consented specialist.
 */
import type {
  AIErrorCode, ComplexityLevel, InferenceMode, KalamSettings, ModelRole, OnDeviceStatus, StructuredRequest, TaskType,
} from '../contracts';
import { isUsable, type Capability } from './capabilities';
import { AI_COPY } from './copy';
import type { LocalStatus } from './local-ready';

export interface TaskPolicy {
  /** Default model role when the request does not name one. */
  role: ModelRole;
  /** Nano is an eligible executor for this task (docs/07 §6.2, §9.3). */
  onDevice: boolean;
  /** Claude/Nebius may be used when a caller gives an escalationReason and the user consented. */
  specialist: boolean;
  /** Successful on-device runs count toward settings.onDeviceActionCount (docs/07 §13.6). */
  userFacing: boolean;
  /**
   * Lead decision 2 (2026-11-18): when a `prefer_on_device` run fails ON the device, the orchestrator
   * may make ONE Firebase cloud attempt. Only when cloud is allowed (online, allowCloud, not
   * offline_only, configured); never for `only_on_device`; never more than one extra call.
   */
  cloudFallback: boolean;
  /**
   * docs/07 §4.2: a simple request without a template tries the device first, but only once the local gate says
   * this platform is `ready` for it (§6.7, §4.5: Nano is not assumed able to build a whole app). Simple requests only.
   */
  localWhenReady?: boolean;
}

export const TASK_POLICIES: Readonly<Record<TaskType, TaskPolicy>> = {
  create_app: { role: 'compiler', onDevice: false, specialist: true, userFacing: false, cloudFallback: false, localWhenReady: true },
  plan_app: { role: 'compiler', onDevice: false, specialist: true, userFacing: false, cloudFallback: false },
  modify_app: { role: 'compiler', onDevice: false, specialist: true, userFacing: false, cloudFallback: false },
  interpret_sketch: { role: 'compiler', onDevice: false, specialist: true, userFacing: false, cloudFallback: false },
  repair_spec: { role: 'repair', onDevice: false, specialist: true, userFacing: false, cloudFallback: false },
  verify_ai_block: { role: 'judge', onDevice: false, specialist: false, userFacing: false, cloudFallback: false },
  safety_review: { role: 'safety', onDevice: false, specialist: false, userFacing: false, cloudFallback: false },
  generate_patch: { role: 'edit', onDevice: true, specialist: false, userFacing: true, cloudFallback: true },
  // Template parameters must never wait on the cloud: the deterministic template is the fallback.
  extract_template_params: { role: 'local_assistant', onDevice: true, specialist: false, userFacing: true, cloudFallback: false },
  extract_data: { role: 'ai_block', onDevice: true, specialist: false, userFacing: true, cloudFallback: true },
  classify: { role: 'local_assistant', onDevice: true, specialist: false, userFacing: true, cloudFallback: true },
  summarize: { role: 'ai_block', onDevice: true, specialist: false, userFacing: true, cloudFallback: true },
  translate: { role: 'translation', onDevice: true, specialist: false, userFacing: true, cloudFallback: true },
  voice_action: { role: 'voice', onDevice: true, specialist: false, userFacing: true, cloudFallback: true },
};

export interface RouteInput {
  taskType: TaskType;
  requestedMode: InferenceMode;
  complexity?: ComplexityLevel;
  escalationReason?: string;
  settings: Pick<KalamSettings, 'aiMode' | 'allowCloud' | 'allowExternalProviders'>;
  online: boolean;
  firebaseConfigured: boolean;
  specialistConfigured: boolean;
  onDevice: OnDeviceStatus['availability'];
  /** A capability the request needs that the on-device model lacks (see `deviceGap`). */
  deviceLacks?: Capability;
  /** The local-ready gate for this task on this platform (local-ready.ts). Absent counts as unproven. */
  localReady?: LocalStatus;
}

/**
 * Whether the device model may take this task now (docs/07 §6.7). A task that prefers the device keeps it unless
 * its benchmark FAILED; the simple-app local attempt needs a benchmark that PASSED. Unproven never blocks a task
 * that already used the device, and never unlocks a new one.
 */
export function onDeviceEligible(taskType: TaskType, complexity: ComplexityLevel | undefined, localReady?: LocalStatus): boolean {
  const policy = TASK_POLICIES[taskType];
  if (policy.onDevice) return localReady !== 'failed';
  return !!policy.localWhenReady && complexity === 'simple' && localReady === 'ready';
}

/**
 * First capability this request needs that the capability registry says the on-device model on this
 * platform cannot take (docs/07 §14.6: unsupported and not-assumed rows are never routed). Undefined
 * when the device may run it. The web uses the Prompt API rows, iOS the Apple Foundation Models rows
 * and Android, and any other runtime, the Android rows. Both phone models take text only, so images
 * and recordings are never sent to a device model that cannot read them.
 */
export function deviceGap(platform: OnDeviceStatus['platform'], req: Pick<StructuredRequest<unknown>, 'images' | 'audio'>): Capability | undefined {
  const provider = platform === 'web' ? 'nano_web' : platform === 'ios' ? 'apple_fm' : 'nano_android';
  const needs: Capability[] = [
    'text', 'structured_output',
    ...(req.images?.length ? ['image_input' as const] : []),
    ...(req.audio?.length ? ['audio_input' as const] : []),
  ];
  return needs.find((c) => !isUsable(provider, c));
}

export type RouteDecision =
  | { kind: 'firebase'; mode: InferenceMode; note?: string }
  | { kind: 'specialist'; note: string }
  | { kind: 'fail'; code: AIErrorCode; message: string; intended: 'on_device' | 'cloud' };

/** Why Firebase cloud cannot be used right now, or undefined if it can. */
export function cloudBlock(i: Pick<RouteInput, 'settings' | 'online' | 'firebaseConfigured'>): { code: AIErrorCode; message: string } | undefined {
  if (i.settings.aiMode === 'offline_only') return { code: 'consent_denied', message: AI_COPY.offlineOnlyMode };
  if (!i.settings.allowCloud) return { code: 'consent_denied', message: AI_COPY.cloudOff };
  if (!i.online) return { code: 'offline', message: AI_COPY.offline };
  if (!i.firebaseConfigured) return { code: 'not_configured', message: AI_COPY.firebaseMissing };
  return undefined;
}

export function planRoute(i: RouteInput): RouteDecision {
  const policy = TASK_POLICIES[i.taskType];
  const blocked = cloudBlock(i);

  // Specialists are external cloud providers: same cloud consent + explicit external consent +
  // a caller-supplied justification. Never a silent fallback (docs/07 §9.4–9.5).
  if (
    i.escalationReason && policy.specialist && !blocked && i.requestedMode !== 'only_on_device'
    && i.settings.allowExternalProviders && i.specialistConfigured
  ) {
    return { kind: 'specialist', note: i.escalationReason };
  }

  const deviceReady = i.onDevice === 'available' && !i.deviceLacks;
  if (!onDeviceEligible(i.taskType, i.complexity, i.localReady)) {
    // Nano cannot do this task (docs/07 §4.5), or it failed its benchmark for it (§6.7): cloud or a clear
    // failure. A caller's only_on_device is a privacy constraint and is never widened to cloud.
    const benchFailed = policy.onDevice;
    if (i.requestedMode === 'only_on_device') {
      return { kind: 'fail', code: 'model_unavailable', intended: 'on_device', message: benchFailed ? AI_COPY.localFailedGate : AI_COPY.taskNeedsCloud };
    }
    if (blocked) return { kind: 'fail', ...blocked, intended: 'cloud' };
    return {
      kind: 'firebase', mode: 'only_in_cloud',
      note: i.requestedMode === 'only_in_cloud' ? undefined : benchFailed ? 'on-device model failed its benchmark for this task' : 'task requires cloud reasoning',
    };
  }

  // The capability registry says the device model cannot take this input (docs/07 §14.6).
  if (i.deviceLacks && i.requestedMode === 'only_on_device') {
    return { kind: 'fail', code: 'unsupported_modality', intended: 'on_device', message: AI_COPY.deviceLacks(i.deviceLacks) };
  }
  const notReady = i.deviceLacks ? AI_COPY.deviceLacks(i.deviceLacks) : AI_COPY.deviceNotReady(i.onDevice);

  if (blocked) {
    // Consent/offline clamp: only the on-device leg is allowed, regardless of the requested mode.
    if (!deviceReady) return { kind: 'fail', code: blocked.code, intended: 'on_device', message: `${notReady} ${blocked.message}` };
    return { kind: 'firebase', mode: 'only_on_device', note: i.requestedMode === 'only_on_device' ? undefined : `cloud unavailable (${blocked.code})` };
  }

  if (i.requestedMode === 'only_on_device' && !deviceReady) {
    return { kind: 'fail', code: 'model_unavailable', intended: 'on_device', message: notReady };
  }
  // Cloud is allowed and the device cannot take this input: do not let the SDK try the device first.
  if (i.deviceLacks) return { kind: 'firebase', mode: 'only_in_cloud', note: `on-device model lacks ${i.deviceLacks}` };
  return { kind: 'firebase', mode: i.requestedMode };
}

/** Whether the actual source differs from what the requested mode preferred. */
export function isFallback(requested: InferenceMode, source: 'on_device' | 'cloud'): boolean {
  const prefersDevice = requested === 'only_on_device' || requested === 'prefer_on_device';
  return prefersDevice ? source !== 'on_device' : source !== 'cloud';
}
