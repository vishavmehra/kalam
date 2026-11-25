/**
 * Plain-English labels for reminders. Pure, no platform imports.
 * Copy rule: short sentences, no dashes used as punctuation, no hype.
 */
import { collectionOf, fieldOf } from './rules';
import type { ReminderCondition, ReminderRule, SpecView } from './types';
import { daysBetween, parseTimeOfDay, todayParts, type Zone } from './zone';

export const LEAD_PRESETS = [0, 1, 2, 3, 7] as const;
export const TIME_PRESETS = ['08:00', '09:00', '12:00', '18:00', '20:00'] as const;

export function leadLabel(days: number): string {
  if (days === 0) return 'On the day';
  if (days === 1) return '1 day before';
  if (days === 7) return '1 week before';
  return `${days} days before`;
}

/** '18:30' becomes '6:30 PM'. */
export function formatTimeOfDay(value: string): string {
  const t = parseTimeOfDay(value);
  if (!t) return value;
  return `${t.hour % 12 || 12}:${String(t.minute).padStart(2, '0')} ${t.hour < 12 ? 'AM' : 'PM'}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Where an item stands against today. */
export function dueLabel(daysFromToday: number): string {
  if (daysFromToday === 0) return 'Due today';
  if (daysFromToday === 1) return 'Due tomorrow';
  if (daysFromToday > 1) return `Due in ${daysFromToday} days`;
  if (daysFromToday === -1) return '1 day late';
  return `${-daysFromToday} days late`;
}

/** When a notification will appear, such as "Tomorrow at 9:00 AM" or "Mon 9 Dec at 9:00 AM". */
export function describeWhen(fireAt: number, now: number, zone: Zone): string {
  const w = zone.toWallClock(fireAt);
  const time = formatTimeOfDay(`${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`);
  const diff = daysBetween(todayParts(now, zone), w);
  if (diff === 0) return `Today at ${time}`;
  if (diff === 1) return `Tomorrow at ${time}`;
  const weekday = WEEKDAYS[new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()];
  return `${weekday} ${w.day} ${MONTHS[w.month - 1]} at ${time}`;
}

function conditionText(spec: SpecView, rule: ReminderRule, condition: ReminderCondition): string {
  const collection = collectionOf(spec, rule.collection);
  const label = (collection && fieldOf(collection, condition.field)?.label) || condition.field;
  switch (condition.op) {
    case 'is_false': return `skips items marked "${label}"`;
    case 'is_true': return `only items marked "${label}"`;
    case 'equals': return `only when ${label} is ${condition.value}`;
    case 'not_equals': return `skips when ${label} is ${condition.value}`;
  }
}

/** A heading and one line of detail for a rule card. */
export function describeRule(spec: SpecView, rule: ReminderRule): { title: string; detail: string } {
  const collection = collectionOf(spec, rule.collection);
  const field = collection ? fieldOf(collection, rule.dateField) : undefined;
  const title = `${collection?.label?.trim() || rule.collection}: ${field?.label ?? rule.dateField}`;
  const base = `${leadLabel(rule.leadDays)} at ${formatTimeOfDay(rule.timeOfDay)}`;
  const detail = rule.condition ? `${base}, ${conditionText(spec, rule, rule.condition)}.` : `${base}.`;
  return { title, detail };
}
