/**
 * Words the person sees from the build pipeline's AI-step check. Kept in one place so the i18n
 * migration can move them. Plain English: no dashes as punctuation, no exclamation marks.
 */
import type { AIBlockVerificationReason } from '../contracts';

export const VERIFY_COPY = {
  /** Progress detail for the 'verifying' stage. */
  progress: (n: number, total: number): string => `Testing AI step ${n} of ${total}`,
  /** Status of a step that was not checked while the app was built. */
  notChecked: {
    needs_samples: 'Not checked yet. Add 3 sample photos in Edit to test it on this device.',
    device_unsupported: 'This device cannot run AI steps on its own, so this step uses the cloud when you allow it.',
    device_not_ready: 'Not checked yet. On-device AI is not ready on this device. Kalam checks this step once it is.',
    device_loading: 'Not checked yet. On-device AI was still loading. Check it from Edit in a moment.',
    offline: 'Not checked yet. Kalam will check it when you are online.',
    cloud_off: 'Not checked yet. Kalam needs cloud help to write the tests, and it is off in Settings.',
    not_configured: 'Not checked yet. Cloud AI is not set up in this build.',
    timeout: 'Not checked yet. Testing took too long, so Kalam did not wait. Check it from Edit.',
    cancelled: 'Not checked yet.',
    failed: 'The check could not finish. Check it again from Edit.',
  } satisfies Record<AIBlockVerificationReason, string>,
} as const;

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
    noSamples: (min: number): string =>
      `Reading photos can only be tested with real sample photos. Add ${min} or more. Until then this step stays untested and uses the cloud when you allow it.`,
    deviceNotReady: 'On-device AI is not ready on this device, so this step could not be tested for offline use.',
    staleCases: 'The saved tests no longer fit this step. Run a new check.',
    fewCases: 'Kalam could not write enough good tests. Try again later.',
    deviceLost: 'On-device AI stopped working during the test, so this step stays untested.',
    notOnDevice: 'The test did not run on this device, so it does not count as an on-device check.',
    notGraded: (why: string): string => `The on-device answers could not be graded. ${why}`,
    photosUnreadable: 'On-device AI could not read these photos, so this step stays untested.',
    fewReadable: (n: number): string => `Only ${n} of the sample photos could be read by the cloud model. Use clearer photos and try again.`,
    passed: (n: number, of: number): string => `Passed ${n} of ${of} tests on this device. It now runs on this device first.`,
    passedCloud: (n: number, of: number): string =>
      `Passed ${n} of ${of} tests on this device. Kalam will use the cloud for this step when you allow it.`,
  },
} as const;
