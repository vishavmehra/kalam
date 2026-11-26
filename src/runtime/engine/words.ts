/**
 * Words for a running app, in the app's own language (`spec.lang`), from the same catalogue as the rest of Kalam
 * (keys under `runtime.*`). Synchronous and offline: English is bundled, and another language is used once its
 * catalogue has loaded (KalamRuntime and every block ask for it). Until then the English words show.
 * Pure TypeScript, no React: the engine and the React hook (../use-app-t.tsx) share it.
 */
import { getTranslator } from '@/i18n/active';
import type { TFunction } from '@/i18n/translator';

/** `t` for an app language. The same function is returned until a catalogue loads, so it is safe in memo deps. */
export function appT(lang?: string | null): TFunction {
  return getTranslator(lang || 'en').t;
}
