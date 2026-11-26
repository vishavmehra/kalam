/**
 * Reminder component (KalamSpec 1.1) on top of Smart Reminders (src/features/reminders). A spec
 * reminder becomes one scheduler rule; it is enabled only when the person switched it on, which is
 * stored in the app's own key-value state under the component id. Pure.
 */
import type { RecordValue } from '@/core/contracts';
import type { ComponentOf, KalamSpec } from '@/core/spec/schema';
import { isSignatureField, relationOf, safeLocale } from '@/core/spec/v11';
import { REMINDER_LIMITS, type ReminderConfig, type ReminderRule } from '@/features/reminders/types';
import type { ActionResult, EngineEnv, RuntimeState } from '../types';
import { v11Words } from './copy';

export const DEFAULT_REMINDER_TIME = '09:00';

/**
 * Field that names an entry in the notification: the spec's titleField when it is text, a link or a choice,
 * else the best of the collection's own: a required plain text field, any plain text field, a link, a choice.
 * Never a signature. The scheduler (src/features/reminders) prints a choice as its option and a link as the
 * linked entry's own name, never the hidden id.
 */
export function reminderTitleField(spec: KalamSpec, c: ComponentOf<'reminder'>): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(spec.collections, c.source)) return c.titleField;
  const fields = spec.collections[c.source].fields;
  const nameable = (id: string) =>
    Object.prototype.hasOwnProperty.call(fields, id) && (fields[id].type === 'text' || fields[id].type === 'enum') && !isSignatureField(spec, c.source, id);
  if (c.titleField && nameable(c.titleField)) return c.titleField;
  const field = (id: string) => fields[id];
  const rank = (id: string) => (field(id).type === 'enum' ? 2 : relationOf(spec, c.source, id) ? 1 : 0);
  const ids = Object.keys(fields).filter(nameable);
  const best = Math.min(...ids.map(rank));
  const group = ids.filter((id) => rank(id) === best);
  return group.find((id) => field(id).required) ?? group[0] ?? c.titleField;
}

export function reminderRule(c: ComponentOf<'reminder'>, enabled: boolean, spec?: KalamSpec): ReminderRule {
  const titleField = spec ? reminderTitleField(spec, c) : c.titleField;
  return {
    id: c.id,
    enabled,
    collection: c.source,
    dateField: c.dateField,
    leadDays: c.leadDays ?? 0,
    timeOfDay: c.time ?? DEFAULT_REMINDER_TIME,
    ...(c.doneField ? { condition: { field: c.doneField, op: 'is_false' as const } } : {}),
    ...(titleField ? { titleField } : {}),
    ...(c.message ? { message: c.message } : {}),
  };
}

export function reminderComponents(spec: KalamSpec): Array<ComponentOf<'reminder'>> {
  return spec.screens.flatMap((s) => s.children.filter((c): c is ComponentOf<'reminder'> => c.type === 'reminder'));
}

/** Whether the person switched this reminder on (default off: nothing is scheduled without opt-in). */
export const reminderEnabled = (state: Readonly<Record<string, RecordValue>>, id: string): boolean => state[id] === true;

/**
 * The stored Smart Reminders settings plus the app's own reminder components. Stored rules win on
 * an id clash and the scheduler's per-app cap is kept. Returns undefined only when there is nothing.
 */
export function withSpecReminders(
  config: ReminderConfig | undefined, spec: KalamSpec | undefined, state: Readonly<Record<string, RecordValue>>,
): ReminderConfig | undefined {
  const rules = [...(config?.rules ?? [])];
  const taken = new Set(rules.map((r) => r.id));
  for (const c of spec ? reminderComponents(spec) : []) {
    if (rules.length >= REMINDER_LIMITS.rulesPerApp) break;
    if (taken.has(c.id)) continue;
    rules.push(reminderRule(c, reminderEnabled(state, c.id), spec));
  }
  return rules.length ? { version: 1, rules } : config;
}

/** What the reminder's status line says. */
export type ReminderStatus = 'off' | 'on' | 'no_permission' | 'unsupported' | 'error';

/** Device side of the switch. Absent in a preview, where nothing reaches the device. */
export interface ReminderDevice {
  /** Shows the system prompt (Smart Reminders' adapter.requestPermission). Only called on switch-on. */
  requestPermission(): Promise<unknown>;
  /** Smart Reminders' `syncReminders(appId)`; its `status` says what really happened. */
  sync(appId: string): Promise<{ status: 'synced' | 'no_permission' | 'unsupported' | 'error' }>;
}

/**
 * The person's switch. Stored in the app's key-value state under the component id, like a counter.
 * Switching on asks for notification permission (this runs from the person's own tap), then syncs,
 * and the status says honestly whether anything will pop up. Switching off syncs too, which
 * cancels what was scheduled. The choice is kept even when permission is refused, so allowing
 * notifications later in system settings is enough.
 */
export async function setReminderEnabled(
  env: EngineEnv, state: RuntimeState, id: string, on: boolean, device?: ReminderDevice,
): Promise<ActionResult & { reminderStatus: ReminderStatus }> {
  try {
    await env.services.state.set(env.appId, id, on);
  } catch {
    return {
      ok: false, state, error: 'storage_failed', reminderStatus: 'error',
      effects: [{ type: 'toast', message: v11Words(env.spec.lang).reminderSaveFailed, tone: 'error' }],
    };
  }
  let reminderStatus: ReminderStatus = on ? 'on' : 'off';
  if (device) {
    try {
      if (on) await device.requestPermission();
      const { status } = await device.sync(env.appId);
      if (on && status !== 'synced') reminderStatus = status;
    } catch {
      if (on) reminderStatus = 'error';
    }
  }
  // The block's status line is a polite live region; Read-aloud can announce v11Words(lang).reminderStatus[...].
  return { ok: true, state, kvWrites: { [id]: on }, reminderStatus, effects: [] };
}

/** "9:00 AM" or "09:00". */
export function formatTime(hhmm: string, format: '12h' | '24h' = '24h'): string {
  if (format === '24h') return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** One plain sentence about when the reminder fires, from the app's own labels. */
export function describeReminder(spec: KalamSpec, c: ComponentOf<'reminder'>, lang?: string): string {
  const fields = Object.prototype.hasOwnProperty.call(spec.collections, c.source) ? spec.collections[c.source].fields : {};
  const locale = safeLocale(spec.lang);
  const label = (id: string) => (Object.prototype.hasOwnProperty.call(fields, id) ? fields[id].label : id).toLocaleLowerCase(locale);
  const words = v11Words(lang ?? spec.lang);
  const when = words.reminderWhen(c.leadDays ?? 0, label(c.dateField), formatTime(c.time ?? DEFAULT_REMINDER_TIME, spec.settings?.timeFormat));
  return c.doneField ? `${when} ${words.reminderSkipsDone(label(c.doneField))}` : when;
}
