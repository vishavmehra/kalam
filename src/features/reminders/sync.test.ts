import { describe, expect, it } from 'vitest';

import type { StoredApp } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { idSchema } from '@/core/spec/schema';
import type {
  LocalNotification, NotificationAdapter, NotificationCapability, ScheduledNotificationRef,
} from '@/infrastructure/platform/notifications.shared';
import { createWebDatabase } from '@/infrastructure/storage/database.web';

import {
  REMINDERS_STATE_KEY, loadReminderConfig, parseReminderConfig, saveReminderConfig, serializeReminderConfig,
} from './config';
import { createSyncRunner, syncRemindersWith, type SyncDeps } from './sync';
import type { ReminderConfig, ReminderRule } from './types';
import { ianaZone } from './zone';

const KOLKATA = ianaZone('Asia/Kolkata');
const NOW = Date.UTC(2026, 10, 20, 0, 0);

const rule = (over: Partial<ReminderRule> = {}): ReminderRule => ({
  id: 'r1', enabled: true, collection: 'bills', dateField: 'due', leadDays: 1, timeOfDay: '09:00',
  condition: { field: 'paid', op: 'is_false' }, ...over,
});
const cfg = (...rules: ReminderRule[]): ReminderConfig => ({ version: 1, rules });

/** A device: remembers what is scheduled, like the OS (native) or the page timers (web). */
function fakeDevice(permission: NotificationCapability['permission'] = 'granted') {
  const scheduled = new Map<string, LocalNotification>();
  const log: string[] = [];
  let capability: NotificationCapability = {
    supported: permission !== 'unsupported', permission, canAskAgain: permission === 'undetermined', delivery: 'system',
  };
  let failOn: string | undefined;
  const adapter: NotificationAdapter = {
    capability: async () => capability,
    requestPermission: async () => capability,
    listScheduled: async (): Promise<ScheduledNotificationRef[]> =>
      [...scheduled.values()].map((n) => ({ id: n.id, hash: n.hash, fireAt: n.fireAt })),
    schedule: async (n) => {
      if (failOn === n.id) throw new Error('boom');
      log.push(`schedule ${n.id}`);
      scheduled.set(n.id, n);
    },
    cancel: async (ids) => {
      for (const id of ids) {
        log.push(`cancel ${id}`);
        scheduled.delete(id);
      }
    },
  };
  return {
    adapter, scheduled, log,
    setPermission(p: NotificationCapability['permission']) { capability = { ...capability, permission: p }; },
    failOn(id: string | undefined) { failOn = id; },
  };
}

const billsSpec = (id: string): KalamSpec => ({
  id, schemaVersion: '1.0.0', version: 1, name: 'Bills', lang: 'en',
  theme: { primary: '#315C4C', radius: 12, fontScale: 1 },
  collections: {
    bills: {
      label: 'Bills',
      fields: {
        title: { type: 'text', label: 'Bill', required: true, maxLength: 60 },
        due: { type: 'date', label: 'Due date' },
        paid: { type: 'boolean', label: 'Paid' },
      },
    },
  },
  screens: [{ id: 'home', title: 'Bills', form: 'bills', children: [
    { id: 'title_input', type: 'textInput', label: 'Bill', field: 'title' },
    { id: 'save', type: 'bigButton', label: 'Save', action: 'add_bill' },
    { id: 'all', type: 'list', source: 'bills', primary: 'title', secondary: 'due' },
  ] }],
  initialScreen: 'home',
  actions: { add_bill: { type: 'insert', collection: 'bills' } },
  aiBlocks: {},
  intents: {},
  meta: { createdAt: 1 },
});
const storedApp = (spec: KalamSpec): StoredApp => ({ id: spec.id, spec, createdAt: 1, updatedAt: 1, origin: { route: 'template' } });

let dbCounter = 0;
async function setup(permission: NotificationCapability['permission'] = 'granted') {
  const db = createWebDatabase(`kalam-reminders-test-${++dbCounter}-${Date.now()}`);
  const appId = 'app_bills';
  await db.apps.save(storedApp(billsSpec(appId)), { summary: 'Created', source: 'create' });
  const device = fakeDevice(permission);
  const deps: SyncDeps = {
    adapter: device.adapter,
    loadApp: (id) => db.apps.get(id),
    loadRecords: (id) => db.records.listAll(id),
    loadConfig: (id) => loadReminderConfig(db.state, id),
    now: () => NOW,
    zone: KOLKATA,
  };
  const bill = (title: string, due: string, paid = false) => db.records.insert(appId, 'bills', { title, due, paid });
  return { db, appId, device, deps, bill };
}

