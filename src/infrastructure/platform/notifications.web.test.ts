import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebNotificationAdapter } from './notifications.web';
import type { LocalNotification } from './notifications.shared';

const DAY = 86_400_000;

interface Shown { title: string; options?: NotificationOptions }
let shown: Shown[];

function installNotification(permission: NotificationPermission) {
  shown = [];
  class FakeNotification {
    static permission: NotificationPermission = permission;
    static requestPermission = vi.fn(async () => {
      FakeNotification.permission = 'granted';
      return 'granted' as NotificationPermission;
    });
    constructor(title: string, options?: NotificationOptions) {
      shown.push({ title, options });
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
  return FakeNotification;
}

const note = (over: Partial<LocalNotification> = {}): LocalNotification => ({
  id: 'kalam.app_a.r1.b1', appId: 'app_a', title: 'Bills', body: 'Rent is due tomorrow.', fireAt: Date.now() + 60_000, hash: 'h1', ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T00:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('web notification adapter', () => {
  it('reports unsupported when the browser has no Notification API', async () => {
    vi.stubGlobal('Notification', undefined);
    const a = createWebNotificationAdapter();
    expect(await a.capability()).toEqual({ supported: false, permission: 'unsupported', canAskAgain: false, delivery: 'none' });
    expect(await a.requestPermission()).toMatchObject({ supported: false });
    await a.schedule(note());
    expect(await a.listScheduled()).toEqual([]);
  });

  it('reports unsupported outside a secure context', async () => {
    installNotification('granted');
    vi.stubGlobal('isSecureContext', false);
    expect((await createWebNotificationAdapter().capability()).supported).toBe(false);
  });

  it('maps the browser permission and says reminders only appear while the page is open', async () => {
    installNotification('default');
    expect(await createWebNotificationAdapter().capability()).toEqual({ supported: true, permission: 'undetermined', canAskAgain: true, delivery: 'while_open' });
    installNotification('denied');
    expect(await createWebNotificationAdapter().capability()).toMatchObject({ permission: 'denied', canAskAgain: false });
    installNotification('granted');
    expect(await createWebNotificationAdapter().capability()).toMatchObject({ permission: 'granted' });
  });

  it('asks for permission only when it is still undecided', async () => {
    const N = installNotification('default');
    const a = createWebNotificationAdapter();
    expect(await a.requestPermission()).toMatchObject({ permission: 'granted' });
    expect(N.requestPermission).toHaveBeenCalledTimes(1);
    await a.requestPermission();
    expect(N.requestPermission).toHaveBeenCalledTimes(1);

    const denied = installNotification('denied');
    expect(await createWebNotificationAdapter().requestPermission()).toMatchObject({ permission: 'denied' });
    expect(denied.requestPermission).not.toHaveBeenCalled();
  });

  it('shows the notification at the scheduled time, once, and then forgets it', async () => {
    installNotification('granted');
    const a = createWebNotificationAdapter();
    await a.schedule(note());
    expect(await a.listScheduled()).toEqual([{ id: 'kalam.app_a.r1.b1', hash: 'h1', fireAt: Date.now() + 60_000 }]);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(shown).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ title: 'Bills', options: { body: 'Rent is due tomorrow.', tag: 'kalam.app_a.r1.b1' } });
    expect(await a.listScheduled()).toEqual([]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(shown).toHaveLength(1);
  });

  it('replaces a notification scheduled again with the same id instead of duplicating it', async () => {
    installNotification('granted');
    const a = createWebNotificationAdapter();
    await a.schedule(note({ body: 'Old text', hash: 'old' }));
    await a.schedule(note({ body: 'New text', hash: 'new', fireAt: Date.now() + 120_000 }));
    expect(await a.listScheduled()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(shown).toHaveLength(1);
    expect(shown[0].options?.body).toBe('New text');
  });

  it('does not show a cancelled notification', async () => {
    installNotification('granted');
    const a = createWebNotificationAdapter();
    await a.schedule(note());
    await a.cancel(['kalam.app_a.r1.b1']);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(shown).toHaveLength(0);
    expect(await a.listScheduled()).toEqual([]);
  });

  it('does not show anything if permission was taken away in the meantime', async () => {
    const N = installNotification('granted');
    const a = createWebNotificationAdapter();
    await a.schedule(note());
    N.permission = 'denied';
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(shown).toHaveLength(0);
  });

  it('ignores a time that has already passed', async () => {
    installNotification('granted');
    const a = createWebNotificationAdapter();
    await a.schedule(note({ fireAt: Date.now() - 1000 }));
    expect(await a.listScheduled()).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(shown).toHaveLength(0);
  });

  it('handles reminders further away than one browser timer can wait', async () => {
    installNotification('granted');
    const a = createWebNotificationAdapter();
    await a.schedule(note({ fireAt: Date.now() + 40 * DAY }));
    await vi.advanceTimersByTimeAsync(39 * DAY);
    expect(shown).toHaveLength(0);
    expect(await a.listScheduled()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1.1 * DAY);
    expect(shown).toHaveLength(1);
  });
});
