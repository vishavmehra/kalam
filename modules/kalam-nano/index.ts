/**
 * JS side of the kalam-nano native module (android/src/main/java/expo/modules/kalamnano/KalamNanoModule.kt):
 * Gemini Nano through Firebase AI Logic's Android on-device SDK, and App Check tokens from Play Integrity.
 * Optional at runtime: Expo Go, web, a build without the module and Node unit tests all get `module: null`.
 */

export type NativeAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

export interface NativeStatus {
  availability: NativeAvailability;
  /** AICore model name, for example nano-v3 or nano-v4-full, when the model is available. */
  model?: string | null;
  detail?: string | null;
}

export interface NativeGenerateOptions {
  prompt: string;
  /** Unset means the on-device defaults (temperature 0, greedy decoding). */
  temperature?: number;
  topK?: number;
  maxOutputTokens?: number;
}

export interface KalamNanoModule {
  configure(options: { apiKey: string; projectId: string; appId: string }): void;
  availability(): Promise<NativeStatus>;
  /** Downloads the model if needed (emits onDownloadProgress), then loads it into memory. */
  prepare(): Promise<NativeStatus>;
  /** Loads an already downloaded model into memory. Never downloads. */
  warmUp(): Promise<boolean>;
  /** Runs Firebase AI Logic with InferenceMode.ONLY_ON_DEVICE; `source` is the SDK's inferenceSource. */
  generate(requestId: string, options: NativeGenerateOptions): Promise<{ text: string; source: 'on_device' | 'cloud' }>;
  cancel(requestId: string): boolean;
  installPlayIntegrity(): void;
  getAppCheckToken(forceRefresh: boolean): Promise<{ token: string; expireTimeMillis: number }>;
  addListener(
    event: 'onDownloadProgress',
    listener: (e: { bytesDownloaded: number; bytesToDownload?: number | null }) => void,
  ): { remove(): void };
}

export type KalamNanoLookup = { module: KalamNanoModule; reason?: undefined } | { module: null; reason: string };

const NOT_LINKED = 'This copy of Kalam was built without its Android module (kalam-nano), for example in Expo Go.';
let configured = false;

/**
 * The native module, configured once with the public Firebase identifiers, or the reason it cannot be
 * used. EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID (the Android app registered in Firebase) is needed for Play
 * Integrity. Without it the native Firebase app uses the web app id, which is enough for Nano.
 */
export function loadKalamNano(): KalamNanoLookup {
  // The same lookup requireOptionalNativeModule() makes first (expo-modules-core 58, JSI host object).
  // Importing expo-modules-core here would pull react-native into the Node unit tests.
  const module: KalamNanoModule | undefined = globalThis.expo?.modules?.KalamNano;
  if (!module) return { module: null, reason: NOT_LINKED };
  if (!configured) {
    const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
    const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
    const appId = process.env.EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID || process.env.EXPO_PUBLIC_FIREBASE_APP_ID;
    if (!apiKey || !projectId || !appId) {
      return { module: null, reason: 'Firebase is not set up in this build, so on-device AI cannot start.' };
    }
    try {
      module.configure({ apiKey, projectId, appId });
    } catch (e) {
      return { module: null, reason: `On-device AI could not start: ${e instanceof Error ? e.message : String(e)}` };
    }
    configured = true;
  }
  return { module };
}
