import { describe, expect, it } from 'vitest';

import type { ScheduledNotificationRef } from '@/infrastructure/platform/notifications.shared';

import {
  appNotificationPrefix, computeDue, computePlan, diffSchedule, fingerprint, notificationId, parseNotificationId,
  reminderText,
} from './scheduler';
import { REMINDER_LIMITS, type ReminderConfig, type ReminderRule, type SpecView } from './types';
import {
  addDays, daysBetween, ianaZone, localZone, parseDateOnly, parseTimeOfDay, todayParts,
} from './zone';

const spec: SpecView = {
  name: 'Bills',
  collections: {
    bills: {
      label: 'Bills',
      fields: {
        title: { type: 'text', label: 'Bill', required: true },
        due: { type: 'date', label: 'Due date' },
        paid: { type: 'boolean', label: 'Paid' },
        status: { type: 'enum', label: 'Status', options: ['Open', 'Disputed'] },
      },
    },
  },
};

const rule = (over: Partial<ReminderRule> = {}): ReminderRule => ({
  id: 'r1', enabled: true, collection: 'bills', dateField: 'due', leadDays: 1, timeOfDay: '09:00', ...over,
});
const cfg = (...rules: ReminderRule[]): ReminderConfig => ({ version: 1, rules });
const rec = (id: string, values: Record<string, string | number | boolean | null>) => ({ id, values });

const KOLKATA = ianaZone('Asia/Kolkata');
const NEW_YORK = ianaZone('America/New_York');
const NOW = Date.UTC(2026, 10, 20, 0, 0); // 20 Nov 2026 00:00 UTC

const plan = (over: Partial<Parameters<typeof computePlan>[0]> & { records: Parameters<typeof computePlan>[0]['records'] }) =>
  computePlan({ appId: 'app_bills', spec, config: cfg(rule()), now: NOW, zone: KOLKATA, ...over });

