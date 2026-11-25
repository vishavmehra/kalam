/**
 * Reading and checking reminder rules against an app's design. Pure, no platform imports.
 * Rules come from storage (and backups), so they are untrusted: a rule that points at something
 * the app no longer has is dropped instead of guessed at.
 */
import type { RecordValue } from '@/core/contracts';
import type { KalamCollection, KalamField } from '@/core/spec/schema';

import { parseTimeOfDay } from './zone';
import {
  REMINDER_LIMITS, type ReminderCondition, type ReminderConfig, type ReminderRule, type SpecView,
} from './types';

export const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export function collectionOf(spec: SpecView, id: string): KalamCollection | undefined {
  return hasOwn(spec.collections, id) ? spec.collections[id] : undefined;
}

export function fieldOf(collection: KalamCollection, id: string): KalamField | undefined {
  return hasOwn(collection.fields, id) ? collection.fields[id] : undefined;
}

export interface DateFieldChoice {
  collection: string;
  collectionLabel: string;
  field: string;
  fieldLabel: string;
}

/** Every date field in the app, in design order. These are the fields a reminder can watch. */
export function listDateFields(spec: SpecView): DateFieldChoice[] {
  const out: DateFieldChoice[] = [];
  for (const [collection, def] of Object.entries(spec.collections)) {
    for (const [field, f] of Object.entries(def.fields)) {
      if (f.type === 'date') {
        out.push({ collection, collectionLabel: def.label?.trim() || collection, field, fieldLabel: f.label });
      }
    }
  }
  return out;
}

/** Yes/no fields of a collection, for conditions such as "skip finished items". */
export function listBooleanFields(collection: KalamCollection): Array<{ field: string; label: string }> {
  return Object.entries(collection.fields)
    .filter(([, f]) => f.type === 'boolean')
    .map(([field, f]) => ({ field, label: f.label }));
}

/** First required text field, else first text field. Names the item in the notification. */
export function defaultTitleField(collection: KalamCollection): string | undefined {
  const texts = Object.entries(collection.fields).filter(([, f]) => f.type === 'text');
  return (texts.find(([, f]) => f.required) ?? texts[0])?.[0];
}

/** Tests a record's values against a rule condition. A missing yes/no value counts as "no". */
export function matchesCondition(condition: ReminderCondition | undefined, values: Record<string, RecordValue>): boolean {
  if (!condition) return true;
  const v = hasOwn(values, condition.field) ? values[condition.field] : null;
  switch (condition.op) {
    case 'is_false': return v !== true;
    case 'is_true': return v === true;
    case 'equals': return v === condition.value;
    case 'not_equals': return v !== condition.value;
  }
}

function conditionValid(condition: ReminderCondition, collection: KalamCollection): boolean {
  const f = fieldOf(collection, condition.field);
  if (!f) return false;
  if (condition.op === 'is_false' || condition.op === 'is_true') return f.type === 'boolean';
  return f.type === 'enum' || f.type === 'text';
}

/** Why a rule cannot run against this design, in plain words. `undefined` means it is fine. */
export function ruleProblem(rule: ReminderRule, spec: SpecView): string | undefined {
  const collection = collectionOf(spec, rule.collection);
  if (!collection) return 'The list this reminder watches is gone.';
  const date = fieldOf(collection, rule.dateField);
  if (!date || date.type !== 'date') return 'The date this reminder watches is gone.';
  if (rule.condition && !conditionValid(rule.condition, collection)) return 'The field used to skip items is gone.';
  if (!Number.isInteger(rule.leadDays) || rule.leadDays < 0 || rule.leadDays > REMINDER_LIMITS.maxLeadDays) {
    return 'The lead time is not valid.';
  }
  if (!parseTimeOfDay(rule.timeOfDay)) return 'The time is not valid.';
  return undefined;
}

/** Splits rules into those that can run (enabled or not) and those that point at something missing. */
export function checkRules(config: ReminderConfig | undefined, spec: SpecView): { valid: ReminderRule[]; invalid: ReminderRule[] } {
  const valid: ReminderRule[] = [];
  const invalid: ReminderRule[] = [];
  for (const rule of config?.rules ?? []) (ruleProblem(rule, spec) ? invalid : valid).push(rule);
  return { valid, invalid };
}

const DATE_PREFERENCE = /due|deadline|expir|renew|deliver|appoint|date/i;
const DONE_FIELD = /^(done|complete|completed|finished|paid|taken|checked|delivered|resolved|closed|received|sent)$/i;

/** A sensible first reminder for the app, or `undefined` when it has no date field. */
export function suggestRule(spec: SpecView): ReminderRule | undefined {
  for (const [collection, def] of Object.entries(spec.collections)) {
    const dates = Object.entries(def.fields).filter(([, f]) => f.type === 'date');
    if (!dates.length) continue;
    const [dateField] = dates.find(([id, f]) => DATE_PREFERENCE.test(id) || DATE_PREFERENCE.test(f.label)) ?? dates[0];
    const done = Object.entries(def.fields).find(([id, f]) => f.type === 'boolean' && DONE_FIELD.test(id));
    return {
      id: 'r1',
      enabled: true,
      collection,
      dateField,
      leadDays: 1,
      timeOfDay: '09:00',
      ...(done ? { condition: { field: done[0], op: 'is_false' as const } } : {}),
    };
  }
  return undefined;
}

/** The yes/no field that most likely means "finished" (done, paid, ...), else the first yes/no field. */
export function pickFinishedField(collection: KalamCollection): string | undefined {
  const booleans = listBooleanFields(collection);
  return (booleans.find((b) => DONE_FIELD.test(b.field)) ?? booleans[0])?.field;
}

/** Points a rule at another date field. The skip condition is kept only if it still fits; the item name field is reset. */
export function retargetRule(rule: ReminderRule, spec: SpecView, collection: string, dateField: string): ReminderRule {
  const target = collectionOf(spec, collection);
  const next: ReminderRule = {
    id: rule.id, enabled: rule.enabled, collection, dateField, leadDays: rule.leadDays, timeOfDay: rule.timeOfDay,
  };
  if (rule.condition && target && conditionValid(rule.condition, target)) next.condition = rule.condition;
  if (rule.titleField && collection === rule.collection) next.titleField = rule.titleField;
  if (rule.message) next.message = rule.message;
  return next;
}

/** Turns "skip finished items" on (using `field`) or off. */
export function withSkipFinished(rule: ReminderRule, field: string | undefined): ReminderRule {
  const next: ReminderRule = { ...rule };
  if (field) next.condition = { field, op: 'is_false' };
  else delete next.condition;
  return next;
}

/** Next free rule id (`r1`, `r2`, ...). */
export function nextRuleId(rules: readonly ReminderRule[]): string {
  const used = new Set(rules.map((r) => r.id));
  for (let n = 1; n <= REMINDER_LIMITS.rulesPerApp + 1; n++) if (!used.has(`r${n}`)) return `r${n}`;
  return `r${rules.length + 1}`;
}
