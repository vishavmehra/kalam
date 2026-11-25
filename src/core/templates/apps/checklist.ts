import { z } from 'zod';
import { PHRASES, assembleSpec, baseParamsShape, extractBase, phrases, type KalamTemplate } from '../base';

const paramsSchema = z
  .object({
    ...baseParamsShape,
    /** Singular noun for one entry: "Task", "Item", "Chore". */
    itemLabel: z.string().trim().min(1).max(30),
    kind: z.enum(['todo', 'shopping', 'general']),
  })
  .strict();
export type ChecklistParams = z.infer<typeof paramsSchema>;

export const checklistTemplate: KalamTemplate<ChecklistParams> = {
  id: 'checklist',
  title: 'Checklist',
  description: 'A list you tick off, with a count of what is left.',
  strongKeywords: [
    'checklist', 'to do', 'todo', 'to-do', 'task list', 'shopping list', 'grocery list', 'packing list',
    'suchi', 'soochi', 'saman ki list', 'kaam ki list', 'सूची',
  ],
  keywords: [
    'checklist', 'to do', 'todo', 'task', 'tasks', 'list', 'tick', 'check off', 'shopping list', 'grocery',
    'groceries', 'packing', 'chores', 'suchi', 'soochi', 'kaam', 'saman', 'सूची',
  ],
  examples: ['A to-do checklist', 'Grocery shopping list I can tick off', 'ghar ke kaam ki suchi'],
  paramsSchema,
  defaults: { name: 'Checklist', theme: 'calm_green', itemLabel: 'Item', kind: 'general' },
  extractParams(text) {
    const out: Partial<ChecklistParams> = extractBase(text);
    const t = text.toLowerCase();
    if (/shopping|grocer|saman|samaan|sabzi|kirana|bazaar list/.test(t)) {
      out.kind = 'shopping'; out.itemLabel = 'Item'; out.name ??= 'Shopping list';
    } else if (/\bto-?do\b|\btasks?\b|\bkaam\b|\bchores?\b/.test(t)) {
      out.kind = 'todo'; out.itemLabel = /\bchores?\b/.test(t) ? 'Chore' : 'Task'; out.name ??= 'To-do list';
    } else if (/\bpacking\b/.test(t)) {
      out.itemLabel = 'Item'; out.name ??= 'Packing list';
    }
    return out;
  },
  build(p, opts) {
    const noun = p.itemLabel;
    const lower = noun.toLowerCase();
    return assembleSpec(
      {
        templateId: 'checklist',
        name: p.name,
        description: `Add ${lower}s, tick them off and see how many are left.`,
        glyph: p.kind === 'shopping' ? 'shopping_cart' : p.kind === 'todo' ? 'check' : 'list',
        theme: p.theme,
        collections: {
          items: {
            label: `${noun}s`,
            fields: {
              title: { type: 'text', label: noun, required: true, maxLength: 120 },
              done: { type: 'boolean', label: 'Done', defaultValue: false },
            },
          },
        },
        screens: [
          {
            id: 'home',
            title: p.name.slice(0, 60),
            children: [
              { id: 'remaining', type: 'stat', label: 'Left to do', expr: 'count(filter(items, done == false))', format: 'integer' },
              { id: 'completed', type: 'stat', label: 'Done', expr: 'count(filter(items, done == true))', format: 'integer', secondary: true },
              {
                id: 'item_list', type: 'list', label: `${noun}s`, source: 'items', primary: 'title', toggleField: 'done',
                allowDelete: true, emptyText: `No ${lower}s yet. Add your first one.`,
              },
              { id: 'add_button', type: 'bigButton', label: `Add ${lower}`, action: 'go_add', tone: 'primary' },
            ],
          },
          {
            id: 'add',
            title: `New ${lower}`,
            form: 'items',
            children: [
              { id: 'title_input', type: 'textInput', label: noun, field: 'title', required: true, placeholder: p.kind === 'shopping' ? 'e.g. Milk' : 'What needs doing?' },
              { id: 'save_button', type: 'bigButton', label: `Save ${lower}`, action: 'save_items', tone: 'primary' },
              { id: 'back_button', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
        ],
        actions: {
          go_add: { type: 'navigate', screen: 'add' },
          go_home: { type: 'navigate', screen: 'home' },
          save_items: { type: 'insert', collection: 'items', then: { feedback: `${noun} added`, navigate: 'home' } },
        },
        intents: {
          go_add: phrases([`add ${lower}`, `new ${lower}`, 'add to list', 'naya jodo', 'list mein jodo', 'नया जोड़ो']),
          save_items: [...PHRASES.save],
          go_home: [...PHRASES.home],
        },
        tags: ['checklist', p.kind],
      },
      opts,
    );
  },
};
