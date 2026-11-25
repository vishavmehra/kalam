/**
 * Smart Reminders types (docs/14 §10). A reminder rule is DATA: it names a collection, a date
 * field and a few plain settings. Nothing here is code and nothing is evaluated.
 */
import type { RecordValue } from '@/core/contracts';
import type { KalamCollection } from '@/core/spec/schema';

export const REMINDER_LIMITS = {
  rulesPerApp: 4,
  /** Most notifications scheduled on the device for one app at a time (nearest first). */
  notificationsPerApp: 24,
  /** Reminders further away than this are not scheduled yet. They are scheduled when the app next opens. */
  horizonDays: 60,
  maxLeadDays: 30,
  messageLength: 120,
  /** Overdue items listed in the in-app list. */
  overdueListLimit: 20,
} as const;

/** Only keep items matching a simple test on one field. "Not done" is `{ field: 'done', op: 'is_false' }`. */
export type ReminderCondition =
  | { field: string; op: 'is_false' | 'is_true' }
  | { field: string; op: 'equals' | 'not_equals'; value: string };

export interface ReminderRule {
  /** Unique within the app, e.g. `r1`. Part of the notification id. */
  id: string;
  /** Off means no notification and nothing in the in-app list. */
  enabled: boolean;
  collection: string;
  /** A field of type `date` in that collection. */
  dateField: string;
  /** Days before the date. 0 means on the day. */
  leadDays: number;
  /** Local time, 24 hour 'HH:MM'. */
  timeOfDay: string;
  condition?: ReminderCondition;
  /** Field whose value names the item in the notification. Defaults to the first text field. */
  titleField?: string;
  /** Custom text. `{title}` is replaced by the item's name. */
  message?: string;
}

export interface ReminderConfig {
  version: 1;
  rules: ReminderRule[];
}

/** The parts of a stored app the scheduler reads. */
export interface SpecView {
  name: string;
  collections: Record<string, KalamCollection>;
}

export interface RecordView {
  id: string;
  values: Record<string, RecordValue>;
}

export type RecordsByCollection = Record<string, readonly RecordView[]>;

/** One notification the device should have. */
export interface DesiredNotification {
  /** `kalam.<appId>.<ruleId>.<recordId>` */
  id: string;
  appId: string;
  ruleId: string;
  recordId: string;
  collection: string;
  /** Epoch ms. */
  fireAt: number;
  /** The record's date, 'YYYY-MM-DD'. */
  dueDate: string;
  title: string;
  body: string;
  /** Fingerprint of fireAt + title + body, used to detect a changed notification. */
  hash: string;
}

export interface PlanStats {
  /** Records looked at across all active rules. */
  considered: number;
  noDate: number;
  conditionFailed: number;
  /** Reminder time already passed. */
  past: number;
  beyondHorizon: number;
  /** Dropped because the per-app cap was reached. */
  overCap: number;
  /** Rules that point at a collection or field that no longer exists. */
  invalidRules: number;
}

export interface PlanResult {
  /** What should be scheduled now: inside the horizon, nearest first, at most the cap. */
  desired: DesiredNotification[];
  /** Every future reminder, nearest first (used for "Coming up"). */
  upcoming: DesiredNotification[];
  stats: PlanStats;
}

export interface ScheduleOps {
  schedule: DesiredNotification[];
  cancel: string[];
  unchanged: number;
}

export interface DueItem {
  /** Record id */
  id: string;
  ruleId: string;
  collection: string;
  /** The item's name, or 'Untitled'. */
  title: string;
  dueDate: string;
  /** 0 today, negative overdue, positive upcoming. */
  daysFromToday: number;
}

export interface DueResult {
  today: DueItem[];
  /** Due later, but the reminder day has already arrived. */
  soon: DueItem[];
  overdue: DueItem[];
}