describe('reminder settings storage', () => {
  const valid = cfg(rule({ message: 'Pay {title}' }));

  it('uses a state key the database accepts', () => {
    expect(idSchema.safeParse(REMINDERS_STATE_KEY).success).toBe(true);
  });

  it('round-trips valid settings', () => {
    expect(parseReminderConfig(serializeReminderConfig(valid))).toEqual(valid);
  });

  it('ignores anything that is not valid settings', () => {
    expect(parseReminderConfig(undefined)).toBeUndefined();
    expect(parseReminderConfig(null)).toBeUndefined();
    expect(parseReminderConfig(5)).toBeUndefined();
    expect(parseReminderConfig('')).toBeUndefined();
    expect(parseReminderConfig('{nope')).toBeUndefined();
    expect(parseReminderConfig(JSON.stringify({ version: 2, rules: [] }))).toBeUndefined();
    expect(parseReminderConfig(JSON.stringify({ version: 1, rules: [], extra: 1 }))).toBeUndefined();
    expect(parseReminderConfig(JSON.stringify({ version: 1, rules: [{ ...rule(), timeOfDay: '25:00' }] }))).toBeUndefined();
    expect(parseReminderConfig(JSON.stringify({ version: 1, rules: [{ ...rule(), leadDays: 31 }] }))).toBeUndefined();
    expect(parseReminderConfig(JSON.stringify({ version: 1, rules: [{ ...rule(), leadDays: 1.5 }] }))).toBeUndefined();
    expect(parseReminderConfig(JSON.stringify({ version: 1, rules: [{ ...rule(), script: 'alert(1)' }] }))).toBeUndefined();
    expect(parseReminderConfig(JSON.stringify({ version: 1, rules: [{ ...rule(), dateField: 'Bad Id' }] }))).toBeUndefined();
  });

  it('allows at most 4 rules with unique ids', () => {
    const five = cfg(...[1, 2, 3, 4, 5].map((n) => rule({ id: `r${n}` })));
    expect(() => serializeReminderConfig(five)).toThrow('not valid');
    expect(() => serializeReminderConfig(cfg(rule(), rule()))).toThrow('not valid');
    const four = cfg(...[1, 2, 3, 4].map((n) => rule({ id: `r${n}`, message: 'x'.repeat(120) })));
    expect(serializeReminderConfig(four).length).toBeLessThan(5000);
  });

  it('rejects a message over 120 characters', () => {
    expect(() => serializeReminderConfig(cfg(rule({ message: 'x'.repeat(121) })))).toThrow('not valid');
  });

  it('saves and loads through the real app database, per app', async () => {
    const { db, appId } = await setup();
    expect(await loadReminderConfig(db.state, appId)).toBeUndefined();
    await saveReminderConfig(db.state, appId, valid);
    expect(await loadReminderConfig(db.state, appId)).toEqual(valid);
    await saveReminderConfig(db.state, appId, cfg());
    expect(await loadReminderConfig(db.state, appId)).toEqual(cfg());
  });

  it('survives a backup and restore', async () => {
    const { db, appId } = await setup();
    await saveReminderConfig(db.state, appId, valid);
    const backup = await db.exportAll();
    const other = createWebDatabase(`kalam-reminders-restore-${++dbCounter}-${Date.now()}`);
    await other.importAll(backup);
    expect(await loadReminderConfig(other.state, appId)).toEqual(valid);
  });

  it('ignores a counter or other value that overwrote the key', async () => {
    const { db, appId } = await setup();
    await db.state.set(appId, REMINDERS_STATE_KEY, 7);
    expect(await loadReminderConfig(db.state, appId)).toBeUndefined();
  });
});

