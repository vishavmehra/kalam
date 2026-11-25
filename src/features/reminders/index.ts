/**
 * Smart Reminders (docs/14 §10). Local only: no server, works offline.
 *
 *   UI        <RemindersPanel spec appId />   <DueTodayList spec appId />
 *   hooks     useDueToday, useReminderSync, useReminderBootstrap, useNotificationCapability
 *   sync      syncReminders(appId), syncAllReminders()
 *   pure      computePlan, diffSchedule, computeDue (scheduler.ts)
 */
export { RemindersPanel } from './RemindersPanel';
export { DueTodayList, DueTodayView } from './DueTodayList';
export {
  useDueToday, useNotificationCapability, useReminderBootstrap, useReminderData, useReminderSync, type DueToday,
} from './hooks';
export { syncAllReminders, syncReminders } from './runtime';
export { REMINDERS_STATE_KEY, loadReminderConfig, parseReminderConfig, saveReminderConfig } from './config';
export { computeDue, computePlan, diffSchedule, notificationId, parseNotificationId } from './scheduler';
export { REMINDER_LIMITS } from './types';
export type {
  DesiredNotification, DueItem, DueResult, ReminderCondition, ReminderConfig, ReminderRule, ScheduleOps, SpecView,
} from './types';
