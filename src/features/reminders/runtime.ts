/**
 * Default wiring for reminders: the real database, the real platform adapter and the device clock.
 * UI code calls `syncReminders(appId)` after anything that can change what is due.
 */
import { getNotificationAdapter } from '@/infrastructure/platform/notifications';
import { getServices } from '@/services';

import { loadReminderConfig } from './config';
import { createSyncRunner, type SyncResult, type SyncRunner } from './sync';

let runner: SyncRunner | undefined;

function getRunner(): SyncRunner {
  runner ??= createSyncRunner({
    adapter: getNotificationAdapter(),
    loadApp: (appId) => getServices().db.apps.get(appId),
    loadRecords: (appId) => getServices().db.records.listAll(appId),
    loadConfig: (appId) => loadReminderConfig(getServices().db.state, appId),
    now: Date.now,
  });
  return runner;
}

/**
 * Brings the device's reminders in line with one app's settings and records. Safe to call as often
 * as you like (calls merge) and never throws. Call it after records or reminder settings change,
 * and after an app is deleted (it then cancels that app's notifications).
 */
export function syncReminders(appId: string): Promise<SyncResult> {
  return getRunner().sync(appId);
}

/**
 * Syncs every app on this device and cancels notifications left behind by deleted apps. Call it
 * on launch and when Kalam comes back to the foreground: it re-arms web timers, picks up a
 * changed time zone, and schedules reminders that have come inside the 60 day window.
 */
export async function syncAllReminders(): Promise<SyncResult[]> {
  const apps = await getServices().db.apps.list();
  return getRunner().syncAll(apps.map((a) => a.id));
}
