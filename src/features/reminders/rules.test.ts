import { describe, expect, it } from 'vitest';

import {
  checkRules, listBooleanFields, listDateFields, matchesCondition, nextRuleId, pickFinishedField, retargetRule,
  ruleProblem, suggestRule, withSkipFinished,
} from './rules';
import { describeRule, describeWhen, dueLabel, formatTimeOfDay, leadLabel } from './format';
import type { ReminderRule, SpecView } from './types';
import { ianaZone } from './zone';

const spec: SpecView = {
  name: 'Shop',
  collections: {
    notes: { fields: { body: { type: 'text', label: 'Note' } } },
    orders: {
      label: 'Orders',
      fields: {
        customer: { type: 'text', label: 'Customer', required: true },
        placed: { type: 'date', label: 'Placed on' },
        delivery: { type: 'date', label: 'Delivery date' },
        delivered: { type: 'boolean', label: 'Delivered' },
        urgent: { type: 'boolean', label: 'Urgent' },
        stage: { type: 'enum', label: 'Stage', options: ['New', 'Packed'] },
      },
    },
    bills: {
      label: 'Bills',
      fields: { name: { type: 'text', label: 'Bill' }, due: { type: 'date', label: 'Due' }, paid: { type: 'boolean', label: 'Paid' } },
    },
  },
};

const rule = (over: Partial<ReminderRule> = {}): ReminderRule => ({
  id: 'r1', enabled: true, collection: 'orders', dateField: 'delivery', leadDays: 1, timeOfDay: '09:00', ...over,
});

describe('reminder rules', () => {
  it('lists date and yes/no fields', () => {
    expect(listDateFields(spec).map((d) => `${d.collection}.${d.field}`)).toEqual(['orders.placed', 'orders.delivery', 'bills.due']);
    expect(listBooleanFields(spec.collections.orders).map((b) => b.field)).toEqual(['delivered', 'urgent']);
  });

  it('suggests the most likely date field and a "finished" condition', () => {
    expect(suggestRule(spec)).toEqual({
      id: 'r1', enabled: true, collection: 'orders', dateField: 'delivery', leadDays: 1, timeOfDay: '09:00',
      condition: { field: 'delivered', op: 'is_false' },
    });
    expect(suggestRule({ name: 'N', collections: { notes: spec.collections.notes } })).toBeUndefined();
  });

  it('picks the finished field by name, else the first yes/no field', () => {
    expect(pickFinishedField(spec.collections.orders)).toBe('delivered');
    expect(pickFinishedField({ fields: { star: { type: 'boolean', label: 'Starred' } } })).toBe('star');
    expect(pickFinishedField(spec.collections.notes)).toBeUndefined();
  });

  it('checks conditions, treating a missing yes/no value as no', () => {
    expect(matchesCondition(undefined, {})).toBe(true);
    expect(matchesCondition({ field: 'done', op: 'is_false' }, {})).toBe(true);
    expect(matchesCondition({ field: 'done', op: 'is_false' }, { done: true })).toBe(false);
    expect(matchesCondition({ field: 'done', op: 'is_true' }, {})).toBe(false);
    expect(matchesCondition({ field: 'stage', op: 'equals', value: 'New' }, { stage: 'New' })).toBe(true);
    expect(matchesCondition({ field: 'stage', op: 'not_equals', value: 'New' }, { stage: null })).toBe(true);
  });

  it('explains why a rule cannot run', () => {
    expect(ruleProblem(rule(), spec)).toBeUndefined();
    expect(ruleProblem(rule({ collection: 'gone' }), spec)).toMatch(/list/);
    expect(ruleProblem(rule({ dateField: 'customer' }), spec)).toMatch(/date/);
    expect(ruleProblem(rule({ condition: { field: 'customer', op: 'is_true' } }), spec)).toMatch(/skip/);
    expect(ruleProblem(rule({ leadDays: 99 }), spec)).toMatch(/lead time/);
    expect(ruleProblem(rule({ timeOfDay: '7pm' }), spec)).toMatch(/time/);
    expect(ruleProblem(rule({ collection: 'constructor' }), spec)).toBeDefined();
    expect(checkRules({ version: 1, rules: [rule(), rule({ id: 'r2', collection: 'gone' })] }, spec)).toMatchObject({
      valid: [{ id: 'r1' }], invalid: [{ id: 'r2' }],
    });
  });

  it('retargets a rule and keeps the skip condition only when it still fits', () => {
    const base = rule({ condition: { field: 'delivered', op: 'is_false' }, titleField: 'customer', message: 'Hi {title}' });
    const sameList = retargetRule(base, spec, 'orders', 'placed');
    expect(sameList).toMatchObject({ dateField: 'placed', condition: { field: 'delivered' }, titleField: 'customer', message: 'Hi {title}' });
    const otherList = retargetRule(base, spec, 'bills', 'due');
    expect(otherList.condition).toBeUndefined();
    expect(otherList.titleField).toBeUndefined();
    expect(otherList.message).toBe('Hi {title}');
    expect(ruleProblem(otherList, spec)).toBeUndefined();
  });

  it('turns "skip finished items" on and off', () => {
    const on = withSkipFinished(rule(), 'delivered');
    expect(on.condition).toEqual({ field: 'delivered', op: 'is_false' });
    expect('condition' in withSkipFinished(on, undefined)).toBe(false);
  });

  it('finds the next free rule id', () => {
    expect(nextRuleId([])).toBe('r1');
    expect(nextRuleId([rule({ id: 'r1' }), rule({ id: 'r3' })])).toBe('r2');
    expect(nextRuleId([1, 2, 3, 4].map((n) => rule({ id: `r${n}` })))).toBe('r5');
  });
});

