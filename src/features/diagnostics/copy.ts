/**
 * Every user-visible string of the diagnostics feature (usage counts, timings, problem report), in
 * one place so the i18n migration can move them together. Plain words, no dashes as punctuation.
 */
import type { ErrorCode, TimingName } from '@/core/observability';
import type { TelemetryDimension, TelemetryEvent } from '@/core/telemetry';

import type { ReportArea } from './report';

const features = {
  visual_edit: 'Changed an app by pointing at it',
  report: 'Made a report',
  photo_extract: 'Read entries from a photo',
  voice_command: 'Used a voice command',
  reminder: 'Used reminders',
  translation: 'Translated an app',
  share_link: 'Used a link between apps',
  assistant: 'Asked about an app',
  time_machine: 'Looked back through an app history',
  backup: 'Made or restored a backup',
  access_mode: 'Used an access mode',
  template: 'Used a ready-made app',
} satisfies Record<TelemetryDimension<'feature_used'>, string>;

/** Spec checks and edit patches raise many upper case codes. One plain label covers each family. */
const specErrorLabel = 'App design check failed';
const patchErrorLabel = 'A change could not be applied';

/** Plain names for the lower case error codes a person can see in the counts. */
const errorLabels = {
  offline: 'No internet for a cloud step',
  consent_denied: 'Cloud use not allowed',
  model_unavailable: 'AI model not available',
  not_configured: 'AI service not set up',
  timeout: 'AI took too long',
  invalid_output: 'AI answer could not be used',
  provider_error: 'AI service error',
  quota: 'AI limit reached',
  unsupported_modality: 'Input kind not supported',
  cancelled: 'Cancelled',
  app_check_failed: 'Device check failed',
  bad_request: 'AI request rejected',
  record_limit: 'A list is full',
  blob_too_large: 'File too large to keep',
  database_too_new: 'Saved data is from a newer Kalam',
  not_a_backup: 'File is not a backup',
  unsupported_version: 'Backup is from a newer Kalam',
  wrong_passphrase_or_damaged: 'Wrong passphrase or damaged backup',
  damaged: 'Backup is damaged',
  too_large: 'File too large',
  weak_passphrase: 'Passphrase too short',
  conflict: 'Apps already on this device',
  random_unavailable: 'Secure random numbers not available',
  invalid_spec: specErrorLabel,
  record_invalid: 'An entry failed the check',
  share_store: 'A link could not be kept',
  shared_record_read_only: 'Shared entry is read only',
  media_permission: 'Camera or photo access is off',
  video_too_long: 'Video is too long',
} satisfies Record<Exclude<Extract<ErrorCode, Lowercase<ErrorCode>>, 'other'>, string>;

