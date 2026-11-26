/**
 * Gallery entries built by the keyword-matched generators in src/core/templates/apps (the ones "Describe it" uses),
 * each with a fixed set of choices. A person who finds one in the gallery gets exactly what typing the same request
 * would have given them, without typing it.
 */
import type { KalamSpec } from '../../../spec/schema';
import type { BuildOpts } from '../../base';
import { getTemplate } from '../../index';
import type { CatalogCategory, CatalogEntry, SampleData } from '../types';
import { AUTHOR, row } from './helpers';

interface GeneratedMeta {
  id: string;
  generator: string;
  title: string;
  description: string;
  category: CatalogCategory;
  keywords: string[];
  summary: string;
  suggestedModes?: CatalogEntry['accessibility']['suggestedModes'];
  params: Record<string, unknown>;
  sample: SampleData;
}

function generated(m: GeneratedMeta): CatalogEntry {
  const template = (): NonNullable<ReturnType<typeof getTemplate>> => {
    const t = getTemplate(m.generator as Parameters<typeof getTemplate>[0]);
    if (!t) throw new Error(`Template engine "${m.generator}" is missing`);
    return t;
  };
  // The card's glyph and tint come from the generator's own first build. Reading them only when a card asks keeps
  // opening the app from building thirteen specs on import.
  let first: KalamSpec | undefined;
  const probe = (): KalamSpec => (first ??= template().build(template().paramsSchema.parse({ ...template().defaults, ...m.params }), { appId: 'app_preview', now: 0, lang: 'en' }));
  return {
    id: m.id,
    version: 1,
    title: m.title,
    description: m.description,
    category: m.category,
    lang: 'en',
    get glyph() { return probe().icon?.glyph ?? 'list'; },
    get theme() { return probe().theme.preset ?? 'calm_green'; },
    keywords: m.keywords,
    accessibility: { summary: m.summary, suggestedModes: m.suggestedModes ?? [] },
    requiredAI: [],
    author: AUTHOR,
    generator: m.generator,
    sample: m.sample,
    build(opts: BuildOpts): KalamSpec {
      const t = template();
      const params = t.paramsSchema.parse({ ...t.defaults, ...m.params });
      const spec = t.build(params, opts);
      return {
        ...spec,
        description: m.description.slice(0, 280),
        meta: { ...spec.meta, templateId: m.id, author: AUTHOR, description: m.description.slice(0, 280) },
        accessibility: { summary: m.summary, suggestedModes: m.suggestedModes ?? [] },
      };
    },
  };
}

