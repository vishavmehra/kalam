import type * as ExpoNotifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import {
  NOTIFICATION_ID_PREFIX,
  type LocalNotification,
  type NotificationAdapter,
  type NotificationCapability,
  type NotificationPermissionState,
} from './notifications.shared';

export * from './notifications.shared';

type Module = typeof ExpoNotifications;

const CHANNEL_ID = 'kalam-reminders';

let moduleReady: Promise<Module | undefined> | undefined;

/**
 * Loads expo-notifications once and prepares it: foreground display rules and the Android channel.
 * The channel must exist before the permission prompt on Android 13+. If the native module is not
 * available the adapter reports `unsupported` and the in-app "Due today" list still works.
 */
function loadModule(): Promise<Module | undefined> {
  moduleReady ??= import('expo-notifications')
    .then(async (m) => {
      m.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
      if (Platform.OS === 'android') {
        await m.setNotificationChannelAsync(CHANNEL_ID, {
          name: 'Reminders',
          description: 'Reminders you set up inside your apps.',
          importance: m.AndroidImportance.HIGH,
        });
      }
      return m;
    })
    .catch(() => undefined);
  return moduleReady;
}

function stateOf(status: string): NotificationPermissionState {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

const UNSUPPORTED: NotificationCapability = { supported: false, permission: 'unsupported', canAskAgain: false, delivery: 'none' };

async function readCapability(m: Module): Promise<NotificationCapability> {
  try {
    const p = await m.getPermissionsAsync();
    return { supported: true, permission: stateOf(p.status), canAskAgain: p.canAskAgain, delivery: 'system' };
  } catch {
    return UNSUPPORTED;
  }
}

function dataOf(content: { data?: unknown }): { hash?: string; fireAt?: number } {
  const d = content.data;
  if (typeof d !== 'object' || d === null) return {};
  const rec = d as { hash?: unknown; fireAt?: unknown };
  return {
    hash: typeof rec.hash === 'string' ? rec.hash : undefined,
    fireAt: typeof rec.fireAt === 'number' ? rec.fireAt : undefined,
  };
}

/** Android adapter: the OS schedules and delivers, so reminders arrive with Kalam closed. */
const adapter: NotificationAdapter = {
  async capability() {
    const m = await loadModule();
    return m ? readCapability(m) : UNSUPPORTED;
  },

  async requestPermission() {
    const m = await loadModule();
    if (!m) return UNSUPPORTED;
    const before = await readCapability(m);
    if (before.permission !== 'undetermined' || !before.canAskAgain) return before;
    try {
      await m.requestPermissionsAsync();
    } catch {
      // Fall through: report whatever state the system now has.
    }
    return readCapability(m);
  },

  async listScheduled() {
    const m = await loadModule();
    if (!m) return [];
    try {
      const all = await m.getAllScheduledNotificationsAsync();
      return all
        .filter((n) => n.identifier.startsWith(NOTIFICATION_ID_PREFIX))
        .map((n) => ({ id: n.identifier, ...dataOf(n.content) }));
    } catch {
      return [];
    }
  },

  async schedule(n: LocalNotification) {
    const m = await loadModule();
    if (!m || n.fireAt <= Date.now()) return;
    // Replace rather than duplicate: drop any earlier notification with this id first.
    await m.cancelScheduledNotificationAsync(n.id).catch(() => undefined);
    await m.scheduleNotificationAsync({
      identifier: n.id,
      content: {
        title: n.title,
        body: n.body,
        data: { kalam: true, appId: n.appId, hash: n.hash, fireAt: n.fireAt },
      },
      trigger: {
        type: m.SchedulableTriggerInputTypes.DATE,
        date: n.fireAt,
        channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
      },
    });
  },

  async cancel(ids) {
    const m = await loadModule();
    if (!m) return;
    for (const id of ids) await m.cancelScheduledNotificationAsync(id).catch(() => undefined);
  },

  async openSettings() {
    await Linking.openSettings();
  },
};

export function getNotificationAdapter(): NotificationAdapter {
  return adapter;
}
