/**
 * The web has no home-screen widgets (docs/14 §18.3). What it has is the install menu of the installed web app (PWA
 * shortcuts). The pinned apps the person chose to list there are kept in a cache the service worker reads when the browser
 * asks for the manifest (scripts/build-pwa.mjs). Names and paths only, on this device.
 */
import type { PinOutcome, WebShortcut, WidgetAvailability, WidgetPlatform } from '@/core/widgets';

/** Must match PINNED_CACHE and PINNED_URL in scripts/build-pwa.mjs. */
export const PINNED_CACHE = 'pinned-shortcuts';
export const PINNED_URL = '/__kalam/pinned.json';

const UNSUPPORTED: WidgetAvailability = {
  supported: false,
  platform: 'web',
  reason: 'The web app has no home-screen widgets.',
};
const NO_PIN: PinOutcome = { ok: false, reason: 'unsupported', message: 'The web app cannot add a widget to a home screen.' };

export function createWidgetPlatform(): WidgetPlatform {
  return {
    availability: async () => UNSUPPORTED,
    publish: async () => undefined,
    clear: async () => undefined,
    requestPin: async () => NO_PIN,
    placed: async () => ({}),
    async setShortcuts(shortcuts: readonly WebShortcut[]) {
      // Not installed, no service worker or no Cache API (a plain http page, a test): nothing to keep.
      const store = (globalThis as { caches?: CacheStorage }).caches;
      if (!store) return;
      try {
        const cache = await store.open(PINNED_CACHE);
        if (shortcuts.length === 0) {
          await cache.delete(PINNED_URL);
          return;
        }
        await cache.put(PINNED_URL, new Response(JSON.stringify(shortcuts), { headers: { 'Content-Type': 'application/json' } }));
      } catch {
        // Storage can be blocked (private windows). The install menu simply stays as built.
      }
    },
  };
}
