/**
 * One typed PlatformAdapter (docs/09 §15.4): everything the app needs from the device behind a single
 * type, so app code asks `getPlatformAdapter().speech` instead of picking `speech.web` or `speech.native`.
 *
 * The adapter adds no behaviour. Each member is the module that already existed, imported and listed
 * here, so nothing was rewritten or moved. `adapter.web.ts` lists the browser modules and
 * `adapter.native.ts` lists the native ones (Android, and iOS from the same code); Metro picks the right
 * file, as for every other platform module in this folder.
 *
 * Operations a platform cannot do are reported by the member itself, as before: `speech.getCapability`
 * says `supported: false`, `notifications.capability` says `delivery`, `files.saveFile` resolves
 * `false` when sharing is unavailable. There is no haptics module in Kalam today, so there is no
 * haptics member; add one here when a module exists.
 */
import type { NetworkMonitor } from '@/core/contracts';
import type { DeviceStorage, PickedFile } from '@/features/storage/platform';
import type { normalizeImageUri, pickImages, pickVideo } from './image';
import type { extractKeyframes } from './media';
import type { DiscardFn } from './media-audio.shared';
import type { NotificationAdapter } from './notifications.shared';
import type { DictationSession, SpeechCapability, StartDictationOptions } from './speech.shared';
import type { SpeechQueue } from './tts-queue';
import type { TextToSpeechAdapter } from './tts.shared';

export type PlatformName = 'web' | 'android' | 'ios';

/** The adapter name for a React Native `Platform.OS` value. Anything that is not iOS or web is Android. */
export function platformNameFor(os: string): PlatformName {
  return os === 'ios' ? 'ios' : os === 'web' ? 'web' : 'android';
}

export interface PlatformAdapter {
  getPlatform(): PlatformName;

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
export const ADAPTER_MEMBERS: { [G in Exclude<keyof PlatformAdapter, 'getPlatform'>]: ReadonlyArray<keyof PlatformAdapter[G]> } = {
  speech: ['getCapability', 'installOnDevice', 'startDictation'],
  tts: ['getAdapter', 'getSpeaker'],
  audio: ['discardRecording', 'settleRecording'],
  files: ['saveFile', 'pickFile', 'saveJsonFile', 'pickJsonFile', 'deviceStorage', 'requestPersistence', 'cleanupTemporaryExports'],
  media: ['normalizeImageUri', 'pickImages', 'pickVideo', 'extractKeyframes'],
  network: ['getMonitor'],
  notifications: ['getAdapter'],
  random: ['bytes', 'uuid'],
};
