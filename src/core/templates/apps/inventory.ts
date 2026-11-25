import { z } from 'zod';
import type { KalamComponent, KalamField } from '../../spec/schema';
import {
  PHRASES, assembleSpec, baseParamsShape, cleanOptions, crudActions, extractBase, labelList, phrases, type KalamTemplate,
} from '../base';
import { CURRENCY_SYMBOLS, extractCurrency, extractList, extractNumberAfter } from '../extract';

const paramsSchema = z
  .object({
    ...baseParamsShape,
    units: labelList(10),
    reorderLevel: z.number().int().min(0).max(100_000),
    includePrice: z.boolean(),
    currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']),
  })
  .strict();
export type InventoryParams = z.infer<typeof paramsSchema>;

export const inventoryTemplate: KalamTemplate<InventoryParams> = {
  id: 'inventory',
  title: 'Inventory',
  description: 'Stock register with quantities, units, reorder levels and a low-stock alert list.',
  strongKeywords: ['inventory', 'stock', 'stock register', 'godown', 'warehouse', 'maal', 'stock list', 'स्टॉक', 'माल'],
  keywords: [
    'inventory', 'stock', 'godown', 'warehouse', 'items in stock', 'quantity', 'qty', 'reorder', 'low stock',
    'products', 'shop', 'dukaan', 'dukan', 'store', 'maal', 'saman', 'kirana', 'स्टॉक', 'दुकान',
  ],
  examples: ['Inventory app for my shop with low stock alerts', 'dukaan ka stock register', 'Track stock of items in kg and pieces'],
  paramsSchema,
  defaults: {
    name: 'Stock', theme: 'minimal_neutral', units: ['pcs', 'kg', 'litre', 'packet', 'box'],
    reorderLevel: 5, includePrice: true, currency: 'INR',
  },
  extractParams(text) {
    const out: Partial<InventoryParams> = extractBase(text);
    const units = extractList(text, ['units', 'unit', 'measured in'], 10);
    if (units) out.units = units;
    const level = extractNumberAfter(text, ['reorder level', 'reorder at', 'alert below', 'below', 'less than', 'minimum']);
    if (level !== undefined && Number.isInteger(level)) out.reorderLevel = level;
    if (/\bno price|without price/i.test(text)) out.includePrice = false;
    const currency = extractCurrency(text);
    if (currency) out.currency = currency;
    if (!out.name && /\bdukaa?n\b|दुकान/i.test(text)) out.name = 'Dukaan stock';
    return out;
  },
  build(p, opts) {
    const units = cleanOptions(p.units, 'pcs');
    const symbol = CURRENCY_SYMBOLS[p.currency];
    const fields: Record<string, KalamField> = {
      name: { type: 'text', label: 'Item name', required: true, maxLength: 80 },
      qty: { type: 'number', label: 'Quantity in stock', required: true, min: 0, defaultValue: 0, decimals: 2 },
      unit: { type: 'enum', label: 'Unit', options: units, defaultValue: units[0] },
      reorder_level: { type: 'number', label: 'Reorder when at or below', min: 0, defaultValue: p.reorderLevel },
    };
    const inputs: KalamComponent[] = [
      { id: 'name_input', type: 'textInput', label: 'Item name', field: 'name', required: true },
      { id: 'qty_input', type: 'number', label: 'Quantity in stock', field: 'qty', required: true },
      { id: 'unit_input', type: 'choice', label: 'Unit', field: 'unit' },
      { id: 'reorder_input', type: 'number', label: 'Reorder when at or below', field: 'reorder_level' },
    ];
    if (p.includePrice) {
      fields.price = { type: 'number', label: 'Price per unit', min: 0, unit: symbol, decimals: 2 };
      inputs.push({ id: 'price_input', type: 'number', label: `Price per unit (${symbol})`, field: 'price' });
    }
    return assembleSpec(
      {
        templateId: 'inventory',
        name: p.name,
        description: 'Know what is in stock and what needs reordering, even offline.',
        glyph: 'package',
        theme: p.theme,
        collections: { products: { label: 'Items', fields } },
        screens: [
          {
            id: 'home',
            title: p.name.slice(0, 60),
            children: [
              { id: 'item_count', type: 'stat', label: 'Items', expr: 'count(products)', format: 'integer' },
              { id: 'low_stock_count', type: 'stat', label: 'Need reordering', expr: 'count(filter(products, qty <= reorder_level))', format: 'integer' },
              { id: 'add_button', type: 'bigButton', label: 'Add item', action: 'go_add', tone: 'primary' },
              {
                id: 'low_stock_list', type: 'list', label: 'Low stock', source: 'products', primary: 'name', secondary: 'qty',
                filter: 'qty <= reorder_level', sort: { field: 'qty', direction: 'asc' }, detailScreen: 'product',
                emptyText: 'Nothing needs reordering.',
              },
              {
                id: 'all_items_list', type: 'list', label: 'All items', source: 'products', primary: 'name', secondary: 'qty',
                sort: { field: 'name', direction: 'asc' }, detailScreen: 'product', emptyText: 'No items yet. Add your first one.',
              },
            ],
          },
          {
            id: 'add', title: 'Add item', form: 'products',
            children: [
              ...inputs,
              { id: 'save_button', type: 'bigButton', label: 'Save item', action: 'save_products', tone: 'primary' },
              { id: 'cancel_button', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
          {
            id: 'product', title: 'Item', form: 'products',
            children: [
              ...inputs.map((c) => ({ ...c, id: `edit_${c.id}` })),
              { id: 'update_button', type: 'bigButton', label: 'Save changes', action: 'update_products', tone: 'primary' },
              { id: 'delete_button', type: 'bigButton', label: 'Delete item', action: 'delete_products', tone: 'danger' },
              { id: 'detail_back', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
        ],
        actions: crudActions('products', 'Item', 'home', 'add'),
        intents: {
          go_add: phrases(['add item', 'new item', 'add stock', 'naya maal', 'maal jodo', 'नया माल']),
          save_products: [...PHRASES.save],
          update_products: phrases(PHRASES.update, ['stock update', 'stock badlo']),
          delete_products: [...PHRASES.remove],
          go_home: [...PHRASES.home],
        },
        tags: ['inventory', 'shop'],
      },
      opts,
    );
  },
};
