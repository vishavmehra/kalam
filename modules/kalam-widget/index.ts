/**
 * JS side of the kalam-widget native module (android/.../KalamWidgetModule.kt, ios/KalamWidgetModule.swift): home-screen
 * widgets for Kalam (docs/14 §18). The app sends one finished message (src/core/widgets/payload.ts) as JSON text. The
 * module stores it, redraws the widgets and can ask the system to add one. Nothing else crosses this line: the widgets
 * never read the app's data and never use the network. Optional at runtime: Expo Go, web, a build without the module and
 * Node unit tests all get `module: null`.
 */

export type NativeWidgetAvailability =
  | { supported: false; platform: 'android' | 'ios'; reason?: string }
  | { supported: true; platform: 'android' | 'ios'; canPin: boolean; canCount: boolean };

export type NativePinResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'unknown_widget' | 'failed' };

export interface KalamWidgetModule {
  availability(): Promise<NativeWidgetAvailability>;
  /** Stores the message (version 1, at most 256 KB) and redraws every widget. Resolves to how many widgets it holds. Rejects when the message is not accepted. */
  publish(payloadJson: string): Promise<number>;
  /** Forgets the message. Widgets already on the home screen stay and ask the person to pick again. */
  clear(): Promise<void>;
  /** Asks the system to add this widget to the home screen. Android only; iOS answers `unsupported`. */
  requestPin(widgetId: string): Promise<NativePinResult>;
  /** Widget id to how many are on the home screen. Empty where the platform cannot tell. */
  placed(): Promise<Record<string, number>>;
}

export type KalamWidgetLookup = { module: KalamWidgetModule; reason?: undefined } | { module: null; reason: string };

const NOT_LINKED = 'This copy of Kalam was built without its widget module (kalam-widget), for example in Expo Go.';

/** The native module, or the reason it cannot be used. */
export function loadKalamWidget(): KalamWidgetLookup {
  // The same lookup requireOptionalNativeModule() makes first (expo-modules-core 58, JSI host object).
  // Importing expo-modules-core here would pull react-native into the Node unit tests.
  const module: KalamWidgetModule | undefined = globalThis.expo?.modules?.KalamWidget;
  return module ? { module } : { module: null, reason: NOT_LINKED };
}
