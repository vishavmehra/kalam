/**
 * React hooks for reminders. Data comes from the local database only, so everything here works
 * offline. The heavy logic is in the pure scheduler; these hooks load, subscribe and re-render.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { getNotificationAdapter, type NotificationCapability } from '@/infrastructure/platform/notifications';
import { getServices } from '@/services';

import { loadReminderConfig, saveReminderConfig } from './config';
import { syncAllReminders, syncReminders } from './runtime';
import { computeDue } from './scheduler';
import type { DueResult, RecordsByCollection, ReminderConfig, SpecView } from './types';

/** The clock, refreshed every minute and when the app comes back to the foreground. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, intervalMs);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') tick();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [intervalMs]);
  return now;
}

export interface ReminderData {
  /** `undefined` until the person saves reminder settings. */
  config: ReminderConfig | undefined;
  records: RecordsByCollection;
  loaded: boolean;
  /** Saves the settings, then updates the device's scheduled reminders. Throws a plain-language Error if they cannot be saved. */
  save(next: ReminderConfig): Promise<void>;
}

/** Reminder settings and the app's records, kept current as either changes. */
export function useReminderData(appId: string): ReminderData {
  const [config, setConfig] = useState<ReminderConfig | undefined>(undefined);
  const [records, setRecords] = useState<RecordsByCollection>({});
  const [loaded, setLoaded] = useState({ config: false, records: false });

  useEffect(() => {
    const { db } = getServices();
    let alive = true;
    // A failed read keeps what was last shown; the list is a convenience, never a blocker.
    const loadConfig = async () => {
      try {
        const next = await loadReminderConfig(db.state, appId);
        if (alive) setConfig(next);
      } catch {
        // keep previous
      }
      if (alive) setLoaded((l) => ({ ...l, config: true }));
    };
    const loadRecords = async () => {
      try {
        const next = await db.records.listAll(appId);
        if (alive) setRecords(next);
      } catch {
        // keep previous
      }
      if (alive) setLoaded((l) => ({ ...l, records: true }));
    };
    void loadConfig();
    void loadRecords();
    const offState = db.state.subscribe(appId, () => void loadConfig());
    const offRecords = db.records.subscribe(appId, () => void loadRecords());
    return () => {
      alive = false;
      offState();
      offRecords();
    };
  }, [appId]);

  const save = useCallback(
    async (next: ReminderConfig) => {
      await saveReminderConfig(getServices().db.state, appId, next);
      setConfig(next);
      void syncReminders(appId);
    },
    [appId],
  );

  return { config, records, loaded: loaded.config && loaded.records, save };
}

export type DueToday = DueResult & { count: number; loaded: boolean };

/**
 * What is due today, what is due soon (the reminder day has arrived), and what is overdue, for one
 * app. Always available: it needs no notification permission and no network.
 */
export function useDueToday(spec: SpecView, appId: string): DueToday {
  const { config, records, loaded } = useReminderData(appId);
  const now = useNow();
  const due = useMemo(() => computeDue({ spec, records, config, now }), [spec, records, config, now]);
  return { ...due, count: due.today.length + due.soon.length + due.overdue.length, loaded };
}

const UNSUPPORTED: NotificationCapability = { supported: false, permission: 'unsupported', canAskAgain: false, delivery: 'none' };

/** Notification permission state, with a way to ask and a way to open system settings. */
export function useNotificationCapability() {
  const [capability, setCapability] = useState<NotificationCapability | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setCapability(await getNotificationAdapter().capability());
    } catch {
      setCapability(UNSUPPORTED);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // The person may change the permission in system settings, then come back.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  /** Shows the system prompt. Call only from a button press, after explaining why. */
  const request = useCallback(async () => {
    try {
      const next = await getNotificationAdapter().requestPermission();
      setCapability(next);
      return next;
    } catch {
      setCapability(UNSUPPORTED);
      return UNSUPPORTED;
    }
  }, []);

  const openSettings = useMemo(() => {
    const adapter = getNotificationAdapter();
    return adapter.openSettings ? () => adapter.openSettings?.().catch(() => undefined) : undefined;
  }, []);

  return { capability, request, refresh, openSettings };
}

/**
 * Keeps the device's reminders for one app up to date. Mount it once where an app is open: it
 * syncs on mount, when records or reminder settings change (debounced), and when the app returns
 * to the foreground (which also re-arms web timers and picks up a changed time zone).
 */
export function useReminderSync(appId: string | undefined): void {
  useEffect(() => {
    if (!appId) return;
    const { db } = getServices();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = (delay: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void syncReminders(appId), delay);
    };
    run(0);
    const offRecords = db.records.subscribe(appId, () => run(400));
    const offState = db.state.subscribe(appId, () => run(400));
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run(0);
    });
    return () => {
      if (timer) clearTimeout(timer);
      offRecords();
      offState();
      sub.remove();
    };
  }, [appId]);
}

/**
 * Mount once in the root layout. Syncs every app on launch and when Kalam returns to the
 * foreground, and removes notifications left by apps that were deleted.
 */
export function useReminderBootstrap(): void {
  useEffect(() => {
    const run = () => void syncAllReminders().catch(() => undefined);
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => sub.remove();
  }, []);
}
