/**
 * The reminder scheduler (docs/14 §10.4). Pure and deterministic: the same spec, records, config,
 * clock and zone always give the same plan. No platform, storage or React imports.
 *
 *   computePlan()    which notifications should exist right now
 *   diffSchedule()   compared with what the device has scheduled, what to schedule and cancel
 *   computeDue()     the always-available "Due today" list (works with no notification support)
 *
 * Rules are data. Nothing here evaluates user text as code.
 */
import { relationDisplayField } from '@/core/spec/v11';
import { isSignature } from '@/runtime/engine/v11/signature';
import type { KalamCollection, KalamField, KalamSpec } from '@/core/spec/schema';
import { NOTIFICATION_ID_PREFIX, type ScheduledNotificationRef } from '@/infrastructure/platform/notifications.shared';

import {
  checkRules, collectionOf, defaultTitleField, fieldOf, matchesCondition, suggestRule,
} from './rules';
import {
  REMINDER_LIMITS, type DesiredNotification, type DueItem, type DueResult, type PlanResult, type PlanStats,
  type RecordsByCollection, type ReminderConfig, type ReminderRule, type ScheduleOps, type SpecView,
} from './types';
import {
  addDays, daysBetween, formatDateOnly, localZone, parseDateOnly, parseTimeOfDay, todayParts, type Zone,
} from './zone';

const DAY_MS = 86_400_000;

// ─── Ids and fingerprints ────────────────────────────────────────────────────

/** `kalam.<appId>.<ruleId>.<recordId>`. App ids, rule ids and record ids never contain a dot. */
export const notificationId = (appId: string, ruleId: string, recordId: string): string =>
  `${NOTIFICATION_ID_PREFIX}${appId}.${ruleId}.${recordId}`;

export const appNotificationPrefix = (appId: string): string => `${NOTIFICATION_ID_PREFIX}${appId}.`;

export function parseNotificationId(id: string): { appId: string; ruleId: string; recordId: string } | undefined {
  if (!id.startsWith(NOTIFICATION_ID_PREFIX)) return undefined;
  const parts = id.slice(NOTIFICATION_ID_PREFIX.length).split('.');
  if (parts.length !== 3 || parts.some((p) => !p)) return undefined;
  return { appId: parts[0], ruleId: parts[1], recordId: parts[2] };
}

/** 32-bit FNV-1a as 8 hex characters. A cheap fingerprint, not a security hash. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ─── Notification text ───────────────────────────────────────────────────────

const whenPhrase = (leadDays: number) =>
  leadDays === 0 ? 'today' : leadDays === 1 ? 'tomorrow' : leadDays === 7 ? 'in a week' : `in ${leadDays} days`;

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max).trimEnd() : text);

const asText = (v: unknown): string | undefined => {
  // A drawn signature is strokes as text, never a name.
  // `isSignature` is a type guard; going through a plain boolean keeps TypeScript from narrowing the string away.
  const drawn = (x: string): boolean => isSignature(x);
  const text = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && !drawn(v) ? v.trim() : '';
  return text ? clip(text, 60) : undefined;
};

/**
 * What names an entry in a notification or the Due list. Text and a choice are printed as stored. A
 * link (KalamSpec 1.1) stores the id of another collection's entry, so it is looked up and the linked
 * entry's own name is printed, never the id. A link to an entry that is gone names nothing.
 */
function itemName(
  spec: SpecView, collectionId: string, values: Record<string, unknown>, field: string | undefined, records: RecordsByCollection,
): string | undefined {
  const collection = collectionOf(spec, collectionId);
  const def = collection && field ? fieldOf(collection, field) : undefined;
  if (!field || !def) return undefined;
  const ref = def.type === 'text' ? def.ref : undefined;
  if (!ref) return asText(values[field]);
  const id = values[field];
  const hit = typeof id === 'string' ? (records[ref.collection] ?? []).find((r) => r.id === id) : undefined;
  // relationDisplayField reads only `collections`, which a SpecView has.
  const shown = hit ? relationDisplayField(spec as unknown as KalamSpec, ref) : undefined;
  return hit && shown ? asText(hit.values[shown]) : undefined;
}

