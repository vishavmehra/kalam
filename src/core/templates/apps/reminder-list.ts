import { z } from 'zod';
import type { KalamComponent } from '../../spec/schema';
import { PHRASES, assembleSpec, baseParamsShape, crudActions, extractBase, phrases, type KalamTemplate } from '../base';

const paramsSchema = z
  .object({
    ...baseParamsShape,
    /** Singular noun: "Reminder", "Dose", "Bill". */
    itemLabel: z.string().trim().min(1).max(30),
    includeNote: z.boolean(),
  })
  .strict();
export type ReminderListParams = z.infer<typeof paramsSchema>;

/**
 * Honest scope: KalamSpec v1 has no notifications, so this is a due-date list with "due today"
 * and "overdue" counts — not an alarm. The description says so.
 */
export const reminderListTemplate: KalamTemplate<ReminderListParams> = {
  id: 'reminder_list',
  title: 'Reminder list',
  description: 'Things to remember with due dates, showing what is due today and overdue.',
  strongKeywords: ['reminder', 'reminders', 'remind', 'due date', 'deadline', 'yaad', 'yaad dilana', 'याद', 'रिमाइंडर'],
  keywords: [
    'reminder', 'reminders', 'remind', 'due', 'deadline', 'bills', 'renewal', 'medicine', 'dawai', 'dawa', 'yaad',
    'birthday', 'appointments', 'याद', 'रिमाइंडर',
  ],
  examples: ['A reminder list with due dates', 'bills ki due date yaad rakhne ka app', 'Simple medicine reminder'],
  paramsSchema,
  defaults: { name: 'Reminders', theme: 'ocean_blue', itemLabel: 'Reminder', includeNote: true },
  extractParams(text) {
    const out: Partial<ReminderListParams> = extractBase(text);
    const t = text.toLowerCase();
    if (/\bmedicine|\bdawai|\bdawa\b|\bpills?\b|\btablets?\b|दवा/.test(t)) { out.itemLabel = 'Dose'; out.name ??= 'Medicine reminders'; }
    else if (/\bbills?\b|\bpayments?\b|\brenewals?\b/.test(t)) { out.itemLabel = 'Bill'; out.name ??= 'Bill reminders'; }
    else if (/\bbirthdays?\b/.test(t)) { out.itemLabel = 'Birthday'; out.name ??= 'Birthdays'; }
    return out;
  },
  build(p, opts) {
    const noun = p.itemLabel;
    const lower = noun.toLowerCase();
    const inputs: KalamComponent[] = [
      { id: 'title_input', type: 'textInput', label: noun, field: 'title', required: true, placeholder: 'What should you remember?' },
      { id: 'due_input', type: 'date', label: 'Due date', field: 'due', required: true },
    ];
    if (p.includeNote) inputs.push({ id: 'note_input', type: 'textInput', label: 'Note', field: 'note', multiline: true });
    const glyph = lower === 'dose' ? 'pill' : lower === 'birthday' ? 'calendar' : 'bell';
    return assembleSpec(
      {
        templateId: 'reminder_list',
        name: p.name,
        description: `${noun}s with due dates. See what is due today and what is late. There are no alarms, so open the app to check.`,
        glyph,
        theme: p.theme,
        collections: {
          reminders: {
            label: `${noun}s`,
            fields: {
              title: { type: 'text', label: noun, required: true, maxLength: 120 },
              due: { type: 'date', label: 'Due date', required: true, defaultValue: 'today' },
              done: { type: 'boolean', label: 'Done', defaultValue: false },
              ...(p.includeNote ? { note: { type: 'text', label: 'Note', multiline: true, maxLength: 500 } as const } : {}),
            },
          },
        },
        screens: [
          {
            id: 'home',
            title: p.name.slice(0, 60),
            children: [
              { id: 'due_today', type: 'stat', label: 'Due today', expr: 'count(filter(reminders, due == today && done == false))', format: 'integer' },
              { id: 'overdue', type: 'stat', label: 'Overdue', expr: 'count(filter(reminders, due < today && done == false))', format: 'integer' },
              { id: 'add_button', type: 'bigButton', label: `Add ${lower}`, action: 'go_add', tone: 'primary' },
              {
                id: 'upcoming_list', type: 'list', label: 'To do', source: 'reminders', primary: 'title', secondary: 'due',
                filter: 'done == false', sort: { field: 'due', direction: 'asc' }, toggleField: 'done', detailScreen: 'reminder',
                emptyText: 'Nothing pending. Enjoy your day.',
              },
              {
                id: 'done_list', type: 'list', label: 'Done', source: 'reminders', primary: 'title', secondary: 'due',
                filter: 'done == true', sort: { field: 'due', direction: 'desc' }, limit: 30, toggleField: 'done', allowDelete: true,
                emptyText: 'Completed items appear here.',
              },
            ],
          },
          {
            id: 'add', title: `New ${lower}`, form: 'reminders',
            children: [
              ...inputs,
              { id: 'save_button', type: 'bigButton', label: `Save ${lower}`, action: 'save_reminders', tone: 'primary' },
              { id: 'cancel_button', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
          {
            id: 'reminder', title: noun, form: 'reminders',
            children: [
              ...inputs.map((c) => ({ ...c, id: `edit_${c.id}` })),
              { id: 'done_input', type: 'toggle', label: 'Done', field: 'done' },
              { id: 'update_button', type: 'bigButton', label: 'Save changes', action: 'update_reminders', tone: 'primary' },
              { id: 'delete_button', type: 'bigButton', label: `Delete ${lower}`, action: 'delete_reminders', tone: 'danger' },
              { id: 'detail_back', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
        ],
        actions: crudActions('reminders', noun, 'home', 'add'),
        intents: {
          go_add: phrases([`add ${lower}`, `new ${lower}`, 'remind me', 'yaad dilana', 'naya reminder', 'याद दिलाना']),
          save_reminders: [...PHRASES.save],
          update_reminders: [...PHRASES.update],
          delete_reminders: [...PHRASES.remove],
          go_home: [...PHRASES.home],
        },
        tags: ['reminders'],
      },
      opts,
    );
  },
};