describe('zone helpers', () => {
  it('converts wall-clock time in a fixed-offset zone', () => {
    // 09:00 IST (UTC+5:30) is 03:30 UTC.
    expect(KOLKATA.toEpoch({ year: 2026, month: 12, day: 9, hour: 9, minute: 0 })).toBe(Date.UTC(2026, 11, 9, 3, 30));
  });

  it('round-trips epoch to wall clock', () => {
    const e = Date.UTC(2026, 6, 1, 12, 15);
    expect(NEW_YORK.toWallClock(e)).toEqual({ year: 2026, month: 7, day: 1, hour: 8, minute: 15 });
  });

  it('moves a time skipped by daylight saving forward and takes the first of a repeated time', () => {
    // US spring forward: 2026-03-08 02:30 does not exist. It becomes 03:30 EDT = 07:30 UTC.
    expect(NEW_YORK.toEpoch({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 })).toBe(Date.UTC(2026, 2, 8, 7, 30));
    // US fall back: 2026-11-01 01:30 happens twice. The first one is EDT = 05:30 UTC.
    expect(NEW_YORK.toEpoch({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 })).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });

  it('local zone agrees with the platform Date for a normal time', () => {
    const w = { year: 2026, month: 5, day: 4, hour: 17, minute: 45 };
    expect(localZone.toEpoch(w)).toBe(new Date(2026, 4, 4, 17, 45).getTime());
    expect(localZone.toWallClock(localZone.toEpoch(w))).toEqual(w);
  });

  it('parses dates and times strictly', () => {
    expect(parseDateOnly('2026-02-28')).toEqual({ year: 2026, month: 2, day: 28 });
    expect(parseDateOnly('2026-02-30')).toBeUndefined();
    expect(parseDateOnly('26-02-28')).toBeUndefined();
    expect(parseDateOnly('1850-01-01')).toBeUndefined();
    expect(parseDateOnly(20260228)).toBeUndefined();
    expect(parseTimeOfDay('09:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseTimeOfDay('24:00')).toBeUndefined();
    expect(parseTimeOfDay('9:00')).toBeUndefined();
  });

  it('does calendar arithmetic across months and years', () => {
    expect(addDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({ year: 2026, month: 2, day: 28 });
    expect(addDays({ year: 2026, month: 1, day: 2 }, -3)).toEqual({ year: 2025, month: 12, day: 30 });
    expect(daysBetween({ year: 2026, month: 3, day: 7 }, { year: 2026, month: 3, day: 9 })).toBe(2);
  });
});

describe('computePlan', () => {
  it('schedules at the lead time and time of day in the local zone', () => {
    const r = plan({ records: { bills: [rec('b1', { title: 'Rent', due: '2026-12-10', paid: false })] } });
    expect(r.desired).toHaveLength(1);
    // Due 10 Dec, 1 day before at 09:00 IST = 9 Dec 03:30 UTC.
    expect(r.desired[0].fireAt).toBe(Date.UTC(2026, 11, 9, 3, 30));
    expect(r.desired[0].id).toBe('kalam.app_bills.r1.b1');
    expect(r.desired[0].title).toBe('Bills');
    expect(r.desired[0].body).toBe('Rent is due tomorrow.');
    expect(r.desired[0].dueDate).toBe('2026-12-10');
  });

  it('lead time 0 notifies on the day itself', () => {
    const r = plan({ config: cfg(rule({ leadDays: 0, timeOfDay: '18:30' })), records: { bills: [rec('b1', { title: 'Gas', due: '2026-12-10' })] } });
    expect(r.desired[0].fireAt).toBe(Date.UTC(2026, 11, 10, 13, 0));
    expect(r.desired[0].body).toBe('Gas is due today.');
  });

  it('skips records whose reminder time has passed, including exactly now', () => {
    const exact = KOLKATA.toEpoch({ year: 2026, month: 11, day: 21, hour: 9, minute: 0 });
    const r = computePlan({
      appId: 'app_bills', spec, config: cfg(rule()), zone: KOLKATA, now: exact,
      records: { bills: [rec('late', { title: 'A', due: '2026-11-22' }), rec('ok', { title: 'B', due: '2026-11-23' })] },
    });
    expect(r.desired.map((n) => n.recordId)).toEqual(['ok']);
    expect(r.stats.past).toBe(1);
  });

  it('skips items that are done (condition: not done), and treats a missing value as not done', () => {
    const c = cfg(rule({ condition: { field: 'paid', op: 'is_false' } }));
    const r = plan({
      config: c,
      records: { bills: [rec('a', { title: 'A', due: '2026-12-10', paid: true }), rec('b', { title: 'B', due: '2026-12-10', paid: false }), rec('c', { title: 'C', due: '2026-12-10', paid: null }), rec('d', { title: 'D', due: '2026-12-10' })] },
    });
    expect(r.desired.map((n) => n.recordId).sort()).toEqual(['b', 'c', 'd']);
    expect(r.stats.conditionFailed).toBe(1);
  });

  it('supports is_true, equals and not_equals conditions', () => {
    const records = { bills: [rec('a', { title: 'A', due: '2026-12-10', paid: true, status: 'Open' }), rec('b', { title: 'B', due: '2026-12-10', paid: false, status: 'Disputed' })] };
    const ids = (condition: ReminderRule['condition']) => plan({ config: cfg(rule({ condition })), records }).desired.map((n) => n.recordId);
    expect(ids({ field: 'paid', op: 'is_true' })).toEqual(['a']);
    expect(ids({ field: 'status', op: 'equals', value: 'Disputed' })).toEqual(['b']);
    expect(ids({ field: 'status', op: 'not_equals', value: 'Disputed' })).toEqual(['a']);
  });

  it('skips missing, empty and impossible dates', () => {
    const r = plan({
      records: {
        bills: [
          rec('n', { title: 'N', due: null }), rec('e', { title: 'E', due: '' }), rec('x', { title: 'X', due: '2026-02-30' }),
          rec('w', { title: 'W', due: 'tomorrow' }), rec('z', { title: 'Z' }), rec('ok', { title: 'OK', due: '2026-12-10' }),
        ],
      },
    });
    expect(r.desired.map((n) => n.recordId)).toEqual(['ok']);
    expect(r.stats.noDate).toBe(5);
  });

  it('does nothing for disabled rules or with no settings', () => {
    const records = { bills: [rec('a', { title: 'A', due: '2026-12-10' })] };
    expect(plan({ config: cfg(rule({ enabled: false })), records }).desired).toEqual([]);
    expect(plan({ config: undefined, records }).desired).toEqual([]);
    expect(plan({ config: cfg(), records }).desired).toEqual([]);
  });

  it('drops rules that no longer fit the design instead of guessing', () => {
    const records = { bills: [rec('a', { title: 'A', due: '2026-12-10' })] };
    const bad = [
      rule({ collection: 'orders' }),
      rule({ dateField: 'missing' }),
      rule({ dateField: 'title' }),
      rule({ condition: { field: 'gone', op: 'is_false' } }),
      rule({ condition: { field: 'title', op: 'is_false' } }),
    ];
    for (const r of bad) {
      const p = plan({ config: cfg(r), records });
      expect(p.desired).toEqual([]);
      expect(p.stats.invalidRules).toBe(1);
    }
  });

  it('keeps only the nearest reminders when over the per-app cap', () => {
    const bills = Array.from({ length: 30 }, (_, i) => {
      const d = addDays({ year: 2026, month: 11, day: 25 }, i);
      return rec(`b${String(i).padStart(2, '0')}`, { title: `Bill ${i}`, due: `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` });
    });
    const r = plan({ config: cfg(rule({ leadDays: 0 })), records: { bills: [...bills].reverse() } });
    expect(r.desired).toHaveLength(REMINDER_LIMITS.notificationsPerApp);
    expect(r.desired[0].recordId).toBe('b00');
    expect(r.desired.at(-1)?.recordId).toBe('b23');
    expect(r.stats.overCap).toBe(6);
    expect(r.upcoming).toHaveLength(30);
    expect(plan({ config: cfg(rule({ leadDays: 0 })), records: { bills }, cap: 5 }).desired).toHaveLength(5);
  });

  it('holds back reminders beyond the horizon but still lists them as upcoming', () => {
    const r = plan({ records: { bills: [rec('near', { title: 'Near', due: '2026-12-10' }), rec('far', { title: 'Far', due: '2027-06-01' })] } });
    expect(r.desired.map((n) => n.recordId)).toEqual(['near']);
    expect(r.upcoming.map((n) => n.recordId)).toEqual(['near', 'far']);
    expect(r.stats.beyondHorizon).toBe(1);
  });

  it('is deterministic and independent of record order', () => {
    const a = rec('a', { title: 'A', due: '2026-12-10' });
    const b = rec('b', { title: 'B', due: '2026-12-10' });
    const c = rec('c', { title: 'C', due: '2026-12-09' });
    const one = plan({ records: { bills: [a, b, c] } });
    const two = plan({ records: { bills: [c, b, a] } });
    expect(two).toEqual(one);
    expect(plan({ records: { bills: [a, b, c] } })).toEqual(one);
    expect(one.desired.map((n) => n.recordId)).toEqual(['c', 'a', 'b']);
  });

  it('gives each rule its own notification for the same record', () => {
    const r = plan({
      config: cfg(rule({ id: 'r1', leadDays: 1 }), rule({ id: 'r2', leadDays: 0, timeOfDay: '08:00' })),
      records: { bills: [rec('b1', { title: 'Rent', due: '2026-12-10' })] },
    });
    // r1 fires the day before at 09:00, r2 on the day at 08:00.
    expect(r.desired.map((n) => n.id)).toEqual(['kalam.app_bills.r1.b1', 'kalam.app_bills.r2.b1']);
    expect(r.desired[0].fireAt).toBeLessThan(r.desired[1].fireAt);
  });

  describe('time zones and daylight saving', () => {
    const records = { bills: [rec('b1', { title: 'Rent', due: '2026-12-10' })] };

    it('a different zone gives a different instant, so the diff reschedules after travel', () => {
      const home = plan({ records });
      const away = plan({ records, zone: ianaZone('Pacific/Auckland') });
      expect(home.desired[0].fireAt).not.toBe(away.desired[0].fireAt);
      // 9 Dec 09:00 NZDT (UTC+13) = 9 Dec 20:00 UTC the day before.
      expect(away.desired[0].fireAt).toBe(Date.UTC(2026, 11, 8, 20, 0));
      const ops = diffSchedule('app_bills', away.desired, home.desired.map((n) => ({ id: n.id, hash: n.hash })));
      expect(ops.schedule.map((n) => n.id)).toEqual(['kalam.app_bills.r1.b1']);
      expect(ops.cancel).toEqual([]);
    });

    it('keeps the wall-clock time across a daylight-saving change', () => {
      const jan = Date.UTC(2026, 0, 1);
      const at = (due: string, extra: Partial<ReminderRule> = {}) =>
        computePlan({
          appId: 'a_app', spec, config: cfg(rule(extra)), now: jan, zone: NEW_YORK, horizonDays: 400,
          records: { bills: [rec('b1', { title: 'X', due })] },
        }).desired[0].fireAt;
      // 9 Mar due, 1 day before: 8 Mar 09:00 EDT = 13:00 UTC (clocks already moved).
      expect(at('2026-03-09')).toBe(Date.UTC(2026, 2, 8, 13, 0));
      // 9 Mar due, 2 days before: 7 Mar 09:00 EST = 14:00 UTC.
      expect(at('2026-03-09', { leadDays: 2 })).toBe(Date.UTC(2026, 2, 7, 14, 0));
      // A time that does not exist that day moves forward rather than being lost.
      expect(at('2026-03-08', { leadDays: 0, timeOfDay: '02:30' })).toBe(Date.UTC(2026, 2, 8, 7, 30));
      // Fall back: 1 Nov 09:00 is EST (UTC-5) = 14:00 UTC.
      expect(at('2026-11-01', { leadDays: 0 })).toBe(Date.UTC(2026, 10, 1, 14, 0));
    });
  });
});

describe('notification ids and text', () => {
  it('builds and parses ids', () => {
    const id = notificationId('app_a-2', 'r1', 'rec_9-x');
    expect(id).toBe('kalam.app_a-2.r1.rec_9-x');
    expect(parseNotificationId(id)).toEqual({ appId: 'app_a-2', ruleId: 'r1', recordId: 'rec_9-x' });
    expect(parseNotificationId('other.thing')).toBeUndefined();
    expect(parseNotificationId('kalam.a.b')).toBeUndefined();
    expect(parseNotificationId('kalam.a..c')).toBeUndefined();
  });

  it('fingerprints change when anything that matters changes', () => {
    expect(fingerprint('1|a|b')).toBe(fingerprint('1|a|b'));
    expect(fingerprint('1|a|b')).not.toBe(fingerprint('2|a|b'));
    expect(fingerprint('1|a|b')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('phrases the lead time in plain words', () => {
    const body = (leadDays: number) => reminderText(spec, rule({ leadDays }), 'Rent').body;
    expect(body(0)).toBe('Rent is due today.');
    expect(body(1)).toBe('Rent is due tomorrow.');
    expect(body(3)).toBe('Rent is due in 3 days.');
    expect(body(7)).toBe('Rent is due in a week.');
    expect(reminderText(spec, rule(), undefined).body).toBe('Something is due tomorrow.');
  });

  it('uses the custom message and replaces {title}', () => {
    expect(reminderText(spec, rule({ message: 'Pay {title} now' }), 'Rent').body).toBe('Pay Rent now');
    expect(reminderText(spec, rule({ message: 'Check the list' }), 'Rent').body).toBe('Check the list');
    expect(reminderText(spec, rule({ message: '{title}' }), undefined).body).toBe('An item');
  });

  it('names the item from the title field, falling back to the first text field', () => {
    const records = { bills: [rec('b1', { title: '  Electricity  ', due: '2026-12-10' })] };
    expect(plan({ records }).desired[0].body).toBe('Electricity is due tomorrow.');
    expect(plan({ config: cfg(rule({ titleField: 'status' })), records }).desired[0].body).toBe('Electricity is due tomorrow.');
  });

  it("names an entry by a choice as its option and by a link as the linked entry's own name, never the stored id", () => {
    const linked: SpecView = {
      name: 'Dues',
      collections: {
        customers: { label: 'Customers', fields: { name: { type: 'text', label: 'Name', required: true }, village: { type: 'enum', label: 'Village', options: ['Rampur', 'Sonpur'] } } },
        dues: {
          label: 'Dues',
          fields: {
            customer: { type: 'text', label: 'Customer', required: true, ref: { collection: 'customers', onDelete: 'restrict' } },
            village: { type: 'enum', label: 'Village', options: ['Rampur', 'Sonpur'] },
            due: { type: 'date', label: 'Due date' },
          },
        },
      },
    };
    const records = {
      customers: [rec('c1', { name: '  Asha Rao ' })],
      dues: [rec('d1', { customer: 'c1', village: 'Rampur', due: '2026-12-10' }), rec('d2', { customer: 'gone', village: 'Sonpur', due: '2026-12-11' })],
    };
    const ruleFor = (titleField?: string) => rule({ collection: 'dues', ...(titleField ? { titleField } : {}) });
    const bodies = (titleField?: string) =>
      computePlan({ appId: 'a', spec: linked, records, config: cfg(ruleFor(titleField)), now: NOW, zone: KOLKATA }).desired.map((n) => n.body);
    // With no title field named, the link (the only text field) names the entry.
    expect(bodies()).toEqual(['Asha Rao is due tomorrow.', 'Sonpur is due tomorrow.']);
    // A link to a deleted entry falls back to the entry's choice instead of printing the id.
    expect(bodies('customer')).toEqual(['Asha Rao is due tomorrow.', 'Sonpur is due tomorrow.']);
    // A choice named as the title prints its option.
    expect(bodies('village')).toEqual(['Rampur is due tomorrow.', 'Sonpur is due tomorrow.']);
    // The Due list says the same.
    const due = computeDue({ spec: linked, records, config: cfg(ruleFor()), now: Date.UTC(2026, 11, 10, 3), zone: KOLKATA });
    expect(due.today.map((i) => i.title)).toEqual(['Asha Rao']);
    expect(JSON.stringify(plan({ records: { bills: [] } }))).not.toContain('c1');
  });

  it('never prints a drawn signature as a name', () => {
    const signed: SpecView = {
      name: 'Orders',
      collections: { orders: { label: 'Orders', fields: { sign: { type: 'text', label: 'Signature', required: true }, item: { type: 'text', label: 'Item' }, due: { type: 'date', label: 'Due' } } } },
    };
    const records = { orders: [rec('o1', { sign: 'sig1:00010002', item: 'Kurta', due: '2026-12-10' })] };
    const out = computePlan({ appId: 'a', spec: signed, records, config: cfg(rule({ collection: 'orders' })), now: NOW, zone: KOLKATA });
    expect(out.desired[0].body).toBe('Kurta is due tomorrow.');
  });

  it('keeps long text within notification limits', () => {
    const long = 'x'.repeat(200);
    expect(reminderText(spec, rule(), long).body.length).toBeLessThanOrEqual(140);
    expect(reminderText({ ...spec, name: long }, rule(), 'a').title.length).toBeLessThanOrEqual(60);
  });
});

describe('diffSchedule', () => {
  const records = { bills: [rec('a', { title: 'A', due: '2026-12-10' }), rec('b', { title: 'B', due: '2026-12-11' })] };
  const desired = plan({ records }).desired;
  const refs = (): ScheduledNotificationRef[] => desired.map((n) => ({ id: n.id, hash: n.hash, fireAt: n.fireAt }));

  it('schedules everything when nothing is scheduled', () => {
    const ops = diffSchedule('app_bills', desired, []);
    expect(ops.schedule).toHaveLength(2);
    expect(ops.cancel).toEqual([]);
    expect(ops.unchanged).toBe(0);
  });

  it('does nothing when the device already matches, so a restart creates no duplicates', () => {
    const ops = diffSchedule('app_bills', desired, refs());
    expect(ops).toEqual({ schedule: [], cancel: [], unchanged: 2 });
  });

  it('reschedules a notification whose date, time or text changed', () => {
    const moved = plan({ records: { bills: [rec('a', { title: 'A', due: '2026-12-12' }), records.bills[1]] } }).desired;
    const ops = diffSchedule('app_bills', moved, refs());
    expect(ops.schedule.map((n) => n.recordId)).toEqual(['a']);
    expect(ops.unchanged).toBe(1);
    const renamed = plan({ records: { bills: [rec('a', { title: 'A2', due: '2026-12-10' }), records.bills[1]] } }).desired;
    expect(diffSchedule('app_bills', renamed, refs()).schedule.map((n) => n.recordId)).toEqual(['a']);
  });

  it('cancels notifications that should no longer exist (done, deleted, disabled)', () => {
    const done = plan({ config: cfg(rule({ condition: { field: 'paid', op: 'is_false' } })), records: { bills: [rec('a', { title: 'A', due: '2026-12-10', paid: true }), records.bills[1]] } }).desired;
    expect(diffSchedule('app_bills', done, refs()).cancel).toEqual(['kalam.app_bills.r1.a']);
    expect(diffSchedule('app_bills', [], refs()).cancel).toEqual(['kalam.app_bills.r1.a', 'kalam.app_bills.r1.b']);
  });

  it('never touches another app, even one whose id starts the same way', () => {
    const others: ScheduledNotificationRef[] = [
      { id: 'kalam.app_bills-2.r1.z', hash: 'x' },
      { id: 'kalam.app_other.r1.z', hash: 'x' },
      { id: 'something.else', hash: 'x' },
    ];
    const ops = diffSchedule('app_bills', desired, [...refs(), ...others]);
    expect(ops.cancel).toEqual([]);
    expect(appNotificationPrefix('app_bills')).toBe('kalam.app_bills.');
  });

  it('replaces a scheduled notification that has no fingerprint', () => {
    const ops = diffSchedule('app_bills', desired, desired.map((n) => ({ id: n.id })));
    expect(ops.schedule).toHaveLength(2);
  });

  it('applying the operations makes the next diff empty', () => {
    const state = new Map<string, ScheduledNotificationRef>([['kalam.app_bills.r1.old', { id: 'kalam.app_bills.r1.old', hash: 'h' }]]);
    const first = diffSchedule('app_bills', desired, [...state.values()]);
    for (const id of first.cancel) state.delete(id);
    for (const n of first.schedule) state.set(n.id, { id: n.id, hash: n.hash });
    expect(diffSchedule('app_bills', desired, [...state.values()])).toEqual({ schedule: [], cancel: [], unchanged: 2 });
  });
});

describe('computeDue', () => {
  // 20 Nov 2026 10:00 IST
  const now = KOLKATA.toEpoch({ year: 2026, month: 11, day: 20, hour: 10, minute: 0 });
  const records = {
    bills: [
      rec('today', { title: 'Gas', due: '2026-11-20', paid: false }),
      rec('tomorrow', { title: 'Phone', due: '2026-11-21', paid: false }),
      rec('later', { title: 'Rent', due: '2026-11-25', paid: false }),
      rec('late', { title: 'Water', due: '2026-11-18', paid: false }),
      rec('paid', { title: 'Net', due: '2026-11-20', paid: true }),
      rec('nodate', { title: 'Misc', due: null }),
    ],
  };
  const config = cfg(rule({ condition: { field: 'paid', op: 'is_false' } }));
  const due = (over: Partial<Parameters<typeof computeDue>[0]> = {}) => computeDue({ spec, records, config, now, zone: KOLKATA, ...over });

  it('sorts items into today, soon and overdue, skipping done and undated ones', () => {
    const r = due();
    expect(r.today.map((i) => i.id)).toEqual(['today']);
    expect(r.soon.map((i) => i.id)).toEqual(['tomorrow']);
    expect(r.overdue.map((i) => i.id)).toEqual(['late']);
    expect(r.overdue[0].daysFromToday).toBe(-2);
    expect(r.today[0].title).toBe('Gas');
  });

  it('with a lead time of 0 nothing is "soon"', () => {
    expect(due({ config: cfg(rule({ leadDays: 0, condition: { field: 'paid', op: 'is_false' } })) }).soon).toEqual([]);
  });

  it('uses the device zone for what "today" means', () => {
    const justAfterMidnightIst = Date.UTC(2026, 10, 19, 20, 0); // 20 Nov 01:30 IST, still 19 Nov in UTC
    expect(due({ now: justAfterMidnightIst }).today.map((i) => i.id)).toEqual(['today']);
    expect(due({ now: justAfterMidnightIst, zone: ianaZone('UTC') }).today).toEqual([]);
    expect(todayParts(justAfterMidnightIst, KOLKATA).day).toBe(20);
  });

  it('guesses a sensible rule when no settings were ever saved, but not once they were', () => {
    expect(due({ config: undefined }).today.map((i) => i.id)).toEqual(['today']);
    expect(due({ config: undefined, implicit: false }).today).toEqual([]);
    expect(due({ config: cfg() })).toEqual({ today: [], soon: [], overdue: [] });
    expect(due({ config: cfg(rule({ enabled: false })) })).toEqual({ today: [], soon: [], overdue: [] });
  });

  it('lists an item once even when two rules match it', () => {
    const r = due({ config: cfg(rule({ id: 'r1' }), rule({ id: 'r2', leadDays: 3 })) });
    const ids = [...r.today, ...r.soon, ...r.overdue].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('caps the overdue list, most overdue first', () => {
    const many = Array.from({ length: 30 }, (_, i) => rec(`o${i}`, { title: `T${i}`, due: `2026-10-${String(i + 1).padStart(2, '0')}` }));
    const r = due({ records: { bills: many }, config: cfg(rule()) });
    expect(r.overdue).toHaveLength(REMINDER_LIMITS.overdueListLimit);
    expect(r.overdue[0].id).toBe('o0');
  });

  it('returns nothing for an app with no date field', () => {
    const plain: SpecView = { name: 'Notes', collections: { notes: { fields: { body: { type: 'text', label: 'Note' } } } } };
    expect(computeDue({ spec: plain, records: { notes: [rec('n', { body: 'hi' })] }, config: undefined, now, zone: KOLKATA })).toEqual({ today: [], soon: [], overdue: [] });
  });
});