describe('syncRemindersWith', () => {
  it('schedules reminders from the real database and settings', async () => {
    const { db, appId, device, deps, bill } = await setup();
    await bill('Rent', '2026-12-10');
    await bill('Gas', '2026-12-12');
    await saveReminderConfig(db.state, appId, cfg(rule()));
    const result = await syncRemindersWith(deps, appId);
    expect(result).toMatchObject({ status: 'synced', scheduled: 2, cancelled: 0, failed: 0 });
    expect([...device.scheduled.values()].map((n) => n.body).sort()).toEqual(['Gas is due tomorrow.', 'Rent is due tomorrow.']);
  });

  it('creates no duplicates when the app restarts and syncs again', async () => {
    const { db, appId, device, deps, bill } = await setup();
    await bill('Rent', '2026-12-10');
    await saveReminderConfig(db.state, appId, cfg(rule()));
    await syncRemindersWith(deps, appId);
    const callsAfterFirst = device.log.length;
    // A fresh runner (new process) over the same device state.
    const again = await syncRemindersWith({ ...deps }, appId);
    expect(again).toMatchObject({ status: 'synced', scheduled: 0, cancelled: 0, unchanged: 1 });
    expect(device.log.length).toBe(callsAfterFirst);
    expect(device.scheduled.size).toBe(1);
  });

  it('cancels when an item is marked done or deleted, and reschedules when its date moves', async () => {
    const { db, appId, device, deps, bill } = await setup();
    const rent = await bill('Rent', '2026-12-10');
    const gas = await bill('Gas', '2026-12-12');
    await saveReminderConfig(db.state, appId, cfg(rule()));
    await syncRemindersWith(deps, appId);

    await db.records.update(appId, 'bills', rent.id, { title: 'Rent', due: '2026-12-10', paid: true });
    expect(await syncRemindersWith(deps, appId)).toMatchObject({ cancelled: 1, scheduled: 0 });
    expect(device.scheduled.has(`kalam.${appId}.r1.${rent.id}`)).toBe(false);

    const before = device.scheduled.get(`kalam.${appId}.r1.${gas.id}`)!.fireAt;
    await db.records.update(appId, 'bills', gas.id, { title: 'Gas', due: '2026-12-15', paid: false });
    expect(await syncRemindersWith(deps, appId)).toMatchObject({ scheduled: 1, cancelled: 0 });
    expect(device.scheduled.get(`kalam.${appId}.r1.${gas.id}`)!.fireAt).toBeGreaterThan(before);

    await db.records.remove(appId, 'bills', gas.id);
    expect(await syncRemindersWith(deps, appId)).toMatchObject({ cancelled: 1 });
    expect(device.scheduled.size).toBe(0);
  });

  it('disabled reminders do not fire: turning a rule off removes its notifications', async () => {
    const { db, appId, device, deps, bill } = await setup();
    await bill('Rent', '2026-12-10');
    await saveReminderConfig(db.state, appId, cfg(rule()));
    await syncRemindersWith(deps, appId);
    expect(device.scheduled.size).toBe(1);
    await saveReminderConfig(db.state, appId, cfg(rule({ enabled: false })));
    expect(await syncRemindersWith(deps, appId)).toMatchObject({ cancelled: 1 });
    expect(device.scheduled.size).toBe(0);
  });

  it('with permission denied it schedules nothing and does not throw', async () => {
    const { db, appId, device, deps, bill } = await setup('denied');
    await bill('Rent', '2026-12-10');
    await saveReminderConfig(db.state, appId, cfg(rule()));
    expect(await syncRemindersWith(deps, appId)).toMatchObject({ status: 'no_permission', scheduled: 0 });
    expect(device.scheduled.size).toBe(0);
  });

  it('removes stale notifications when permission is lost', async () => {
    const { db, appId, device, deps, bill } = await setup();
    await bill('Rent', '2026-12-10');
    await saveReminderConfig(db.state, appId, cfg(rule()));
    await syncRemindersWith(deps, appId);
    device.setPermission('denied');
    await saveReminderConfig(db.state, appId, cfg());
    expect(await syncRemindersWith(deps, appId)).toMatchObject({ status: 'no_permission', cancelled: 1 });
    expect(device.scheduled.size).toBe(0);
  });

  it('does not read the app or its records when no reminder is switched on', async () => {
    const { db, appId, deps } = await setup();
    let reads = 0;
    const counting = {
      ...deps,
      loadApp: async (id: string) => { reads++; return deps.loadApp(id); },
      loadRecords: async (id: string) => { reads++; return deps.loadRecords(id); },
    };
    await syncRemindersWith(counting, appId);
    await saveReminderConfig(db.state, appId, cfg(rule({ enabled: false })));
    await syncRemindersWith(counting, appId);
    expect(reads).toBe(0);
  });

  it('reports unsupported platforms without doing anything', async () => {
    const { appId, device, deps } = await setup('unsupported');
    expect(await syncRemindersWith(deps, appId)).toMatchObject({ status: 'unsupported', scheduled: 0 });
    expect(device.log).toEqual([]);
  });

  it('counts a failed schedule and still schedules the rest', async () => {
    const { db, appId, device, deps, bill } = await setup();
    const a = await bill('A', '2026-12-10');
    await bill('B', '2026-12-11');
    await saveReminderConfig(db.state, appId, cfg(rule()));
    device.failOn(`kalam.${appId}.r1.${a.id}`);
    expect(await syncRemindersWith(deps, appId)).toMatchObject({ status: 'synced', scheduled: 1, failed: 1 });
    expect(device.scheduled.size).toBe(1);
  });

  it('never throws, even when storage fails', async () => {
    const { db, appId, deps } = await setup();
    await saveReminderConfig(db.state, appId, cfg(rule()));
    const result = await syncRemindersWith({ ...deps, loadRecords: async () => { throw new Error('disk'); } }, appId);
    expect(result.status).toBe('error');
    expect(result.message).toBe('disk');
  });

  it('cancels everything for an app that was deleted', async () => {
    const { db, appId, device, deps, bill } = await setup();
    await bill('Rent', '2026-12-10');
    await saveReminderConfig(db.state, appId, cfg(rule()));
    await syncRemindersWith(deps, appId);
    await db.apps.remove(appId);
    expect(await syncRemindersWith(deps, appId)).toMatchObject({ status: 'synced', cancelled: 1 });
    expect(device.scheduled.size).toBe(0);
  });

  it('a changed time zone reschedules on the next sync', async () => {
    const { db, appId, device, deps, bill } = await setup();
    await bill('Rent', '2026-12-10');
    await saveReminderConfig(db.state, appId, cfg(rule()));
    await syncRemindersWith(deps, appId);
    const home = [...device.scheduled.values()][0].fireAt;
    const away = await syncRemindersWith({ ...deps, zone: ianaZone('America/New_York') }, appId);
    expect(away).toMatchObject({ scheduled: 1, cancelled: 0 });
    expect([...device.scheduled.values()][0].fireAt).not.toBe(home);
  });
});