/** The field a rule names entries by: its own when the app still has it, else the collection's default. */
function titleFieldOf(collection: KalamCollection, rule: ReminderRule): string | undefined {
  const own = rule.titleField ? fieldOf(collection, rule.titleField) : undefined;
  return own && (own.type === 'text' || own.type === 'enum') ? rule.titleField : defaultTitleField(collection);
}

/**
 * The entry's name: from the rule's field, else the collection's default field, else the first other text or
 * choice field this entry has a value in (the default may be empty on this entry, or be a link to a deleted one).
 */
function nameOf(spec: SpecView, rule: ReminderRule, collection: KalamCollection, values: Record<string, unknown>, records: RecordsByCollection): string | undefined {
  // Plain text first, then a link, then a choice.
  const rank = (f: KalamField) => (f.type === 'enum' ? 2 : f.type === 'text' && f.ref ? 1 : 0);
  const nameable = Object.entries(collection.fields)
    .filter(([, f]) => f.type === 'text' || f.type === 'enum')
    .sort(([, a], [, b]) => rank(a) - rank(b))
    .map(([id]) => id);
  for (const field of new Set([titleFieldOf(collection, rule), defaultTitleField(collection), ...nameable])) {
    const name = itemName(spec, rule.collection, values, field, records);
    if (name) return name;
  }
  return undefined;
}

/** Title is the app's name. Body says what is due and when, or uses the person's own message. */
export function reminderText(spec: SpecView, rule: ReminderRule, name: string | undefined): { title: string; body: string } {
  const custom = rule.message?.trim();
  const body = custom
    ? custom.split('{title}').join(name ?? 'An item')
    : `${name ?? 'Something'} is due ${whenPhrase(rule.leadDays)}.`;
  return { title: clip(spec.name.trim() || 'Kalam', 60), body: clip(body, 140) };
}

// ─── Plan ────────────────────────────────────────────────────────────────────

export interface PlanInput {
  appId: string;
  spec: SpecView;
  records: RecordsByCollection;
  config: ReminderConfig | undefined;
  /** Epoch ms. */
  now: number;
  /** Defaults to the device time zone. */
  zone?: Zone;
  cap?: number;
  horizonDays?: number;
}

/**
 * The notifications that should be scheduled now.
 * Skipped: disabled rules, rules that no longer fit the design, records with no valid date,
 * records failing the condition (such as "not done"), reminder times already past, anything
 * beyond the horizon, and anything over the per-app cap (nearest kept).
 */
export function computePlan(input: PlanInput): PlanResult {
  const { appId, spec, records, config, now } = input;
  const zone = input.zone ?? localZone;
  const cap = input.cap ?? REMINDER_LIMITS.notificationsPerApp;
  const horizonEnd = now + (input.horizonDays ?? REMINDER_LIMITS.horizonDays) * DAY_MS;
  const stats: PlanStats = { considered: 0, noDate: 0, conditionFailed: 0, past: 0, beyondHorizon: 0, overCap: 0, invalidRules: 0 };

  const { valid, invalid } = checkRules(config, spec);
  stats.invalidRules = invalid.filter((r) => r.enabled).length;

  const all: DesiredNotification[] = [];
  for (const rule of valid) {
    if (!rule.enabled) continue;
    const collection = collectionOf(spec, rule.collection);
    const time = parseTimeOfDay(rule.timeOfDay);
    if (!collection || !time) continue;
    for (const record of records[rule.collection] ?? []) {
      stats.considered++;
      const due = parseDateOnly(record.values[rule.dateField]);
      if (!due) { stats.noDate++; continue; }
      if (!matchesCondition(rule.condition, record.values)) { stats.conditionFailed++; continue; }
      const day = addDays(due, -rule.leadDays);
      const fireAt = zone.toEpoch({ ...day, hour: time.hour, minute: time.minute });
      if (!Number.isFinite(fireAt) || fireAt <= now) { stats.past++; continue; }
      const { title, body } = reminderText(spec, rule, nameOf(spec, rule, collection, record.values, records));
      all.push({
        id: notificationId(appId, rule.id, record.id),
        appId,
        ruleId: rule.id,
        recordId: record.id,
        collection: rule.collection,
        fireAt,
        dueDate: formatDateOnly(due),
        title,
        body,
        hash: fingerprint(`${fireAt}|${title}|${body}`),
      });
    }
  }

  const upcoming = all.sort((a, b) => a.fireAt - b.fireAt || (a.id < b.id ? -1 : 1));
  const inHorizon = upcoming.filter((n) => n.fireAt <= horizonEnd);
  stats.beyondHorizon = upcoming.length - inHorizon.length;
  const desired = inHorizon.slice(0, cap);
  stats.overCap = inHorizon.length - desired.length;
  return { desired, upcoming, stats };
}