describe('reminder labels', () => {
  it('names lead times and times of day', () => {
    expect(leadLabel(0)).toBe('On the day');
    expect(leadLabel(1)).toBe('1 day before');
    expect(leadLabel(5)).toBe('5 days before');
    expect(leadLabel(7)).toBe('1 week before');
    expect(formatTimeOfDay('09:00')).toBe('9:00 AM');
    expect(formatTimeOfDay('00:05')).toBe('12:05 AM');
    expect(formatTimeOfDay('12:00')).toBe('12:00 PM');
    expect(formatTimeOfDay('18:30')).toBe('6:30 PM');
  });

  it('says where an item stands', () => {
    expect(dueLabel(0)).toBe('Due today');
    expect(dueLabel(1)).toBe('Due tomorrow');
    expect(dueLabel(4)).toBe('Due in 4 days');
    expect(dueLabel(-1)).toBe('1 day late');
    expect(dueLabel(-3)).toBe('3 days late');
  });

  it('describes when a notification will appear, in the zone given', () => {
    const zone = ianaZone('Asia/Kolkata');
    const now = zone.toEpoch({ year: 2026, month: 11, day: 20, hour: 10, minute: 0 });
    const at = (day: number, hour: number) => zone.toEpoch({ year: 2026, month: 11, day, hour, minute: 0 });
    expect(describeWhen(at(20, 18), now, zone)).toBe('Today at 6:00 PM');
    expect(describeWhen(at(21, 9), now, zone)).toBe('Tomorrow at 9:00 AM');
    expect(describeWhen(at(25, 9), now, zone)).toBe('Wed 25 Nov at 9:00 AM');
  });

  it('describes a rule in one line', () => {
    expect(describeRule(spec, rule({ condition: { field: 'delivered', op: 'is_false' } }))).toEqual({
      title: 'Orders: Delivery date',
      detail: '1 day before at 9:00 AM, skips items marked "Delivered".',
    });
    expect(describeRule(spec, rule({ leadDays: 0 })).detail).toBe('On the day at 9:00 AM.');
  });
});
