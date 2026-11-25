/** Shared test fixtures (imported only by *.test.ts files). */
import type { StoredApp } from '../contracts';
import type { KalamSpec } from '../spec/schema';

/** A valid app with one collection and one AI block that claims on-device verification. */
export function fixtureSpec(id = 'app_expenses', name = 'Expenses'): KalamSpec {
  return {
    id,
    schemaVersion: '1.0.0',
    version: 1,
    name,
    lang: 'en',
    theme: { primary: '#315C4C', radius: 12, fontScale: 1 },
    collections: {
      expenses: {
        label: 'Expenses',
        fields: {
          title: { type: 'text', label: 'Title', required: true, maxLength: 40 },
          amount: { type: 'number', label: 'Amount', required: true, min: 0, max: 100000 },
          category: { type: 'enum', label: 'Category', options: ['Food', 'Travel'] },
          paid: { type: 'boolean', label: 'Paid' },
        },
      },
    },
    screens: [
      {
        id: 'home',
        title: name,
        form: 'expenses',
        children: [
          { id: 'title_input', type: 'textInput', label: 'Title', field: 'title' },
          { id: 'amount_input', type: 'number', label: 'Amount', field: 'amount' },
          { id: 'save', type: 'bigButton', label: 'Save', action: 'add_expense' },
          { id: 'all', type: 'list', source: 'expenses', primary: 'title', secondary: 'amount' },
          { id: 'cups', type: 'counter', label: 'Cups' },
        ],
      },
    ],
    initialScreen: 'home',
    actions: { add_expense: { type: 'insert', collection: 'expenses' } },
    aiBlocks: {
      sort_it: {
        kind: 'classify',
        prompt: 'Pick the category for this expense.',
        verified: 'onDevice',
        verification: { status: 'onDevice', testCount: 5, passCount: 5, model: 'gemini-nano' },
        labels: ['Food', 'Travel'],
        inputField: 'title',
        outputField: 'category',
      },
    },
    intents: {},
    meta: { createdAt: 1, generator: { route: 'cloud', provider: 'firebase', model: 'gemini-3.8-flash' } },
  };
}

export const fixtureApp = (spec: KalamSpec): StoredApp => ({
  id: spec.id, spec, createdAt: 1, updatedAt: 1, origin: { route: 'cloud', provider: 'firebase' },
  creationInput: { text: 'my private shop notes', modalities: ['text'] },
});

/** 1x1 transparent PNG. */
export const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
