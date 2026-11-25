/**
 * Every user-visible string of the diagnostics feature (usage counts, timings, problem report), in
 * one place so the i18n migration can move them together. Plain words, no dashes as punctuation.
 */
import type { TelemetryDimension, TelemetryEvent } from '@/core/telemetry';
import type { TimingName } from '@/core/observability';

import type { ReportArea } from './report';

export const diagnosticsCopy = {
  section: {
    title: 'Diagnostics',
    description: 'Usage counts, timings and a way to report a problem. Nothing is sent anywhere unless you choose to share it.',
  },

  usage: {
    switchLabel: 'Count my usage on this device',
    switchHint:
      'Off until you turn it on. Keeps simple counts: apps you make, by kind of input; which kind of AI did the work; apps opened with and without internet; and errors by code. No app names, entries, prompts or files. Nothing is sent anywhere.',
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
      feature_used: {
        visual_edit: 'Changed an app by pointing at it',
        report: 'Made a report',
        photo_extract: 'Read entries from a photo',
        voice_command: 'Used a voice command',
        reminder: 'Used reminders',
        translation: 'Translated an app',
        share_link: 'Used a link between apps',
        assistant: 'Asked about an app',
      },
      bazaar: { installed: 'Apps you installed', published: 'Apps you published' },
    } satisfies { [E in Exclude<TelemetryEvent, 'error'>]: Record<TelemetryDimension<E>, string> } as Record<string, Record<string, string>>,
    otherError: 'Other error',
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
      shared: 'Counts shared.',
      failed: 'Could not copy or share the counts.',
      reset: 'Counts reset.',
      saveFailed: 'Could not change that setting.',
    },
  },

  timings: {
    heading: 'How fast things ran',
    description: 'Times measured on this device since Kalam started. They hold no names, ids or entries.',
    empty: 'Nothing measured yet. Open an app or save an entry and come back.',
    names: {
      app_open: 'Opening an app',
      spec_validate: 'Checking an app design',
      record_write: 'Saving an entry',
    } satisfies Record<TimingName, string>,
    row: (runs: number, medianMs: number, slowMs: number, failed: number) =>
      `${runs} ${runs === 1 ? 'run' : 'runs'}, usual ${medianMs} ms, slowest ${slowMs} ms${failed ? `, ${failed} failed` : ''}`,
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
      shared: 'Report shared.',
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
