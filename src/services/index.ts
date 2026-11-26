/**
 * Composition root. The ONLY place that wires infrastructure to the core. UI code calls
 * `getServices()`; feature modules never construct providers or databases themselves
 * (docs/07 §9.1 — one central orchestrator; docs/04 §3.11 — one Firebase init).
 */
import { Platform } from 'react-native';
import type { KalamServices } from '@/core/contracts';
import { createOrchestrator } from '@/core/ai/orchestrator';
import { classifyWithTieBreak } from '@/core/classifier/tie-break';
import { createApplicationPipeline } from '@/core/pipeline/create-application';
import { createAIBlockService } from '@/core/tasks/ai-block-service';
import { createTranscribeService } from '@/core/tasks/transcribe-service';
import { createEditService } from '@/core/tasks/edit-service';
import { createTranslateService } from '@/core/tasks/translate-service';
import { createVoiceService } from '@/core/tasks/voice-service';
import { askCloudNotice } from '@/features/cloud-consent/broker';
import { createFirebaseProvider } from '@/infrastructure/firebase/firebase-provider';
import { platformNameFor } from '@/infrastructure/platform/adapter.shared';
import { getConnectivity } from '@/infrastructure/platform/connectivity';
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
  // Connectivity (docs/09 §13.4): the platform's answer, plus a short hold on cloud work after a network failure.
  const network = getConnectivity();
  const ai = createOrchestrator({
    firebase: createFirebaseProvider(),
    specialist: createSpecialistProvider(),
    events: db.events,
    settings: db.settings,
    network,
    // Reused answers survive a restart, and go with their app (db.aiCache.removeForApp).
    aiCache: db.aiCache,
    // Inference events name the real platform; a React Native runtime alone cannot tell iOS from Android.
    platform: platformNameFor(Platform.OS),
    // The one-time cloud notice (docs/15 TD-01): asked before the first cloud-bound call. CloudNoticeHost, mounted in the root layout, shows it.
    askCloudNotice,
  });
  instance = {
    db,
    ai,
    network,
    createApplication: createApplicationPipeline({
      ai,
      // Close complexity calls ask the loaded on-device model to choose between two levels (docs/07 §3.4). Never cloud.
      classify: (input) => classifyWithTieBreak(input, { ai }),
      // Specialist planning (Claude via Cloud Function) only with explicit user consent (docs/07 §9.5).
      specialistConsent: async () => (await db.settings.get()).allowExternalProviders,
      // Build-time AI-step check: no cloud call when cloud help is off or offline-only mode is on (docs/07 §13.3).
      cloudConsent: async () => {
        const s = await db.settings.get();
        return s.allowCloud && s.aiMode !== 'offline_only';
      },
    }),
    edit: createEditService({ ai }),
    aiBlocks: createAIBlockService({ ai }),
    // Cloud transcription of an uploaded audio file; the cloud notice is asked by the orchestrator.
    transcribe: createTranscribeService({ ai }),
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
