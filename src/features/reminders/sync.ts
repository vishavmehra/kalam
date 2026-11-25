/**
 * Brings the device's scheduled notifications in line with an app's reminder settings and records.
 * Dependencies are injected so this runs in Node tests with a fake adapter; `runtime.ts` wires the
 * real database and platform adapter.
 *
 * Rules of the road:
 *  - Never asks for permission (that needs a person and an explanation). It reads the state.
 *  - Without permission it only cancels, so stale notifications never linger.
 *  - Calls for one app never overlap. A call made while one is running joins a single follow-up
 *    run, which starts after the first finishes and therefore sees the newest data.
 *  - Never throws. Failures are counted and reported.
 */
import type { NotificationAdapter } from '@/infrastructure/platform/notifications.shared';

import { computePlan, diffSchedule, parseNotificationId } from './scheduler';
import type { PlanStats, RecordsByCollection, ReminderConfig, SpecView } from './types';
import type { Zone } from './zone';

export interface SyncDeps {
  adapter: NotificationAdapter;
  /** `undefined` when the app no longer exists (everything scheduled for it is cancelled). Only called when a reminder is on. */
  loadApp(appId: string): Promise<{ spec: SpecView } | undefined>;
  loadRecords(appId: string): Promise<RecordsByCollection>;
  loadConfig(appId: string): Promise<ReminderConfig | undefined>;
  now(): number;
  zone?: Zone;
}

export type SyncStatus = 'synced' | 'no_permission' | 'unsupported' | 'error';

export interface SyncResult {
  appId: string;
  status: SyncStatus;
  scheduled: number;
  cancelled: number;
  unchanged: number;
  failed: number;
  stats?: PlanStats;
  message?: string;
}

const empty = (appId: string, status: SyncStatus, message?: string): SyncResult => ({
  appId, status, scheduled: 0, cancelled: 0, unchanged: 0, failed: 0, message,
});

export async function syncRemindersWith(deps: SyncDeps, appId: string): Promise<SyncResult> {
  try {
    const { adapter } = deps;
    const capability = await adapter.capability();
    if (!capability.supported) return empty(appId, 'unsupported');

    // Read the app and its records only when some reminder is switched on. With no settings the
    // desired set is empty, so this stays cheap enough to call after every record or state change.
    const config = await deps.loadConfig(appId);
    const app = config?.rules.some((r) => r.enabled) ? await deps.loadApp(appId) : undefined;
    const plan = app
      ? computePlan({
          appId,
          spec: app.spec,
          records: await deps.loadRecords(appId),
          config,
          now: deps.now(),
          zone: deps.zone,
        })
      : undefined;

    const ops = diffSchedule(appId, plan?.desired ?? [], await adapter.listScheduled());
    if (ops.cancel.length) await adapter.cancel(ops.cancel);

    if (capability.permission !== 'granted') {
      return { ...empty(appId, 'no_permission'), cancelled: ops.cancel.length, stats: plan?.stats };
    }

    let failed = 0;
    for (const notification of ops.schedule) {
      try {
        await adapter.schedule(notification);
      } catch {
        failed++;
      }
    }
    return {
      appId,
      status: 'synced',
      scheduled: ops.schedule.length - failed,
      cancelled: ops.cancel.length,
      unchanged: ops.unchanged,
      failed,
      stats: plan?.stats,
    };
  } catch (error) {
    return empty(appId, 'error', error instanceof Error ? error.message : 'Reminders could not be updated.');
  }
}

export interface SyncRunner {
  /** Syncs one app. Overlapping calls for the same app are merged. */
  sync(appId: string): Promise<SyncResult>;
  /** Syncs every given app, then cancels notifications that belong to apps that no longer exist. */
  syncAll(appIds: readonly string[]): Promise<SyncResult[]>;
}

export function createSyncRunner(deps: SyncDeps): SyncRunner {
  const tails = new Map<string, Promise<unknown>>();
  const queued = new Map<string, Promise<SyncResult>>();

  const sync = (appId: string): Promise<SyncResult> => {
    const waiting = queued.get(appId);
    if (waiting) return waiting;
    const previous = tails.get(appId) ?? Promise.resolve();
    const run = previous.then(() => {
      queued.delete(appId);
      return syncRemindersWith(deps, appId);
    });
    queued.set(appId, run);
    tails.set(appId, run);
    void run.then(() => {
      if (tails.get(appId) === run) tails.delete(appId);
    });
    return run;
  };

  return {
    sync,
    async syncAll(appIds) {
      const results: SyncResult[] = [];
      for (const id of appIds) results.push(await sync(id));
      try {
        const live = new Set(appIds);
        const orphans = (await deps.adapter.listScheduled())
          .map((s) => s.id)
          .filter((id) => {
            const parsed = parseNotificationId(id);
            return parsed !== undefined && !live.has(parsed.appId);
          });
        if (orphans.length) await deps.adapter.cancel(orphans);
      } catch {
        // Orphan cleanup is best effort; the next launch tries again.
      }
      return results;
    },
  };
}