export const GENERATED_ENTRIES: CatalogEntry[] = [
  generated({
    id: 'gst_calculator', generator: 'calculator', title: 'GST Calculator', category: 'shop',
    description: 'Type a price, pick a GST rate and see the tax and the total. Works with no signal.',
    keywords: ['gst', 'tax', 'calculator', 'invoice', 'bill', 'vat', 'जीएसटी', 'कैलकुलेटर'],
    summary: 'A GST calculator. Enter the price before tax and choose a rate to see the tax and the total price.',
    suggestedModes: ['large'],
    params: { name: 'GST Calculator', mode: 'gst', theme: 'soft_lavender' },
    sample: { form: { amount: 2400, rate: '18%' } },
  }),
  generated({
    id: 'tailor_book', generator: 'measurement_log', title: 'Tailor Book', category: 'shop',
    description: 'Keep every customer’s measurements in one book. Add chest, waist, sleeve and more, in inches.',
    keywords: ['tailor', 'measurements', 'measurement', 'naap', 'darzi', 'stitching', 'boutique', 'दर्जी', 'नाप'],
    summary: 'A book of customer measurements for a tailor, saved with the date and a note.',
    suggestedModes: ['large'],
    params: { name: 'Tailor Book', unit: 'in' },
    sample: {
      records: {
        measurements: [
          row({ customer: 'Meena Joshi', phone: '98xxxxxx21', chest: 36, waist: 30, hip: 38, shoulder: 14, sleeve: 22, length: 40, date: '~-8', note: 'Blouse, a little loose' }),
          row({ customer: 'Rahul Sharma', phone: '98xxxxxx22', chest: 40, waist: 34, hip: 40, shoulder: 17, sleeve: 25, length: 30, date: '~-12', note: 'Suit' }),
          row({ customer: 'Farah Khan', phone: '98xxxxxx23', chest: 38, waist: 32, hip: 40, shoulder: 15, sleeve: 23, length: 42, date: '~-1' }),
        ],
      },
    },
  }),
  generated({
    id: 'inventory_manager', generator: 'inventory', title: 'Inventory Manager', category: 'shop',
    description: 'What is in stock, what is running low and what to reorder. Add stock as it comes and goes.',
    keywords: ['inventory', 'stock', 'items', 'warehouse', 'reorder', 'dukaan', 'godown', 'स्टॉक', 'सामान'],
    summary: 'A stock list. It shows how many items you have and which ones are low enough to reorder.',
    params: { name: 'Inventory Manager', theme: 'minimal_neutral' },
    sample: {
      records: {
        products: [
          row({ name: 'Basmati rice', qty: 40, unit: 'kg', reorder_level: 10, price: 95 }),
          row({ name: 'Sunflower oil', qty: 4, unit: 'litre', reorder_level: 6, price: 150 }),
          row({ name: 'Tea leaves', qty: 12, unit: 'packet', reorder_level: 5, price: 80 }),
          row({ name: 'Soap', qty: 3, unit: 'pcs', reorder_level: 10, price: 30 }),
        ],
      },
    },
  }),
  generated({
    id: 'customer_records', generator: 'contact_book', title: 'Customer Records', category: 'work',
    description: 'Names, numbers and addresses of your customers, grouped as retail or wholesale, sorted A to Z.',
    keywords: ['customers', 'contacts', 'phone book', 'address book', 'clients', 'records', 'ग्राहक', 'संपर्क'],
    summary: 'A customer list with phone numbers, addresses and a group for each customer.',
    params: { name: 'Customer Records', theme: 'ocean_blue', groups: ['Retail', 'Wholesale', 'Online'], includeEmail: false, includeAddress: true },
    sample: {
      records: {
        contacts: [
          row({ name: 'Anil Traders', phone: '98xxxxxx03', address: 'Market Road', group: 'Wholesale' }),
          row({ name: 'Sunita Devi', phone: '98xxxxxx02', address: 'Lane 4', group: 'Retail', note: 'Prefers morning delivery' }),
          row({ name: 'Rohit Verma', phone: '98xxxxxx51', address: 'Sector 9', group: 'Online' }),
        ],
      },
    },
  }),
  generated({
    id: 'daily_task_list', generator: 'checklist', title: 'Daily Task List', category: 'work',
    description: 'A short list of what needs doing today. Tick things off as you go.',
    keywords: ['tasks', 'to do', 'todo', 'checklist', 'daily', 'work list', 'kaam', 'काम'],
    summary: 'A task list. Tick a task when it is done. It shows how many are left.',
    params: { name: 'Daily Task List', theme: 'calm_green', itemLabel: 'Task', kind: 'todo' },
    sample: {
      records: {
        items: [
          row({ title: 'Call the supplier', done: true }), row({ title: 'Send the invoice', done: false }),
          row({ title: 'Clean the shop front', done: false }), row({ title: 'Pay the electricity bill', done: false }),
        ],
      },
    },
  }),
  generated({
    id: 'grocery_list', generator: 'checklist', title: 'Grocery List', category: 'home',
    description: 'Write what to buy and tick it off in the shop. Nothing to sign in to.',
    keywords: ['grocery', 'shopping', 'shopping list', 'groceries', 'saman', 'sabzi', 'kirana', 'सामान', 'सब्ज़ी'],
    summary: 'A shopping list. Tick an item when you have bought it.',
    params: { name: 'Grocery List', theme: 'calm_green', itemLabel: 'Item', kind: 'shopping' },
    sample: {
      records: {
        items: [
          row({ title: 'Milk', done: true }), row({ title: 'Tomatoes', done: false }), row({ title: 'Atta, 5 kg', done: false }),
          row({ title: 'Green chillies', done: false }),
        ],
      },
    },
  }),
  generated({
    id: 'medicine_reminders', generator: 'reminder_list', title: 'Medicine Reminders', category: 'health',
    description: 'A list of doses with the date to take them. Tick each one when it is done.',
    keywords: ['medicine', 'reminders', 'dose', 'tablet', 'pills', 'dawai', 'dawa', 'दवा', 'दवाई'],
    summary: 'A list of medicine doses with due dates. It shows what is due today and what is overdue.',
    suggestedModes: ['large', 'readAloud'],
    params: { name: 'Medicine Reminders', theme: 'ocean_blue', itemLabel: 'Dose', includeNote: true },
    sample: {
      records: {
        reminders: [
          row({ title: 'Morning tablet', due: '~0', done: false, note: 'After breakfast' }),
          row({ title: 'Eye drops', due: '~-1', done: false }),
          row({ title: 'Evening tablet', due: '~0', done: true }),
          row({ title: 'Weekly vitamin', due: '~+3', done: false }),
        ],
      },
    },
  }),
  generated({
    id: 'bill_reminders', generator: 'reminder_list', title: 'Bill Reminders', category: 'home',
    description: 'Never miss a due date. Add each bill with its date and tick it off when it is paid.',
    keywords: ['bills', 'bill', 'due date', 'reminders', 'rent', 'electricity', 'recharge', 'bijli', 'बिल'],
    summary: 'A list of bills with due dates. It shows what is due today and what is overdue.',
    params: { name: 'Bill Reminders', theme: 'warm_paper', itemLabel: 'Bill', includeNote: true },
    sample: {
      records: {
        reminders: [
          row({ title: 'Electricity', due: '~+2', done: false }), row({ title: 'Phone recharge', due: '~-1', done: false, note: 'Plan ends this week' }),
          row({ title: 'House rent', due: '~+6', done: false }), row({ title: 'Water bill', due: '~-5', done: true }),
        ],
      },
    },
  }),
  generated({
    id: 'expense_tracker', generator: 'expense_tracker', title: 'Expense Tracker', category: 'personal',
    description: 'Write down what you spend. See totals for today, this month and each category.',
    keywords: ['expenses', 'expense', 'spending', 'kharcha', 'hisaab', 'money', 'budget', 'खर्चा', 'हिसाब'],
    summary: 'An expense tracker. Add what you spent and see the totals for today, this month and each category.',
    params: { name: 'Expense Tracker', theme: 'calm_green', currency: 'INR' },
    sample: {
      records: {
        expenses: [
          row({ amount: 180, category: 'Food', date: '~-3', note: 'Lunch' }), row({ amount: 60, category: 'Travel', date: '~-2', note: 'Auto' }),
          row({ amount: 1450, category: 'Bills', date: '~-1', note: 'Electricity' }), row({ amount: 240, category: 'Food', date: '~0' }),
        ],
      },
    },
  }),
  generated({
    id: 'habit_tracker', generator: 'habit_tracker', title: 'Habit Tracker', category: 'personal',
    description: 'Check in each day for the habits you want to build and watch the days add up.',
    keywords: ['habits', 'habit', 'routine', 'streak', 'daily', 'exercise', 'yoga', 'aadat', 'आदत'],
    summary: 'A habit tracker. Check in each day and see how many days you have kept each habit.',
    params: { name: 'Habit Tracker', theme: 'soft_lavender' },
    sample: {
      records: {
        logs: [
          row({ habit: 'Exercise', date: '~-2', done: true }), row({ habit: 'Read', date: '~-2', done: true }),
          row({ habit: 'Exercise', date: '~-1', done: true }), row({ habit: 'Drink water', date: '~-1', done: true }),
          row({ habit: 'Exercise', date: '~0', done: true }), row({ habit: 'Meditate', date: '~0', done: true }),
        ],
      },
    },
  }),
  generated({
    id: 'notes', generator: 'notes', title: 'Notes', category: 'personal',
    description: 'A plain notebook. Write a title and a note and find it again later.',
    keywords: ['notes', 'note', 'notebook', 'diary', 'journal', 'ideas', 'memo', 'नोट्स', 'डायरी'],
    summary: 'A notebook. Add a note with a title and open it again later to read or change it.',
    params: { name: 'Notes', theme: 'warm_paper' },
    sample: {
      records: {
        notes: [
          row({ title: 'Ideas for Diwali', body: 'New sweet box sizes. Ask the printer about new labels.', date: '~-4' }),
          row({ title: 'Things to ask the supplier', body: 'Rate for 50 kg bags. Delivery on Mondays.', date: '~-2' }),
          row({ title: 'Birthday gift ideas', body: 'A book, a plant or a lamp.', date: '~0' }),
        ],
      },
    },
  }),
  generated({
    id: 'mala_counter', generator: 'counter', title: 'Mala Counter', category: 'personal',
    description: 'One big button to count with. Set a target such as 108 and see how far is left.',
    keywords: ['counter', 'tally', 'mala', 'jaap', 'ginti', 'count', 'clicker', 'गिनती', 'माला'],
    summary: 'A counter with large plus, minus and reset buttons and a target.',
    suggestedModes: ['large'],
    params: { name: 'Mala Counter', theme: 'warm_paper', label: 'Mala count', target: 108 },
    sample: { state: { count: 27 } },
  }),
  generated({
    id: 'visitor_register', generator: 'simple_form', title: 'Visitor Register', category: 'work',
    description: 'Write down who came, why, and when. A simple register for a shop, office or home.',
    keywords: ['visitor', 'visitors', 'register', 'form', 'sign in', 'guests', 'entry', 'रजिस्टर'],
    summary: 'A visitor register. Add each visitor with their purpose and the date of the visit.',
    params: {
      name: 'Visitor Register', theme: 'minimal_neutral', recordLabel: 'Visit',
      fields: [
        { label: 'Visitor name', type: 'text', required: true }, { label: 'Purpose', type: 'text' },
        { label: 'Phone', type: 'text' }, { label: 'Visit date', type: 'date' },
      ],
    },
    sample: {
      records: {
        entries: [
          row({ visitor_name: 'Sample Visitor A', purpose: 'Delivery', phone: '98xxxxxx61', visit_date: '~-2' }),
          row({ visitor_name: 'Sample Visitor B', purpose: 'Meeting', phone: '98xxxxxx62', visit_date: '~-1' }),
          row({ visitor_name: 'Sample Visitor C', purpose: 'Repair work', phone: '98xxxxxx63', visit_date: '~0' }),
        ],
      },
    },
  }),
];
