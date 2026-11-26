/**
 * RuntimeServices for previews: records and counters live in memory (optionally seeded with a
 * copy of the real data), while photos, speech and AI blocks use the real device / AI services.
 * Speech goes through `speakAloud`: the person's voice settings and one shared queue.
 */
import type { KalamRecord, RecordValue, RuntimeServices } from '@/core/contracts';
import { collabGuardedRecords } from '@/infrastructure/collab/service';
import { sharedRecordRepository } from '@/features/share/use-share';
import { getServices } from '@/services';
import { countingRecords } from './engine/counting';
import { createMemoryStores } from './engine/memory-store';
import { withBatch } from './engine/transaction';
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
    // Counted here, where an entry is really saved, and not in the engine: previews do not count (see counting.ts).
    // `withBatch` lets multi-step writes (cascade delete) reach the database's one-transaction `batch` through the sharing layer.
    // `collabGuardedRecords` goes outside so a viewer's copy refuses every write, batches included.
    records: countingRecords(collabGuardedRecords(withBatch(sharedRecordRepository(services.db.records), services.db.records)), () => services.network.online()),
    state: services.db.state,
    runAIBlock: (input) => services.aiBlocks.run(input),
    speak: speakAloud,
    pickImage: pickImageForAI,
    confirm: (message) => confirmDialog(message),
    online: () => services.network.online(),
  };
}
