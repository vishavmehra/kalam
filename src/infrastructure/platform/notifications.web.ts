import {
  NOTIFICATION_ID_PREFIX,
  type LocalNotification,
  type NotificationAdapter,
  type NotificationCapability,
  type NotificationPermissionState,
} from './notifications.shared';

export * from './notifications.shared';

/** `setTimeout` cannot wait longer than about 24.8 days; longer waits re-arm themselves. */
const MAX_TIMER_MS = 2_147_000_000;

interface Armed {
  notification: LocalNotification;
  timer: ReturnType<typeof setTimeout> | undefined;
}

type NotificationApi = typeof Notification;

function api(): NotificationApi | undefined {
  const g = globalThis as { Notification?: NotificationApi; isSecureContext?: boolean };
  // The Notification API only works in secure contexts (https or localhost).
  if (typeof g.Notification === 'undefined' || g.isSecureContext === false) return undefined;
  return g.Notification;
}

function permissionOf(N: NotificationApi): NotificationPermissionState {
  if (N.permission === 'granted') return 'granted';
  if (N.permission === 'denied') return 'denied';
  return 'undetermined';
}

function currentCapability(): NotificationCapability {
  const N = api();
  if (!N) return { supported: false, permission: 'unsupported', canAskAgain: false, delivery: 'none' };
  const permission = permissionOf(N);
  return { supported: true, permission, canAskAgain: permission !== 'denied', delivery: 'while_open' };
}

async function show(n: LocalNotification): Promise<void> {
  const N = api();
  if (!N || N.permission !== 'granted') return;
  const options: NotificationOptions = { body: n.body, tag: n.id, data: { kalam: true, appId: n.appId } };
  try {
    // Chrome on Android only allows notifications through a service worker registration.
    const registration = await globalThis.navigator?.serviceWorker?.getRegistration?.();
    if (registration && typeof registration.showNotification === 'function') {
      await registration.showNotification(n.title, options);
      return;
    }
  } catch {
    // Fall through to the page notification below.
  }
  try {
    new N(n.title, options);
  } catch {
    // Some browsers refuse the constructor. The in-app "Due today" list still shows the item.
  }
}

/**
 * Web adapter. A page cannot schedule a notification for when it is closed, so reminders are
 * timers that live as long as the page. `useReminderBootstrap` re-arms them on every launch and when
 * the tab becomes visible again, and the in-app "Due today" list works regardless.
 */
export function createWebNotificationAdapter(): NotificationAdapter {
  const armed = new Map<string, Armed>();

  const disarm = (id: string) => {
    const entry = armed.get(id);
    if (entry?.timer !== undefined) clearTimeout(entry.timer);
    armed.delete(id);
  };

  const arm = (n: LocalNotification) => {
    disarm(n.id);
    if (n.fireAt <= Date.now()) return;
    const entry: Armed = { notification: n, timer: undefined };
    armed.set(n.id, entry);
    const tick = () => {
      const wait = n.fireAt - Date.now();
      if (wait > MAX_TIMER_MS) {
        entry.timer = setTimeout(tick, MAX_TIMER_MS);
        return;
      }
      entry.timer = setTimeout(() => {
        armed.delete(n.id);
        void show(n);
      }, Math.max(0, wait));
    };
    tick();
  };

  return {
    async capability() {
      return currentCapability();
    },
    async requestPermission() {
      const N = api();
      if (!N || N.permission !== 'default') return currentCapability();
      await new Promise<void>((resolve) => {
        try {
          // Older Safari uses a callback; modern browsers return a promise. Handle both.
          const result = N.requestPermission(() => resolve()) as Promise<NotificationPermission> | undefined;
          if (result && typeof result.then === 'function') result.then(() => resolve(), () => resolve());
        } catch {
          resolve();
        }
      });
      return currentCapability();
    },
    async listScheduled() {
      return [...armed.values()]
        .filter((e) => e.notification.id.startsWith(NOTIFICATION_ID_PREFIX))
        .map((e) => ({ id: e.notification.id, hash: e.notification.hash, fireAt: e.notification.fireAt }));
    },
    async schedule(n) {
      if (api()) arm(n);
    },
    async cancel(ids) {
      for (const id of ids) disarm(id);
    },
  };
}

let instance: NotificationAdapter | undefined;

export function getNotificationAdapter(): NotificationAdapter {
  instance ??= createWebNotificationAdapter();
  return instance;
}
