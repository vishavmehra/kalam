/**
 * Health and home apps. The health apps record what the person types and nothing else: they give no advice and are
 * not medical record systems (docs/14 §20.2), and their first page says so in plain words.
 */
import type { CatalogEntry } from '../types';
import { fld, type TableAppDef } from '../builder';
import { AUTHOR, row, rupees, tableEntry } from './helpers';

/** Shown on the first page of every app that holds personal health details. */
export const HEALTH_NOTES = ['This app gives no medical advice.', 'It is not a medical record system.'];

const medicine: TableAppDef = {
  id: 'medicine_tracker',
  name: 'Medicine Tracker',
  description: 'Your medicines and the times of day to take them. Mark each dose as taken or missed.',
  glyph: 'pill', theme: 'ocean_blue', author: AUTHOR,
  tags: ['medicine', 'health', 'dawai'],
  accessibility: { summary: 'A medicine list. Open a medicine and mark a dose as taken or missed. It shows how many doses you took today.', suggestedModes: ['large', 'readAloud'] },
  note: HEALTH_NOTES,
  stats: [
    { id: 'active_medicines', label: 'Medicines in use', format: 'integer', expr: 'count(filter(medicines, active == true))' },
    { id: 'taken_today', label: 'Taken today', format: 'integer', expr: 'count(filter(doses, date == today && taken == true))' },
    { id: 'missed_today', label: 'Missed today', format: 'integer', expr: 'count(filter(doses, date == today && taken == false))' },
  ],
  tables: [
    {
      id: 'medicines', label: 'Medicines', noun: 'medicine', addLabel: 'Add medicine',
      fields: {
        name: fld.text('Medicine', { required: true }),
        dose: fld.text('How much, for example 1 tablet'),
        time_of_day: fld.pick('When', ['Morning', 'Afternoon', 'Evening', 'Night'], { required: true, defaultValue: 'Morning' }),
        active: fld.yes('Still taking it', true),
        note: fld.text('Note', { multiline: true }),
      },
      primary: 'name', secondary: 'time_of_day', sort: { field: 'name', direction: 'asc' },
      lists: [{ label: 'Your medicines', filter: 'active == true', emptyText: 'No medicines yet. Tap “Add medicine”.' }],
      stats: [
        { id: 'medicine_today', label: 'Taken today', format: 'integer', expr: 'count(filter(doses, medicine == selected && date == today && taken == true))' },
        { id: 'medicine_streak', label: 'Days in a row', format: 'integer', secondary: true, expr: 'streak(filter(doses, medicine == selected && taken == true).date)' },
      ],
      deleteConfirm: 'Delete this medicine and its dose history? This cannot be undone.',
      voice: { add: ['naya medicine', 'नई दवा'] },
    },
    {
      id: 'doses', label: 'Doses', noun: 'dose', addLabel: 'Mark a dose',
      fields: {
        medicine: fld.link('Medicine', 'medicines', 'name', { onDelete: 'cascade' }),
        date: fld.date('Date', { required: true, today: true }),
        taken: fld.yes('Taken', true),
        note: fld.text('Note'),
      },
      primary: 'medicine', secondary: 'date', sort: { field: 'date', direction: 'desc' },
      lists: [{ label: 'Today', filter: 'date == today', emptyText: 'No dose marked today.' }],
      under: { primary: 'date', secondary: 'taken', label: 'Dose history' },
      voice: { add: ['mark dose', 'dose taken', 'दवा ली'] },
    },
  ],
};

