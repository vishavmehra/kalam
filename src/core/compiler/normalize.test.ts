/**
 * IR normalisation before Zod (eval 2026-11-25: 26 of 42 cloud first passes failed, mostly on empty strings and
 * text past the limits the cloud response schema cannot carry). The raw answers of the failed cases were not
 * kept by that run, so this answer is t15's request with the faults the findings name: an empty aiBlock prompt,
 * thenFeedback over 120 characters, a long suffix, plus the empty and over-long values seen in the repaired cases.
 */
import { describe, expect, it } from 'vitest';
import { validateSpec } from '../spec/validate';
import { irToSpec } from './convert';
import { compilerIRSchema } from './ir';
import { normalizeIR } from './normalize';

/** t15-tailor-order-book: "Tailor order book with customer name, phone, dress type, delivery date and advance paid". */
const t15Answer = {
  name: '  Tailor Order Book  ',
  description: 'Keep every stitching order with the customer, the dress, the delivery date and the advance paid. '.repeat(4),
  lang: 'en',
  themePreset: 'warm_paper',
  icon: 'scissors',
  collections: [{
    id: 'orders', label: 'Orders', fields: [
      { id: 'customer_name', type: 'text', label: 'Customer name', required: true },
      { id: 'phone', type: 'text', label: 'Phone', unit: '' },
      { id: 'dress_type', type: 'enum', label: 'Dress type', options: ['Shirt', '', 'Kurta', 'Blouse'] },
      { id: 'delivery_date', type: 'date', label: 'Delivery date', defaultValue: '' },
      { id: 'advance', type: 'number', label: 'Advance paid', unit: 'rupees only', decimals: 1.6 },
    ],
  }],
  screens: [
    {
      id: 'home', title: 'Orders', description: null, components: [
        {
          id: 'advance_total', type: 'stat', label: 'Advance collected', expr: 'sum(orders.advance)', format: 'currency',
          currency: 'INR', suffix: 'collected from all customers so far',
        },
        { id: 'orders_list', type: 'list', label: 'Orders', source: 'orders', primary: 'customer_name', secondaryField: 'delivery_date', sortDirection: 'DESC', emptyText: '' },
        { id: 'add_button', type: 'bigButton', label: 'New order', action: 'go_add', tone: '' },
      ],
    },
    {
      id: 'add', title: 'New order', form: 'orders', components: [
        { id: 'name_input', type: 'textInput', label: 'Customer name', field: 'customer_name', placeholder: '' },
        { id: 'phone_input', type: 'textInput', label: 'Phone', field: 'phone' },
        { id: 'dress_input', type: 'choice', label: 'Dress type', field: 'dress_type' },
        { id: 'date_input', type: 'date', label: 'Delivery date', field: 'delivery_date' },
        { id: 'advance_input', type: 'number', label: `Advance paid ${'(rupees) '.repeat(20)}`, field: 'advance' },
        { id: 'save_button', type: 'bigButton', label: 'Save order', action: 'save_order' },
      ],
    },
  ],
  initialScreen: 'home',
  actions: [
    { id: 'go_add', type: 'navigate', screen: 'add' },
    {
      id: 'save_order', type: 'insert', collection: 'orders', thenNavigate: 'home',
      thenFeedback: 'Order saved successfully. The customer can collect the dress on the delivery date, and the advance paid is shown on the home screen.',
    },
  ],
  aiBlocks: [{ id: 'read_slip', kind: 'extractFromPhoto', prompt: '', target: 'orders' }],
  intents: [{ action: 'save_order', phrases: ['save', '', 'rakh do'] }],
  assumptions: Array.from({ length: 12 }, (_, i) => `Assumption ${i + 1}`),
};

describe('normalizeIR', () => {
  it('turns a t15-style cloud answer that Zod rejects into one it accepts, noting each change', () => {
    expect(compilerIRSchema.safeParse(t15Answer).success).toBe(false);
    const { value, notes } = normalizeIR(t15Answer);
    const parsed = compilerIRSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    expect(notes.some((n) => n.startsWith('actions[1].thenFeedback: shortened'))).toBe(true);
    expect(notes.some((n) => n.startsWith('screens[0].components[0].suffix: shortened'))).toBe(true);
    expect(notes.some((n) => n.startsWith('description: shortened'))).toBe(true);
    expect(notes.some((n) => n.startsWith('collections[0].fields[3].defaultValue: empty text removed'))).toBe(true);
    expect(notes.some((n) => n.startsWith('assumptions: cut from 12 to 10'))).toBe(true);
    expect(notes.some((n) => n.startsWith('collections[0].fields[4].decimals: rounded'))).toBe(true);
    expect(notes.some((n) => n.startsWith('screens[0].components[2].tone: unknown value'))).toBe(true);
    const ir = parsed.data!;
    expect(ir.name).toBe('Tailor Order Book');
    expect(ir.collections?.[0].fields[2].options).toEqual(['Shirt', 'Kurta', 'Blouse']);
    expect(ir.screens[0].components[1].sortDirection).toBe('desc'); // case fixed, not dropped
    expect(ir.intents?.[0].phrases).toEqual(['save', 'rakh do']);
  });

  it('gives a valid app, with the empty AI prompt replaced by a plain default', () => {
    const ir = compilerIRSchema.parse(normalizeIR(t15Answer).value);
    const v = validateSpec(irToSpec(ir, { appId: 'app_t15fix01', now: 1 }));
    expect(v.errors).toEqual([]);
    expect(v.spec?.aiBlocks.read_slip.prompt.length).toBeGreaterThan(0);
  });

  it('never invents values, never mutates its input, and leaves missing required values to Zod', () => {
    const raw = { name: 'x', screens: [{ id: 'home', components: [] }] };
    const copy = structuredClone(raw);
    const { value, notes } = normalizeIR(raw);
    expect(raw).toEqual(copy);
    expect(notes).toEqual([]);
    expect(compilerIRSchema.safeParse(value).success).toBe(false); // title is still missing
  });

  it('caps the notes so one long answer cannot flood the repair log', () => {
    const many = { name: 'x', screens: [{ id: 'home', title: 'Home', components: Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, type: 'text', label: 'x'.repeat(200), placeholder: '' })) }] };
    expect(normalizeIR(many).notes.length).toBeLessThanOrEqual(40);
  });
});
