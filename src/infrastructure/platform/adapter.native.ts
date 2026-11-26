/** Android and iOS: the native modules behind one PlatformAdapter. Nothing here is new; see adapter.shared.ts. */
import { getRandomBytes, randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';

import { pickJsonFile, saveJsonFile } from '@/components/files/json-file';
import {
  cleanupTemporaryExports, deviceStorage, pickFile, requestPersistence, saveFile,
} from '@/features/storage/platform';
import { describeCapabilities, platformNameFor, type PlatformAdapter } from './adapter.shared';
import { normalizeImageUri, pickImages, pickVideo } from './image';
import { discardRecording, settleRecording } from './media-audio.native';
import { extractKeyframes } from './media.native';
import { getNetworkMonitor } from './network.native';
import { getNotificationAdapter } from './notifications.native';
import { getSpeechCapability, installOnDeviceSpeech, startDictation } from './speech';
import { getSpeaker, getTtsAdapter } from './tts.native';

export * from './adapter.shared';

const adapter: PlatformAdapter = {
  getPlatform: () => platformNameFor(Platform.OS),
  capabilities: () => describeCapabilities(adapter),
  speech: { getCapability: getSpeechCapability, installOnDevice: installOnDeviceSpeech, startDictation },
  tts: { getAdapter: getTtsAdapter, getSpeaker },
  audio: { discardRecording, settleRecording },
  files: { saveFile, pickFile, saveJsonFile, pickJsonFile, deviceStorage, requestPersistence, cleanupTemporaryExports },
  media: { normalizeImageUri, pickImages, pickVideo, extractKeyframes },
  network: { getMonitor: getNetworkMonitor },
  notifications: { getAdapter: getNotificationAdapter },
  // Hermes has no crypto.getRandomValues; expo-crypto reads the OS secure random source.
  random: { bytes: (length) => getRandomBytes(length), uuid: () => randomUUID() },
};

export function getPlatformAdapter(): PlatformAdapter {
  return adapter;
}