const appointments: TableAppDef = {
  id: 'appointment_tracker',
  name: 'Appointment Tracker',
  description: 'Who is coming and when. See today’s appointments first and mark each one done, cancelled or missed.',
  glyph: 'calendar', theme: 'ocean_blue', author: AUTHOR,
  tags: ['appointments', 'clinic', 'bookings'],
  accessibility: { summary: 'An appointment book. Today’s appointments are listed first.', suggestedModes: ['large'] },
  note: HEALTH_NOTES,
  stats: [
    { id: 'today_booked', label: 'Booked today', format: 'integer', expr: "count(filter(appointments, date == today && status == 'Booked'))" },
    { id: 'coming_up', label: 'Coming up', format: 'integer', expr: "count(filter(appointments, date > today && status == 'Booked'))" },
    { id: 'done_month', label: 'Done this month', format: 'integer', secondary: true, expr: "count(filter(appointments, status == 'Done' && month(date) == month(today)))" },
  ],
  tables: [{
    id: 'appointments', label: 'Appointments', noun: 'appointment', addLabel: 'Book appointment',
    fields: {
      person: fld.text('Name', { required: true }),
      date: fld.date('Date', { required: true, today: true }),
      at: fld.text('Time, for example 10:30'),
      reason: fld.text('Reason'),
      status: fld.pick('Status', ['Booked', 'Done', 'Cancelled', 'Did not come'], { required: true, defaultValue: 'Booked' }),
    },
    primary: 'person', secondary: 'at',
    lists: [
      { label: 'Today', filter: 'date == today', sort: { field: 'at', direction: 'asc' }, emptyText: 'No appointments today.' },
      { label: 'Coming up', filter: "date > today && status == 'Booked'", sort: { field: 'date', direction: 'asc' }, limit: 30 },
    ],
    setTo: { field: 'status', value: 'Done', label: 'Mark done', feedback: 'Marked as done' },
    voice: { add: ['book appointment', 'new appointment', 'नया अपॉइंटमेंट'] },
  }],
};

const visits: TableAppDef = {
  id: 'visit_register',
  name: 'Visit Register',
  description: 'A simple log of who came, why, any note you want to keep and when to follow up.',
  glyph: 'clipboard', theme: 'calm_green', currency: 'INR', author: AUTHOR,
  tags: ['visits', 'clinic', 'register'],
  accessibility: { summary: 'A register of visits with a short note and an optional follow-up date.', suggestedModes: [] },
  note: HEALTH_NOTES,
  stats: [
    { id: 'visits_today', label: 'Visits today', format: 'integer', expr: 'count(filter(visits, date == today))' },
    { id: 'visits_month', label: 'Visits this month', format: 'integer', expr: 'count(filter(visits, month(date) == month(today)))' },
    { id: 'fees_month', label: 'Fees this month', ...rupees, secondary: true, expr: 'sum(filter(visits, month(date) == month(today)).fee)' },
  ],
  tables: [{
    id: 'visits', label: 'Visits', noun: 'visit', addLabel: 'Add visit',
    fields: {
      person: fld.text('Name', { required: true }),
      date: fld.date('Date', { required: true, today: true }),
      reason: fld.text('Reason for visit'),
      notes: fld.text('Notes', { multiline: true }),
      fee: fld.num('Fee', { unit: '₹', decimals: 2 }),
      follow_up: fld.date('Follow up on'),
    },
    primary: 'person', secondary: 'reason', sort: { field: 'date', direction: 'desc' },
    lists: [{ label: 'Latest visits', limit: 40 }],
    voice: { add: ['new visit', 'visit likho', 'नई विज़िट'] },
  }],
};

