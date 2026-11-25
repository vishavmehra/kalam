import { z } from 'zod';
import type { KalamComponent } from '../../spec/schema';
import {
  PHRASES, assembleSpec, baseParamsShape, cleanOptions, crudActions, extractBase, labelList, phrases, type KalamTemplate,
} from '../base';
import { CURRENCY_SYMBOLS, extractCurrency, extractList } from '../extract';

const paramsSchema = z
  .object({
    ...baseParamsShape,
    currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']),
    categories: labelList(12),
  })
  .strict();
export type ExpenseTrackerParams = z.infer<typeof paramsSchema>;

export const expenseTrackerTemplate: KalamTemplate<ExpenseTrackerParams> = {
  id: 'expense_tracker',
  title: 'Expense tracker',
  description: 'Write down what you spend. See totals for today, this month, all time and each category.',
  strongKeywords: [
    'expense', 'expenses', 'expenditure', 'spending', 'kharcha', 'kharche', 'kharch', 'hisaab', 'hisab',
    'budget', 'spent', 'खर्चा', 'खर्च', 'हिसाब',
  ],
  keywords: [
    'expense', 'expenditure', 'spending', 'spend', 'spent', 'money', 'budget', 'kharcha', 'kharch', 'hisaab',
    'hisab', 'paisa', 'paise', 'rupees', 'udhaar', 'khata', 'bills', 'cost', 'खर्चा', 'हिसाब',
  ],
  examples: [
    'Make a simple application to record my daily expenses in rupees',
    'Expense tracker with categories food, travel and rent',
    'roz ka kharcha likhne ka app',
  ],
  paramsSchema,
  defaults: {
    name: 'Expenses', theme: 'calm_green', currency: 'INR',
    categories: ['Food', 'Travel', 'Bills', 'Shopping', 'Health', 'Other'],
  },
  extractParams(text) {
    const out: Partial<ExpenseTrackerParams> = extractBase(text);
    const currency = extractCurrency(text);
    if (currency) out.currency = currency;
    const categories = extractList(text, ['categories', 'category', 'types', 'heads', 'for things like']);
    if (categories) out.categories = categories;
    if (!out.name && /\bkharch|खर्च/i.test(text)) out.name = 'Kharcha';
    return out;
  },
  build(p, opts) {
    const money = { format: 'currency', currency: p.currency } as const;
    const symbol = CURRENCY_SYMBOLS[p.currency];
    const categories = cleanOptions(p.categories, 'Other');
    const inputs: KalamComponent[] = [
      { id: 'amount_input', type: 'number', label: `Amount (${symbol})`, field: 'amount', required: true, placeholder: '0' },
      { id: 'category_input', type: 'choice', label: 'Category', field: 'category', required: true },
      { id: 'date_input', type: 'date', label: 'Date', field: 'date', required: true },
      { id: 'note_input', type: 'textInput', label: 'Note', field: 'note', placeholder: 'What was it for?' },
    ];
    const perCategory = categories.slice(0, 10).map<KalamComponent>((c, i) => ({
      id: `category_total_${i + 1}`, type: 'stat', label: c,
      expr: `sum(filter(expenses, category == '${c}').amount)`, ...money,
    }));
    return assembleSpec(
      {
        templateId: 'expense_tracker',
        name: p.name,
        description: `Record daily spending in ${p.currency} by category, with totals that work offline.`,
        glyph: 'wallet',
        theme: p.theme,
        collections: {
          expenses: {
            label: 'Expenses',
            fields: {
              amount: { type: 'number', label: 'Amount', required: true, min: 0, unit: symbol, decimals: 2 },
              category: {
                type: 'enum', label: 'Category', required: true, options: categories,
                defaultValue: categories.includes('Other') ? 'Other' : categories[0],
              },
              date: { type: 'date', label: 'Date', required: true, defaultValue: 'today' },
              note: { type: 'text', label: 'Note', maxLength: 200 },
            },
          },
        },
        screens: [
          {
            id: 'home',
            title: p.name.slice(0, 60),
            children: [
              { id: 'spent_today', type: 'stat', label: 'Spent today', expr: 'sum(filter(expenses, date == today).amount)', ...money },
              {
                id: 'spent_month', type: 'stat', label: 'This month',
                expr: 'sum(filter(expenses, month(date) == month(today)).amount)', ...money,
              },
              { id: 'spent_total', type: 'stat', label: 'Total spent', expr: 'sum(expenses.amount)', ...money },
              { id: 'entry_count', type: 'stat', label: 'Entries', expr: 'count(expenses)', format: 'integer', secondary: true },
              { id: 'add_button', type: 'bigButton', label: 'Add expense', action: 'go_add', tone: 'primary' },
              {
                id: 'expense_list', type: 'list', label: 'Recent', source: 'expenses', primary: 'category', secondary: 'amount',
                sort: { field: 'date', direction: 'desc' }, limit: 100, detailScreen: 'expense',
                emptyText: 'No expenses yet. Tap “Add expense” to record one.',
              },
              { id: 'summary_button', type: 'bigButton', label: 'Totals by category', action: 'go_summary', tone: 'secondary' },
            ],
          },
          {
            id: 'add', title: 'Add expense', form: 'expenses',
            children: [
              ...inputs,
              { id: 'save_button', type: 'bigButton', label: 'Save expense', action: 'save_expenses', tone: 'primary' },
              { id: 'cancel_button', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
          {
            id: 'expense', title: 'Expense', form: 'expenses',
            children: [
              ...inputs.map((c) => ({ ...c, id: `edit_${c.id}` })),
              { id: 'update_button', type: 'bigButton', label: 'Save changes', action: 'update_expenses', tone: 'primary' },
              { id: 'delete_button', type: 'bigButton', label: 'Delete expense', action: 'delete_expenses', tone: 'danger' },
              { id: 'detail_back', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
          {
            id: 'summary', title: 'By category',
            children: [
              { id: 'summary_total', type: 'stat', label: 'All categories', expr: 'sum(expenses.amount)', ...money },
              ...perCategory,
              { id: 'summary_back', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
        ],
        actions: { ...crudActions('expenses', 'Expense', 'home', 'add'), go_summary: { type: 'navigate', screen: 'summary' } },
        intents: {
          go_add: phrases(['add expense', 'new expense', 'kharcha jodo', 'naya kharcha', 'kharcha likho', 'खर्चा जोड़ो', 'नया खर्चा']),
          save_expenses: [...PHRASES.save],
          update_expenses: [...PHRASES.update],
          delete_expenses: [...PHRASES.remove],
          go_home: [...PHRASES.home],
          go_summary: phrases(['summary', 'report', 'by category', 'totals', 'hisaab dikhao', 'kitna kharcha hua', 'हिसाब दिखाओ']),
        },
        tags: ['expenses', 'money', p.currency.toLowerCase()],
      },
      opts,
    );
  },
};