// ─── Diff ────────────────────────────────────────────────────────────────────

/**
 * Compares the desired set with what the device reports and says what to do. Only notifications
 * belonging to `appId` are ever cancelled; other apps' notifications are left alone.
 * A scheduled notification with no fingerprint is treated as changed and replaced.
 */
export function diffSchedule(
  appId: string,
  desired: readonly DesiredNotification[],
  scheduled: readonly ScheduledNotificationRef[],
): ScheduleOps {
  const prefix = appNotificationPrefix(appId);
  const current = new Map<string, ScheduledNotificationRef>();
  for (const s of scheduled) if (s.id.startsWith(prefix)) current.set(s.id, s);

  const mine = desired.filter((d) => d.id.startsWith(prefix));
  const wanted = new Set(mine.map((d) => d.id));
  const schedule = mine.filter((d) => current.get(d.id)?.hash !== d.hash);
  const cancel = [...current.keys()].filter((id) => !wanted.has(id)).sort();
  return { schedule, cancel, unchanged: mine.length - schedule.length };
}

// ─── Due today (works without notifications) ─────────────────────────────────

export interface DueInput {
  spec: SpecView;
  records: RecordsByCollection;
  config: ReminderConfig | undefined;
  now: number;
  zone?: Zone;
  /**
   * With no saved reminder settings, use the app's most likely date field so the list still helps.
   * Default true. Once settings are saved (even with no reminders), only those rules are used.
   */
  implicit?: boolean;
}

/**
 * Items due today, items whose reminder day has arrived (due later), and overdue items.
 * An item matching several rules appears once. Respects each rule's condition and on/off switch.
 */
export function computeDue(input: DueInput): DueResult {
  const { spec, records, config, now } = input;
  const zone = input.zone ?? localZone;
  const today = todayParts(now, zone);

  let rules = checkRules(config, spec).valid.filter((r) => r.enabled);
  if (!config && (input.implicit ?? true)) {
    const suggested = suggestRule(spec);
    rules = suggested ? [suggested] : [];
  }

  const seen = new Set<string>();
  const result: DueResult = { today: [], soon: [], overdue: [] };
  for (const rule of rules) {
    const collection = collectionOf(spec, rule.collection);
    if (!collection) continue;
    for (const record of records[rule.collection] ?? []) {
      const due = parseDateOnly(record.values[rule.dateField]);
      if (!due || !matchesCondition(rule.condition, record.values)) continue;
      const key = `${rule.collection}\u0000${record.id}`;
      if (seen.has(key)) continue;
      const daysFromToday = daysBetween(today, due);
      const bucket = daysFromToday === 0 ? 'today' : daysFromToday < 0 ? 'overdue' : daysFromToday <= rule.leadDays ? 'soon' : undefined;
      if (!bucket) continue;
      seen.add(key);
      const item: DueItem = {
        id: record.id,
        ruleId: rule.id,
        collection: rule.collection,
        title: nameOf(spec, rule, collection, record.values, records) ?? 'Untitled',
        dueDate: formatDateOnly(due),
        daysFromToday,
      };
      result[bucket].push(item);
    }
  }
  const byTitle = (a: DueItem, b: DueItem) => a.daysFromToday - b.daysFromToday || a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1);
  result.today.sort(byTitle);
  result.soon.sort(byTitle);
  result.overdue.sort(byTitle);
  result.overdue = result.overdue.slice(0, REMINDER_LIMITS.overdueListLimit);
  return result;
}