export const diagnosticsCopy = {
  section: {
    title: 'Diagnostics',
    description: 'Usage counts, timings and a way to report a problem. Nothing is sent anywhere unless you choose to share it.',
  },

  usage: {
    switchLabel: 'Count my usage on this device',
    switchHint:
      'Off until you turn it on. Keeps simple counts: apps you make, by kind of input; which kind of AI did the work; apps opened with and without internet; which features you use and whether they worked; and errors by kind. No app names, entries, prompts or files. Nothing is sent anywhere.',
    loading: 'Reading the saved counts.',
    emptyOff: 'Counting is off, so there is nothing to show.',
    emptyOn: 'Nothing counted yet. Counts appear here as you use Kalam.',
    since: (date: string) => `Counting since ${date}.`,
    heading: 'Your counts',
    groups: {
      apps_created: 'Apps made',
      ai_source: 'AI work done',
      app_opened: 'Apps opened',
      error: 'Errors',
      feature_used: 'Features used',
      feature_failed: 'Features that did not work',
      flow: 'Steps taken',
      bazaar: 'Bazaar',
    } satisfies Record<TelemetryEvent, string>,
    /** Row labels, by event and then by value. Errors are shown by their code. */
    values: {
      apps_created: {
        text: 'From text',
        image: 'From a photo',
        audio: 'From voice',
        video: 'From video',
        drawing: 'From a drawing',
        mixed: 'From more than one kind',
        template: 'From a ready-made app',
      },
      ai_source: { on_device: 'On this device', cloud: 'In the cloud', deterministic: 'Plain app logic' },
      app_opened: { online: 'With internet', offline: 'Without internet' },
      feature_used: features,
      feature_failed: features,
      flow: {
        onboarding_completed: 'Finished first-time setup',
        creation_started: 'Started making an app',
        compilation_failed: 'An app could not be made',
        record_created: 'Entries added',
        offline_operation_completed: 'Things done without internet',
      },
      bazaar: { installed: 'Apps you installed', published: 'Apps you published' },
    } satisfies { [E in Exclude<TelemetryEvent, 'error'>]: Record<TelemetryDimension<E>, string> } as Record<string, Record<string, string>>,
    otherError: 'Other error',
    errors: errorLabels as Readonly<Record<string, string>>,
    specError: specErrorLabel,
    patchError: patchErrorLabel,
    copyJson: 'Copy counts as JSON',
    shareJson: 'Share counts as JSON',
    shareTitle: 'Kalam usage counts',
    showJson: 'Show JSON',
    hideJson: 'Hide JSON',
    jsonLabel: 'Usage counts as JSON, read only',
    reset: 'Reset counts',
    resetTitle: 'Reset usage counts?',
    resetMessage: 'Every count goes back to zero. This cannot be undone.',
    resetConfirm: 'Reset counts',
    toasts: {
      on: 'Counting is on. Counts stay on this device.',
      off: 'Counting is off. Your counts are kept until you reset them.',
      copied: 'Counts copied.',
      shared: 'Share sheet opened.',
      failed: 'Could not copy or share the counts.',
      reset: 'Counts reset.',
      saveFailed: 'Could not save that setting. It may be undone when you close Kalam.',
    },
  },

  timings: {
    heading: 'How fast things ran',
    description: 'Times for steps that run on this device, measured since Kalam started. They hold no names, ids or entries. The time an AI model takes is counted apart, in Activity.',
    empty: 'Nothing measured yet. Open an app or save an entry and come back.',
    names: {
      app_open: 'Opening an app',
      spec_validate: 'Checking an app design',
      record_write: 'Saving an entry',
      attachment_intake: 'Adding a picture, recording or video',
      media_validate: 'Checking a file',
      media_preprocess: 'Preparing a picture',
      thumbnail: 'Making a small preview',
      audio_transcribe: 'Turning speech into text',
      video_frames: 'Picking frames from a video',
      drawing_export: 'Exporting a drawing',
      context_assemble: 'Putting your input together',
      request_prepare: 'Preparing the request for AI',
    } satisfies Record<TimingName, string>,
    row: (runs: number, medianMs: number, slowMs: number, failed: number) =>
      `${runs} ${runs === 1 ? 'run' : 'runs'}, usual ${medianMs} ms, slowest ${slowMs} ms${failed ? `, ${failed} failed` : ''}`,
  },

  evidence: {
    heading: 'AI run evidence',
    description:
      'For each AI run: the platform, the model, whether it ran on this device or in the cloud, and how long it took. It holds no prompts, answers, app names or entries. Nothing is sent until you share it.',
    empty: 'No AI runs yet. Make or change an app and come back.',
    count: (runs: number) => `${runs} ${runs === 1 ? 'run' : 'runs'} ready to export.`,
    copy: 'Copy evidence as JSON',
    share: 'Share evidence as JSON',
    show: 'Show evidence',
    hide: 'Hide evidence',
    jsonLabel: 'AI run evidence as JSON, read only',
    shareTitle: 'Kalam AI run evidence',
    toasts: {
      copied: 'Evidence copied.',
      shared: 'Share sheet opened.',
      failed: 'Could not copy or share the evidence.',
      unreadable: 'Kalam could not read the AI runs.',
    },
  },

  problem: {
    open: 'Report a problem',
    openHint: 'Builds a report you can read first. Nothing is sent until you share it.',
    title: 'Report a problem',
    description:
      'This report holds no apps, entries, prompts, photos, recordings or file names. Read it below. Nothing is sent until you share or copy it.',
    areaLabel: 'What went wrong?',
    areas: {
      create: 'Making an app',
      open: 'Opening an app',
      save: 'Saving or backing up',
      voice: 'Voice or reading aloud',
      other: 'Something else',
    } satisfies Record<ReportArea, string>,
    previewLabel: 'Report text',
    previewA11y: 'Report text, read only',
    share: 'Share report',
    copy: 'Copy report',
    toasts: {
      shared: 'Share sheet opened.',
      copied: 'Report copied. Paste it where you want to send it.',
      failed: 'Could not share or copy the report. Select the text and copy it by hand.',
    },
    shareTitle: 'Kalam problem report',
  },

  /** The words inside the report text itself. */
  report: {
    title: 'Kalam problem report',
    created: 'Created',
    area: 'Area',
    version: 'Kalam version',
    device: 'Device',
    platforms: { web: 'web', android: 'Android', ios: 'iOS', other: 'unknown platform' },
    errors: 'Recent error codes',
    timings: 'Timings',
    timingRow: (label: string, runs: number, medianMs: number, slowMs: number, failed: number) =>
      `${label}: ${runs} ${runs === 1 ? 'run' : 'runs'}, usual ${medianMs} ms, slowest ${slowMs} ms${failed ? `, ${failed} failed` : ''}`,
    limits: 'Limits version',
    ai: 'AI work',
    aiLine: (device: number, cloud: number, plain: number, failed: number) =>
      `on this device ${device}, in the cloud ${cloud}, plain app logic ${plain}, failed ${failed}`,
    settings: 'Settings',
    settingLabels: {
      aiMode: 'AI mode',
      colorScheme: 'Theme',
      reducedMotion: 'Motion',
      language: 'Language',
      cloudAllowed: 'Cloud AI allowed',
      otherProvidersAllowed: 'Other AI providers allowed',
      largeText: 'Large text',
      highContrast: 'High contrast',
      simple: 'Simple mode',
      readAloud: 'Read aloud',
      leftHanded: 'Left handed',
      voiceOnly: 'Voice only',
      keepRecordings: 'Keep recordings',
      usageCounts: 'Usage counts',
    },
    none: 'none',
    on: 'on',
    off: 'off',
    footer: 'This report holds no apps, entries, prompts, photos, recordings or file names.',
  },
} as const;
