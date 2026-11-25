/**
 * JS side of the kalam-apple native module (ios/KalamAppleModule.swift): Apple Foundation Models on the
 * device (SystemLanguageModel, iOS 26 or later with Apple Intelligence on), and App Check tokens from
 * App Attest, with DeviceCheck as fallback. Optional at runtime: Expo Go, Android, web, a build without the
 * module and Node unit tests all get `module: null`.
 */

export type AppleAvailability = 'unavailable' | 'downloading' | 'available';
/** SystemLanguageModel.Availability.UnavailableReason, plus 'osTooOld' below iOS 26. */
export type AppleUnavailableReason = 'deviceNotEligible' | 'appleIntelligenceNotEnabled' | 'modelNotReady' | 'osTooOld' | 'unknown';

export interface AppleStatus {
  availability: AppleAvailability;
  reason?: AppleUnavailableReason | null;
  /** Primary language codes of SystemLanguageModel.default.supportedLanguages, for example "en". */
  languages?: string[] | null;
}

export interface AppleGenerateOptions {
  prompt: string;
  /** Unset means greedy decoding. */
  temperature?: number;
  maxOutputTokens?: number;
}

export interface KalamAppleModule {
  availability(): Promise<AppleStatus>;
  /** Runs one prompt on SystemLanguageModel.default. `source` is always 'on_device': no cloud path here. */
  generate(requestId: string, options: AppleGenerateOptions): Promise<{ text: string; source: 'on_device' }>;
  cancel(requestId: string): boolean;
  /** Sets the App Attest provider factory, then configures the native Firebase app. Safe to call twice. */
  installAppAttest(options: { apiKey: string; projectId: string; appId: string; gcmSenderId: string }): void;
  getAppCheckToken(forceRefresh: boolean): Promise<{ token: string; expireTimeMillis: number }>;
}

export type KalamAppleLookup = { module: KalamAppleModule; reason?: undefined } | { module: null; reason: string };

/** The module, or the reason it cannot be used. */
export function loadKalamApple(): KalamAppleLookup {
  // The same lookup requireOptionalNativeModule() makes first (expo-modules-core 58, JSI host object).
  // Importing expo-modules-core here would pull react-native into the Node unit tests.
  const module: KalamAppleModule | undefined = (globalThis as { expo?: { modules?: { KalamApple?: KalamAppleModule } } })
    .expo?.modules?.KalamApple;
  return module
    ? { module }
    : { module: null, reason: 'This copy of Kalam was built without its iOS module (kalam-apple), for example in Expo Go.' };
}
