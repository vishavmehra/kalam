/**
 * RuntimeServices for previews: records and counters live in memory (optionally seeded with a
 * copy of the real data), while photos, speech and AI blocks use the real device / AI services.
 * Speech goes through `speakAloud`: the person's voice settings and one shared queue.
 */
import type { KalamRecord, RecordValue, RuntimeServices } from '@/core/contracts';
import { getServices } from '@/services';
import { createMemoryStores } from './engine/memory-store';
import { confirmDialog, pickImageForAI } from './platform';
import { speakAloud } from './voice/speak';

export function createMemoryRuntimeServices(
  appId: string,
  seed?: { records?: Record<string, KalamRecord[]>; state?: Record<string, RecordValue> },
): RuntimeServices {
  const stores = createMemoryStores(appId, seed);
  return {
    ...stores,
    runAIBlock: (input) => getServices().aiBlocks.run(input),
    speak: speakAloud,
    pickImage: pickImageForAI,
    confirm: (message) => confirmDialog(message),
    online: () => getServices().network.online(),
  };
}

/** RuntimeServices over the persistent local database — used by the installed app route. */
export function createDeviceRuntimeServices(): RuntimeServices {
  const services = getServices();
  return {
    records: services.db.records,
    state: services.db.state,
    runAIBlock: (input) => services.aiBlocks.run(input),
    speak: speakAloud,
    pickImage: pickImageForAI,
    confirm: (message) => confirmDialog(message),
    online: () => services.network.online(),
  };
}
