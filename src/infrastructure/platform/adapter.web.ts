/** Web: the browser modules behind one PlatformAdapter. Nothing here is new; see adapter.shared.ts. */
import { pickJsonFile, saveJsonFile } from '@/components/files/json-file.web';
import {
  cleanupTemporaryExports, deviceStorage, pickFile, requestPersistence, saveFile,
} from '@/features/storage/platform.web';
import { describeCapabilities, type PlatformAdapter } from './adapter.shared';
import { normalizeImageUri, pickImages, pickVideo } from './image';
import { discardRecording, settleRecording } from './media-audio.web';
import { extractKeyframes } from './media.web';
import { getNetworkMonitor } from './network.web';
import { getNotificationAdapter } from './notifications.web';
import { getSpeechCapability, installOnDeviceSpeech, startDictation } from './speech.web';
import { getSpeaker, getTtsAdapter } from './tts.web';

export * from './adapter.shared';

const adapter: PlatformAdapter = {
  getPlatform: () => 'web',
  capabilities: () => describeCapabilities(adapter),
  speech: { getCapability: getSpeechCapability, installOnDevice: installOnDeviceSpeech, startDictation },
  tts: { getAdapter: getTtsAdapter, getSpeaker },
  audio: { discardRecording, settleRecording },
  files: { saveFile, pickFile, saveJsonFile, pickJsonFile, deviceStorage, requestPersistence, cleanupTemporaryExports },
  media: { normalizeImageUri, pickImages, pickVideo, extractKeyframes },
  network: { getMonitor: getNetworkMonitor },
  notifications: { getAdapter: getNotificationAdapter },
  random: {
    bytes: (length) => globalThis.crypto.getRandomValues(new Uint8Array(length)),
    uuid: () => globalThis.crypto.randomUUID(),
  },
};

export function getPlatformAdapter(): PlatformAdapter {
  return adapter;
}
