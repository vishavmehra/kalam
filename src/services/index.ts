/**
 * Composition root. The ONLY place that wires infrastructure to the core. UI code calls
 * `getServices()`; feature modules never construct providers or databases themselves
 * (docs/07 §9.1 — one central orchestrator; docs/04 §3.11 — one Firebase init).
 */
import type { KalamServices } from '@/core/contracts';
import { createOrchestrator } from '@/core/ai/orchestrator';
import { createApplicationPipeline } from '@/core/pipeline/create-application';
import { createAIBlockService } from '@/core/tasks/ai-block-service';
import { createEditService } from '@/core/tasks/edit-service';
import { createTranslateService } from '@/core/tasks/translate-service';
import { createVoiceService } from '@/core/tasks/voice-service';
import { createFirebaseProvider } from '@/infrastructure/firebase/firebase-provider';
import { getNetworkMonitor } from '@/infrastructure/platform/network';
import { createSpecialistProvider } from '@/infrastructure/specialist/specialist-provider';
import { getDatabase, secureRandomBytes } from '@/infrastructure/storage/database';
import { createBackupService } from '@/core/backup';
import { getAuthService } from '@/infrastructure/firebase/auth';
import { getKalamFirestore } from '@/infrastructure/firebase/firestore';
import { createBazaarService } from '@/infrastructure/bazaar/bazaar-service';

let instance: KalamServices | undefined;

export function getServices(): KalamServices {
  if (instance) return instance;
  const db = getDatabase();
  const network = getNetworkMonitor();
  const ai = createOrchestrator({
    firebase: createFirebaseProvider(),
    specialist: createSpecialistProvider(),
    events: db.events,
    settings: db.settings,
    network,
  });
  instance = {
    db,
    ai,
    network,
    createApplication: createApplicationPipeline({
      ai,
      // Specialist planning (Claude via Cloud Function) only with explicit user consent (docs/07 §9.5).
      specialistConsent: async () => (await db.settings.get()).allowExternalProviders,
    }),
    edit: createEditService({ ai }),
    aiBlocks: createAIBlockService({ ai }),
    voice: createVoiceService({ ai }),
    // App label translation (docs/17 §7.6). Translations live on the device in db.translations.
    translate: createTranslateService({ ai, cache: db.translations, settings: db.settings }),
    // Encrypted backup and restore (docs/11 §12): AES-GCM + PBKDF2, everything stays on the device.
    backup: createBackupService({ db, randomBytes: secureRandomBytes }),
    auth: getAuthService(),
    bazaar: createBazaarService({ firestore: getKalamFirestore, auth: getAuthService(), ai, db, network }),
  };
  return instance;
}
