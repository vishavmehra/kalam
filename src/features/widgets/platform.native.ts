/**
 * Android and iOS: the kalam-widget native module (modules/kalam-widget). Without it (Expo Go, a build that left it out) widgets
 * are reported as not available with the reason, and nothing is faked.
 */
import { Platform } from 'react-native';
import { loadKalamWidget } from '../../../modules/kalam-widget';
import type { PinOutcome, WidgetAvailability, WidgetPlatform } from '@/core/widgets';

const name = (): 'android' | 'ios' => (Platform.OS === 'ios' ? 'ios' : 'android');

export function createWidgetPlatform(): WidgetPlatform {
  const unavailable = (reason: string): WidgetAvailability => ({ supported: false, platform: name(), reason });
  return {
    async availability() {
      const { module, reason } = loadKalamWidget();
      if (!module) return unavailable(reason);
      try {
        const a = await module.availability();
        if (!a.supported) return unavailable(a.reason ?? 'This build has no widget support.');
        return { supported: true, platform: a.platform === 'ios' ? 'ios' : 'android', canPin: a.canPin === true, canCount: a.canCount === true };
      } catch (e) {
        return unavailable(e instanceof Error ? e.message : 'The widget module did not answer.');
      }
    },

    async publish(json) {
      const { module, reason } = loadKalamWidget();
      if (!module) throw new Error(reason);
      await module.publish(json);
    },

    async clear() {
      await loadKalamWidget().module?.clear();
    },

    async requestPin(widgetId): Promise<PinOutcome> {
      const { module, reason } = loadKalamWidget();
      if (!module) return { ok: false, reason: 'unsupported', message: reason };
      const r = await module.requestPin(widgetId);
      if (r.ok) return { ok: true, requested: true };
      if (r.reason === 'unknown_widget') return { ok: false, reason: 'unknown_widget', message: 'That widget is not on this device.' };
      if (r.reason === 'unsupported') return { ok: false, reason: 'unsupported', message: 'This launcher cannot add widgets from an app.' };
      return { ok: false, reason: 'failed', message: 'The system could not be asked to add the widget.' };
    },

    async placed() {
      return (await loadKalamWidget().module?.placed().catch(() => ({}))) ?? {};
    },

    // The install menu is a web idea.
    setShortcuts: async () => undefined,
  };
}
