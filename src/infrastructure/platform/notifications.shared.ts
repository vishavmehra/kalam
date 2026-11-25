/**
 * Local notification contract shared by the platform adapters (docs/14 §10.4).
 *
 * `notifications.native.ts` uses expo-notifications (Android, scheduled by the OS, works with the
 * app closed). `notifications.web.ts` uses the browser Notification API and in-page timers, so a
 * web reminder only appears while Kalam is open in the browser. Neither needs a server.
 *
 * Adapters are deliberately thin: they never decide WHAT to schedule. The pure scheduler in
 * `src/features/reminders/scheduler.ts` computes the desired set and the diff; adapters only
 * list, schedule, cancel and ask for permission.
 */

/** Every Kalam notification id starts with this, so adapters never touch anything else. */
export const NOTIFICATION_ID_PREFIX = 'kalam.';

export type NotificationPermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export interface NotificationCapability {
  /** This platform can show notifications at all. */
  supported: boolean;
  permission: NotificationPermissionState;
  /** The system prompt can still be shown. False after the user chose "block" or "don't ask again". */
  canAskAgain: boolean;
  /**
   * `system`: the OS delivers it, even with Kalam closed (Android).
   * `while_open`: only delivered while Kalam is open in this browser (web).
   * `none`: nothing can be delivered.
   */
  delivery: 'system' | 'while_open' | 'none';
}

/** One notification Kalam wants on the device. `fireAt` is epoch milliseconds. */
export interface LocalNotification {
  /** Deterministic id (`kalam.<appId>.<ruleId>.<recordId>`). Scheduling an existing id replaces it. */
  id: string;
  appId: string;
  title: string;
  body: string;
  fireAt: number;
  /** Fingerprint of fireAt + text. Stored with the notification so a later sync can tell if it changed. */
  hash: string;
}

/** What the platform reports back for something already scheduled. */
export interface ScheduledNotificationRef {
  id: string;
  hash?: string;
  fireAt?: number;
}

export interface NotificationAdapter {
  capability(): Promise<NotificationCapability>;
  /**
   * Shows the system permission prompt when it is still allowed, then returns the new state.
   * Call this only from a user action, after explaining why (web browsers require a gesture).
   */
  requestPermission(): Promise<NotificationCapability>;
  /** Kalam notifications that are currently scheduled (never other apps' notifications). */
  listScheduled(): Promise<ScheduledNotificationRef[]>;
  /** Schedules, or replaces the notification with the same id. Does nothing for a time in the past. */
  schedule(notification: LocalNotification): Promise<void>;
  cancel(ids: readonly string[]): Promise<void>;
  /** Opens the system page where a blocked permission can be changed. Absent on web. */
  openSettings?(): Promise<void>;
}
