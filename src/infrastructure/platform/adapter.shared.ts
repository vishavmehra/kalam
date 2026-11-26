/**
 * One typed PlatformAdapter (docs/09 §15.4): everything the app needs from the device behind a single
 * type, so app code asks `getPlatformAdapter().speech` instead of picking `speech.web` or `speech.native`.
 *
 * The adapter adds no behaviour. Each member is the module that already existed, imported and listed
 * here, so nothing was rewritten or moved. `adapter.web.ts` lists the browser modules and
 * `adapter.native.ts` lists the native ones (Android, and iOS from the same code); Metro picks the right
 * file, as for every other platform module in this folder.
 *
 * Unsupported operations (docs/09 §15.4: "report unsupported operations explicitly"). Two ways, both
 * explicit and neither a throw:
 *   - `capabilities()` says up front what can differ between platforms: speech to text and where it
 *     runs, spoken output, and how reminders are delivered.
 *   - A member that tries the work says so in its result: `files.saveFile` resolves `false` when
 *     saving or sharing is unavailable, `files.pickFile` and `files.pickJsonFile` resolve `undefined`
 *     when nothing was chosen, `audio.discardRecording` resolves `false` when nothing was deleted.
 * There is no haptics module in Kalam today, so there is no haptics member; add one here when a
 * module exists.
 *
 * Differences from the member list in docs/09 §15.4, on purpose (the doc's list is an example):
 *   - `saveDurableSnapshot` and `restoreDurableSnapshot`: durable storage is the database layer, not the
 *     device adapter (SQLite on Android and iOS, IndexedDB on the web; D09-036). `files.requestPersistence`
 *     and `files.deviceStorage` are the device parts of it.
 *   - `requestCamera`: the camera is reached through `media.pickImages` and `media.pickVideo`, which ask
 *     for the permission when they need it and throw `MediaPermissionError` when it is off.
 *   - `speak`: `tts.getAdapter().speak` and `tts.getSpeaker()`, which queue spoken lines.
 */
import type { NetworkMonitor } from '@/core/contracts';
import type { DeviceStorage, PickedFile } from '@/features/storage/platform';
import type { normalizeImageUri, pickImages, pickVideo } from './image';
import type { extractKeyframes } from './media';
import type { DiscardFn } from './media-audio.shared';
import type { NotificationAdapter } from './notifications.shared';
import type { DictationSession, OnDeviceSpeech, SpeechCapability, StartDictationOptions } from './speech.shared';
import type { SpeechQueue } from './tts-queue';
import type { TextToSpeechAdapter } from './tts.shared';

export type PlatformName = 'web' | 'android' | 'ios';

/** The adapter name for a React Native `Platform.OS` value. Anything that is not iOS or web is Android. */
export function platformNameFor(os: string): PlatformName {
  return os === 'ios' ? 'ios' : os === 'web' ? 'web' : 'android';
}

/** What can differ between platforms, asked once. Every field has a safe value when a check fails. */
export interface PlatformCapabilities {
  platform: PlatformName;
  /** Speech to text exists here (docs/06 §2.3). */
  speechToText: boolean;
  /** Where speech to text runs. Anything but `available` may use a speech service in the cloud, with consent. */
  speechOnDevice: OnDeviceSpeech;
  /** Spoken output exists here (docs/10 §4.4). */
  textToSpeech: boolean;
  /** How a reminder reaches the person (docs/14 §10.4). */
  reminders: 'system' | 'while_open' | 'none';
}

export interface PlatformAdapter {
  getPlatform(): PlatformName;

  /** What this platform can and cannot do. Never rejects. */
  capabilities(): Promise<PlatformCapabilities>;

  /** Speech to text (docs/06 §2.3). */
  speech: {
    getCapability(lang: string): Promise<SpeechCapability>;
    installOnDevice(lang: string): Promise<boolean>;
    startDictation(options: StartDictationOptions): Promise<DictationSession>;
  };

  /** Text to speech and the spoken-line queue (docs/10 §4.4). */
  tts: {
    getAdapter(): TextToSpeechAdapter;
    getSpeaker(): SpeechQueue;
  };

  /** Temporary recordings (docs/11 §7.3): delete unless the person chose to keep them. */
  audio: {
    discardRecording(uri: string | undefined | null): Promise<boolean>;
    settleRecording(uri: string | undefined | null, keep: boolean, discard: DiscardFn): Promise<string | undefined>;
  };

  /** Saving and picking files, backups and storage figures (docs/11 §7.6, §15.4). */
  files: {
    saveFile(name: string, data: Uint8Array | string, mimeType: string): Promise<boolean>;
    pickFile(maxBytes: number): Promise<PickedFile | undefined>;
    saveJsonFile(filename: string, data: unknown): Promise<boolean>;
    pickJsonFile(): Promise<unknown | undefined>;
    deviceStorage(): Promise<DeviceStorage>;
    requestPersistence(): Promise<boolean>;
    cleanupTemporaryExports(): void;
  };

  /** Photos, video and keyframes, re-encoded to at most 1280 px (docs/06 §2.2). */
  media: {
    normalizeImageUri: typeof normalizeImageUri;
    pickImages: typeof pickImages;
    pickVideo: typeof pickVideo;
    extractKeyframes: typeof extractKeyframes;
  };

  /** Online or offline (docs/09 §4). */
  network: {
    getMonitor(): NetworkMonitor;
  };

  /** Local reminders (docs/14 §10.4). */
  notifications: {
    getAdapter(): NotificationAdapter;
  };

  /** Secure random numbers for salts, nonces and ids. */
  random: {
    bytes(length: number): Uint8Array;
    uuid(): string;
  };
}

/**
 * Every member of every group, as a checked list. The type forces each group and each member name
 * to be real; `adapter.test.ts` then checks both platform adapters supply all of them.
 */
export const ADAPTER_MEMBERS: { [G in Exclude<keyof PlatformAdapter, 'getPlatform' | 'capabilities'>]: ReadonlyArray<keyof PlatformAdapter[G]> } = {
  speech: ['getCapability', 'installOnDevice', 'startDictation'],
  tts: ['getAdapter', 'getSpeaker'],
  audio: ['discardRecording', 'settleRecording'],
  files: ['saveFile', 'pickFile', 'saveJsonFile', 'pickJsonFile', 'deviceStorage', 'requestPersistence', 'cleanupTemporaryExports'],
  media: ['normalizeImageUri', 'pickImages', 'pickVideo', 'extractKeyframes'],
  network: ['getMonitor'],
  notifications: ['getAdapter'],
  random: ['bytes', 'uuid'],
};

/** Runs one check, and falls back when the platform module throws or rejects. */
async function attempt<T>(check: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await check();
  } catch {
    return fallback;
  }
}

/**
 * Builds `PlatformAdapter.capabilities` from the members the adapter already has. `lang` is the language
 * speech to text is checked for.
 */
export async function describeCapabilities(
  adapter: Pick<PlatformAdapter, 'getPlatform' | 'speech' | 'tts' | 'notifications'>,
  lang = 'en',
): Promise<PlatformCapabilities> {
  const [speech, textToSpeech, reminders] = await Promise.all([
    attempt(() => adapter.speech.getCapability(lang), undefined),
    attempt(() => adapter.tts.getAdapter().isAvailable(), false),
    attempt(async () => (await adapter.notifications.getAdapter().capability()).delivery, 'none' as const),
  ]);
  return {
    platform: adapter.getPlatform(),
    speechToText: speech?.supported === true,
    speechOnDevice: speech?.onDevice ?? 'unknown',
    textToSpeech,
    reminders,
  };
}