const followups: TableAppDef = {
  id: 'followup_list',
  name: 'Follow-up List',
  description: 'People to check in with and the date to do it. Tick them off, and get a reminder the day before.',
  glyph: 'bell', theme: 'soft_lavender', author: AUTHOR,
  tags: ['follow up', 'clinic', 'reminders'],
  accessibility: { summary: 'A follow-up list. Each person has a due date, and you tick them off when you have checked in.', suggestedModes: ['large'] },
  note: HEALTH_NOTES,
  stats: [
    { id: 'due_today', label: 'Due today', format: 'integer', expr: 'count(filter(followups, due == today && done == false))' },
    { id: 'overdue', label: 'Overdue', format: 'integer', expr: 'count(filter(followups, due < today && done == false))' },
    { id: 'still_open', label: 'Still open', format: 'integer', secondary: true, expr: 'count(filter(followups, done == false))' },
  ],
  extras: [
    { id: 'followup_reminder', type: 'reminder', label: 'Remind me the day before', source: 'followups', dateField: 'due', leadDays: 1, time: '09:00', doneField: 'done', titleField: 'person', message: 'Follow up with {title} tomorrow' },
  ],
  tables: [{
    id: 'followups', label: 'Follow-ups', noun: 'follow-up', addLabel: 'Add follow-up',
    fields: {
      person: fld.text('Name', { required: true }),
      due: fld.date('Follow up on', { required: true, today: true }),
      reason: fld.text('Reason'),
      done: fld.yes('Done'),
    },
    primary: 'person', secondary: 'due',
    lists: [
      { label: 'To do', filter: 'done == false', sort: { field: 'due', direction: 'asc' }, toggleField: 'done', emptyText: 'Nobody to follow up with.' },
      { label: 'Done', filter: 'done == true', sort: { field: 'due', direction: 'desc' }, limit: 20, toggleField: 'done' },
    ],
    setTo: { field: 'done', value: true, label: 'Mark done', feedback: 'Marked as done' },
    voice: { add: ['new follow up', 'नया फॉलो अप'] },
  }],
};

const budget: TableAppDef = {
  id: 'household_budget',
  name: 'Household Budget',
  description: 'Money in and money out for the home. See what is left this month and where it went.',
  glyph: 'home', theme: 'calm_green', currency: 'INR', author: AUTHOR,
  tags: ['budget', 'home', 'expenses', 'income'],
  accessibility: { summary: 'A household budget. It shows income, spending and what is left this month, and spending by category.', suggestedModes: [] },
  stats: [
    { id: 'income_month', label: 'Income this month', ...rupees, expr: "sum(filter(entries, kind == 'Income' && month(date) == month(today)).amount)" },
    { id: 'spent_month', label: 'Spent this month', ...rupees, expr: "sum(filter(entries, kind == 'Expense' && month(date) == month(today)).amount)" },
    { id: 'left_month', label: 'Left this month', ...rupees, expr: "sum(filter(entries, kind == 'Income' && month(date) == month(today)).amount) - sum(filter(entries, kind == 'Expense' && month(date) == month(today)).amount)" },
  ],
  extras: [
    {
      id: 'spend_chart', type: 'chart', label: 'Spending by category', chart: 'donut', source: 'entries', metric: 'sum', valueField: 'amount',
      groupBy: 'category', dateField: 'date', range: { last: 1, unit: 'month' }, filters: [{ field: 'kind', operator: 'equals', value: 'Expense' }],
    },
  ],
  tables: [{
    id: 'entries', label: 'Entries', noun: 'entry', addLabel: 'Add entry',
    fields: {
      kind: fld.pick('Income or expense', ['Income', 'Expense'], { required: true, defaultValue: 'Expense' }),
      category: fld.pick('Category', ['Groceries', 'Rent', 'Bills', 'School', 'Health', 'Travel', 'Fun', 'Other'], { required: true, defaultValue: 'Groceries' }),
      amount: fld.num('Amount', { required: true, unit: '₹', decimals: 2 }),
      date: fld.date('Date', { required: true, today: true }),
      note: fld.text('Note'),
    },
    primary: 'category', secondary: 'amount', sort: { field: 'date', direction: 'desc' },
    lists: [{ label: 'Latest entries', limit: 40 }],
    voice: { add: ['add expense', 'add income', 'kharcha jodo', 'खर्चा जोड़ो'] },
  }],
};