describe('createSyncRunner', () => {
  it('merges overlapping calls for one app into a single follow-up run', async () => {
    const { db, appId, deps, bill } = await setup();
    await bill('Rent', '2026-12-10');
    await saveReminderConfig(db.state, appId, cfg(rule()));
    let loads = 0;
    const runner = createSyncRunner({ ...deps, loadRecords: async (id) => { loads++; return deps.loadRecords(id); } });
    const results = await Promise.all([runner.sync(appId), runner.sync(appId), runner.sync(appId)]);
    expect(loads).toBeLessThanOrEqual(2);
    expect(results[0]).toBe(results[1]);
    expect(results.every((r) => r.status === 'synced')).toBe(true);
  });

  it('keeps different apps independent and cleans up notifications left by deleted apps', async () => {
    const { db, appId, device, deps, bill } = await setup();
    await bill('Rent', '2026-12-10');
    await saveReminderConfig(db.state, appId, cfg(rule()));
    device.scheduled.set('kalam.app_gone.r1.x', {
      id: 'kalam.app_gone.r1.x', appId: 'app_gone', title: 'Old', body: 'Old', fireAt: NOW + 1000, hash: 'h',
    });
    const runner = createSyncRunner(deps);
    const results = await runner.syncAll([appId]);
    expect(results).toHaveLength(1);
    expect([...device.scheduled.keys()].sort()).toEqual([expect.stringContaining(`kalam.${appId}.r1.`)]);
  });
});
