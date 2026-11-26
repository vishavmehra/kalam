/**
 * Words the person sees from the build pipeline's AI-step check. Kept in one place so the i18n
 * migration can move them. Plain English: no dashes as punctuation, no exclamation marks.
 * Nothing here promises a later check: the only way to check a step again today is Edit.
 */
import type { AIBlockVerificationReason } from '../contracts';

const DEVICE_ONLY_UNSUPPORTED =
  'This device cannot run AI steps on its own, and this step is set to run only on the device, so it will not work here.';

export const VERIFY_COPY = {
  /** Progress detail for the 'verifying' stage. */
  progress: (n: number, total: number): string => `Testing AI step ${n} of ${total}`,
  /** Status of a step that was not checked while the app was built. */
  notChecked: {
    needs_samples: 'Not checked yet. Reading photos can only be tested with real sample photos.',
    device_unsupported: 'This device cannot run AI steps on its own, so this step uses the cloud when you allow it.',
    device_not_ready: 'Not checked yet. On-device AI is not ready on this device.',
    device_loading: 'Not checked yet. On-device AI was still loading. Check it from Edit in a moment.',
    offline: 'Not checked yet. You are offline. You can check it from Edit when you are online.',
    cloud_off: 'Not checked yet. Kalam needs cloud help to write the tests, and it is off in Settings.',
    needs_cloud_ok: 'Not checked yet. Kalam needs your OK to use cloud help to write the tests. Nothing was sent. Check it from Edit when you are ready.',
    not_configured: 'Not checked yet. Cloud AI is not set up in this build.',
    timeout: 'Not checked yet. Testing took too long, so Kalam did not wait. Check it from Edit.',
    cancelled: 'Not checked yet.',
    failed: 'The check could not finish. Check it again from Edit.',
  } satisfies Record<AIBlockVerificationReason, string>,
  /** Steps set to run only on this device (fallback 'none') never use the cloud, so these replace the above. */
  notCheckedDeviceOnly: {
    device_unsupported: DEVICE_ONLY_UNSUPPORTED,
  } satisfies Partial<Record<AIBlockVerificationReason, string>>,
  /** A step that timed out again when Kalam retried it is not retried by itself any more. */
  tooSlowAgain: 'Not checked yet. Testing took too long twice, so Kalam stopped trying. Check it from Edit.',
  /** History entry for a version saved after waiting checks finished. */
  savedSummary: 'Checked AI steps on this device',
} as const;

/** The words for a step that was not checked, taking its fallback policy into account. */
export function notCheckedMessage(reason: AIBlockVerificationReason, deviceOnly: boolean): string {
  const only: Partial<Record<AIBlockVerificationReason, string>> = VERIFY_COPY.notCheckedDeviceOnly;
  return (deviceOnly && only[reason]) || VERIFY_COPY.notChecked[reason];
}

/** Words of the AI-step service itself (src/core/tasks/ai-block-service.ts): running a step and checking it. */
export const AI_STEP_COPY = {
  run: {
    needPhoto: 'Add a photo first.',
    missingList: 'This step fills in a list that is no longer in the app.',
    needText: 'There is no text to work on yet.',
    missingStep: 'This AI step no longer exists in the app.',
  },
  check: {
    needSamples: (min: number): string => `Add at least ${min} sample photos to test this step.`,
    noSamples: (min: number, deviceOnly: boolean): string =>
      `Reading photos can only be tested with ${min} or more real sample photos. Until then this step stays untested${
        deviceOnly ? ' and runs only on this device.' : ' and uses the cloud when you allow it.'}`,
    deviceUnsupported: (deviceOnly: boolean): string => (deviceOnly
      ? DEVICE_ONLY_UNSUPPORTED
      : 'This device cannot run AI steps on its own, so this step could not be tested for offline use.'),
    deviceNotReady: 'On-device AI is not ready on this device, so this step could not be tested for offline use.',
    staleCases: 'The saved tests no longer fit this step. Run a new check.',
    fewCases: 'Kalam could not write enough good tests. Try again later.',
    deviceLost: 'On-device AI stopped working during the test, so this step stays untested.',
    notOnDevice: 'The test did not run on this device, so it does not count as an on-device check.',
    notGraded: (why: string): string => `The on-device answers could not be graded. ${why}`,
    tooSlow: 'On-device AI took too long to answer, so this step stays untested. Try again when the device is less busy.',
    photosUnreadable: 'On-device AI could not read these photos, so this step stays untested.',
    fewReadable: (n: number): string => `Only ${n} of the sample photos could be read by the cloud model. Use clearer photos and try again.`,
    passed: (n: number, of: number, deviceOnly: boolean): string =>
      `Passed ${n} of ${of} tests on this device. It now runs ${deviceOnly ? 'only on this device' : 'on this device first'}.`,
    passedCloud: (n: number, of: number, deviceOnly: boolean): string => (deviceOnly
      ? `Passed ${n} of ${of} tests on this device. This step is set to run only on this device, so its answers may be wrong.`
      : `Passed ${n} of ${of} tests on this device. Kalam will use the cloud for this step when you allow it.`),
  },
} as const;