export const HEALTH_HOME_ENTRIES: CatalogEntry[] = [
  tableEntry(medicine, {
    category: 'health',
    keywords: ['medicine', 'medicines', 'tablets', 'pills', 'dose', 'dawai', 'dawa', 'taken', 'दवा', 'दवाई'],
    records: {
      medicines: [
        row({ name: 'Vitamin D', dose: '1 tablet', time_of_day: 'Morning', active: true }, 'vitd'),
        row({ name: 'Calcium', dose: '1 tablet', time_of_day: 'Night', active: true }, 'calcium'),
        row({ name: 'Cough syrup', dose: '2 spoons', time_of_day: 'Evening', active: false }, 'syrup'),
      ],
      doses: [
        row({ medicine: '>vitd', date: '~-2', taken: true }), row({ medicine: '>vitd', date: '~-1', taken: true }),
        row({ medicine: '>calcium', date: '~-1', taken: false, note: 'Fell asleep early' }),
        row({ medicine: '>vitd', date: '~0', taken: true }),
      ],
    },
  }),
  tableEntry(appointments, {
    category: 'health',
    keywords: ['appointment', 'appointments', 'booking', 'bookings', 'clinic', 'doctor', 'patients', 'schedule', 'अपॉइंटमेंट'],
    records: {
      appointments: [
        row({ person: 'Sample Person A', date: '~0', at: '10:00', reason: 'Check-up', status: 'Booked' }),
        row({ person: 'Sample Person B', date: '~0', at: '11:30', reason: 'Follow-up', status: 'Done' }),
        row({ person: 'Sample Person C', date: '~+1', at: '09:30', reason: 'First visit', status: 'Booked' }),
        row({ person: 'Sample Person D', date: '~-2', at: '16:00', reason: 'Check-up', status: 'Did not come' }),
      ],
    },
  }),
  tableEntry(visits, {
    category: 'health',
    keywords: ['visit', 'visits', 'register', 'clinic', 'walk in', 'visitor', 'consultation', 'विज़िट'],
    records: {
      visits: [
        row({ person: 'Sample Person A', date: '~-3', reason: 'Check-up', notes: 'Asked to come back in a week', fee: 300, follow_up: '~+4' }),
        row({ person: 'Sample Person B', date: '~-1', reason: 'Follow-up', fee: 200 }),
        row({ person: 'Sample Person C', date: '~0', reason: 'First visit', fee: 300, follow_up: '~+14' }),
      ],
    },
  }),
  tableEntry(followups, {
    category: 'health',
    keywords: ['follow up', 'follow-up', 'check in', 'recall', 'clinic', 'callback', 'reminders', 'फॉलो अप'],
    records: {
      followups: [
        row({ person: 'Sample Person A', due: '~0', reason: 'Ask how the week went', done: false }),
        row({ person: 'Sample Person B', due: '~-2', reason: 'Remind about the next visit', done: false }),
        row({ person: 'Sample Person C', due: '~+5', reason: 'Check in', done: false }),
        row({ person: 'Sample Person D', due: '~-4', reason: 'Check in', done: true }),
      ],
    },
  }),
  tableEntry(budget, {
    category: 'home',
    keywords: ['budget', 'household', 'home budget', 'income', 'expenses', 'monthly', 'savings', 'ghar ka hisaab', 'बजट'],
    records: {
      entries: [
        row({ kind: 'Income', category: 'Other', amount: 42000, date: '^0', note: 'Salary' }),
        row({ kind: 'Expense', category: 'Rent', amount: 12000, date: '^1' }),
        row({ kind: 'Expense', category: 'Groceries', amount: 3400, date: '^2' }),
        row({ kind: 'Expense', category: 'Bills', amount: 2100, date: '^3', note: 'Electricity and internet' }),
        row({ kind: 'Expense', category: 'School', amount: 4500, date: '^4' }),
        row({ kind: 'Expense', category: 'Fun', amount: 900, date: '^5' }),
        row({ kind: 'Expense', category: 'Groceries', amount: 1250, date: '~0' }),
      ],
    },
  }),
];
