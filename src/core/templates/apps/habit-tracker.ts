import { z } from 'zod';
import type { KalamComponent } from '../../spec/schema';
import { PHRASES, assembleSpec, baseParamsShape, cleanOptions, extractBase, labelList, phrases, type KalamTemplate } from '../base';
import { extractList } from '../extract';

const paramsSchema = z.object({ ...baseParamsShape, habits: labelList(10) }).strict();
export type HabitTrackerParams = z.infer<typeof paramsSchema>;

export const habitTrackerTemplate: KalamTemplate<HabitTrackerParams> = {
  id: 'habit_tracker',
  title: 'Habit tracker',
  description: 'Check in your daily habits and see what is done today and how often each habit was kept.',
  strongKeywords: ['habit', 'habits', 'streak', 'daily routine', 'aadat', 'aadatein', 'dincharya', 'आदत', 'दिनचर्या'],
  keywords: [
    'habit', 'habits', 'streak', 'routine', 'daily', 'every day', 'roz', 'rozana', 'exercise', 'meditate',
    'yoga', 'water', 'aadat', 'dincharya', 'आदत',
  ],
  examples: ['Daily habit tracker for exercise, reading and water', 'roz ki aadat track karne wala app'],
  paramsSchema,
  defaults: { name: 'Habits', theme: 'soft_lavender', habits: ['Exercise', 'Read', 'Drink water', 'Meditate'] },
  extractParams(text) {
    const out: Partial<HabitTrackerParams> = extractBase(text);
    const habits = extractList(text, ['habits', 'habit', 'for', 'like', 'track'], 10);
    if (habits) out.habits = habits;
    return out;
  },
  build(p, opts) {
    const habits = cleanOptions(p.habits, 'My habit');
    // Per habit: all-time days, the streak (days in a row up to today) and this week (eval s21, s24).
    const perHabit = habits.flatMap<KalamComponent>((h, i) => {
      const kept = `filter(logs, habit == '${h}' && done == true)`;
      return [
        { id: `habit_days_${i + 1}`, type: 'stat', label: `${h}: days done`, expr: `count(${kept})`, format: 'integer' },
        { id: `habit_streak_${i + 1}`, type: 'stat', label: `${h}: days in a row`, expr: `streak(${kept}.date)`, format: 'integer' },
        {
          id: `habit_week_${i + 1}`, type: 'stat', label: `${h}: this week`,
          expr: `count(filter(logs, habit == '${h}' && done == true && week(date) == week(today)))`, format: 'integer',
        },
      ];
    });
    return assembleSpec(
      {
        templateId: 'habit_tracker',
        name: p.name,
        description: `Check in ${habits.slice(0, 3).join(', ').toLowerCase()}${habits.length > 3 ? ' and more' : ''} every day, and see each streak.`,
        glyph: 'flame',
        theme: p.theme,
        collections: {
          logs: {
            label: 'Check-ins',
            fields: {
              habit: { type: 'enum', label: 'Habit', required: true, options: habits, defaultValue: habits[0] },
              date: { type: 'date', label: 'Date', required: true, defaultValue: 'today' },
              done: { type: 'boolean', label: 'Done', defaultValue: true },
            },
          },
        },
        screens: [
          {
            id: 'home',
            title: p.name.slice(0, 60),
            children: [
              {
                id: 'done_today', type: 'stat', label: 'Done today',
                expr: 'count(filter(logs, date == today && done == true))', format: 'integer', suffix: ` of ${habits.length}`,
              },
              { id: 'checkin_button', type: 'bigButton', label: 'Check in a habit', action: 'go_log', tone: 'primary' },
              {
                id: 'today_list', type: 'list', label: 'Today', source: 'logs', primary: 'habit', filter: 'date == today',
                toggleField: 'done', allowDelete: true, emptyText: 'Nothing checked in today yet.',
              },
              {
                id: 'history_list', type: 'list', label: 'History', source: 'logs', primary: 'habit', secondary: 'date',
                sort: { field: 'date', direction: 'desc' }, limit: 60, toggleField: 'done', allowDelete: true,
                emptyText: 'Your check-ins will appear here.',
              },
              { id: 'progress_button', type: 'bigButton', label: 'Progress by habit', action: 'go_progress', tone: 'secondary' },
            ],
          },
          {
            id: 'log', title: 'Check in', form: 'logs',
            children: [
              { id: 'habit_input', type: 'choice', label: 'Habit', field: 'habit', required: true },
              { id: 'date_input', type: 'date', label: 'Date', field: 'date', required: true },
              { id: 'done_input', type: 'toggle', label: 'Done', field: 'done' },
              { id: 'save_button', type: 'bigButton', label: 'Save check-in', action: 'save_logs', tone: 'primary' },
              { id: 'cancel_button', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
          {
            id: 'progress', title: 'Progress',
            children: [
              { id: 'total_checkins', type: 'stat', label: 'Habits kept (all time)', expr: 'count(filter(logs, done == true))', format: 'integer' },
              ...perHabit,
              { id: 'progress_back', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
        ],
        actions: {
          go_log: { type: 'navigate', screen: 'log' },
          go_home: { type: 'navigate', screen: 'home' },
          go_progress: { type: 'navigate', screen: 'progress' },
          save_logs: { type: 'insert', collection: 'logs', then: { feedback: 'Checked in for today', navigate: 'home' } },
        },
        intents: {
          go_log: phrases(['check in', 'log habit', 'mark habit', 'habit done', 'aaj ka habit', 'ho gaya', 'हो गया']),
          save_logs: [...PHRASES.save],
          go_home: [...PHRASES.home],
          go_progress: phrases(['progress', 'show progress', 'kitne din', 'report', 'प्रगति']),
        },
        tags: ['habits', 'daily'],
      },
      opts,
    );
  },
};
