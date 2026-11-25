/**
 * Reminder settings storage (docs/14 §10.4: "store reminder definitions locally").
 *
 * No contract change is needed. Settings live in the app's key-value state
 * (`getServices().db.state`) under ONE reserved key, as a JSON string:
 *
 *     appId  ->  kalam_reminders  =  '{"version":1,"rules":[ ... ]}'
 *
 * Why this key: state keys must match the spec identifier pattern (lowercase letters, digits,
 * underscores, max 48), so a leading underscore or a dot is not allowed. Values are limited to
 * 5000 characters, and 4 rules stay far below that. The key rides along in backups, so reminders
 * survive a restore. An app counter with the same id would collide, which the spec validator does
 * not forbid today (see the report); a non-string value is ignored here.
 *
 * Stored data is untrusted (backups, edits): it is parsed with Zod and anything invalid is ignored.
 */
import { z } from 'zod';

import type { KeyValueRepository } from '@/core/contracts';
import { idSchema } from '@/core/spec/schema';

import { REMINDER_LIMITS, type ReminderConfig } from './types';

export const REMINDERS_STATE_KEY = 'kalam_reminders';

const MAX_STORED_LENGTH = 4500;

const conditionSchema = z.discriminatedUnion('op', [
  z.object({ field: idSchema, op: z.enum(['is_false', 'is_true']) }).strict(),
  z.object({ field: idSchema, op: z.enum(['equals', 'not_equals']), value: z.string().max(60) }).strict(),
]);

const ruleSchema = z
  .object({
    id: idSchema,
    enabled: z.boolean(),
    collection: idSchema,
    dateField: idSchema,
    leadDays: z.number().int().min(0).max(REMINDER_LIMITS.maxLeadDays),
    timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    condition: conditionSchema.optional(),
    titleField: idSchema.optional(),
    message: z.string().max(REMINDER_LIMITS.messageLength).optional(),
  })
  .strict();

export const reminderConfigSchema = z
  .object({
    version: z.literal(1),
    rules: z.array(ruleSchema).max(REMINDER_LIMITS.rulesPerApp),
  })
  .strict()
  .refine((c) => new Set(c.rules.map((r) => r.id)).size === c.rules.length, { message: 'Rule ids must be unique' });

/** Parses a stored value. Returns `undefined` for anything that is not valid settings. */
export function parseReminderConfig(raw: unknown): ReminderConfig | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 5000) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = reminderConfigSchema.safeParse(json);
  return parsed.success ? (parsed.data as ReminderConfig) : undefined;
}

/** Validates and serialises. Throws a plain-language Error when the settings cannot be stored. */
export function serializeReminderConfig(config: ReminderConfig): string {
  const parsed = reminderConfigSchema.safeParse(config);
  if (!parsed.success) throw new Error('These reminder settings are not valid.');
  const text = JSON.stringify(parsed.data);
  if (text.length > MAX_STORED_LENGTH) throw new Error('These reminder settings are too long to save.');
  return text;
}

export async function loadReminderConfig(state: Pick<KeyValueRepository, 'all'>, appId: string): Promise<ReminderConfig | undefined> {
  const all = await state.all(appId);
  return parseReminderConfig(all[REMINDERS_STATE_KEY]);
}

export async function saveReminderConfig(
  state: Pick<KeyValueRepository, 'set'>,
  appId: string,
  config: ReminderConfig,
): Promise<void> {
  await state.set(appId, REMINDERS_STATE_KEY, serializeReminderConfig(config));
}
