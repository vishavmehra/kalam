import { z } from 'zod';
import type { KalamComponent } from '../../spec/schema';
import { PHRASES, assembleSpec, baseParamsShape, extractBase, type KalamTemplate } from '../base';
import { CURRENCY_SYMBOLS, extractCurrency } from '../extract';

const OPERATIONS = ['add', 'subtract', 'multiply', 'divide'] as const;
type Operation = (typeof OPERATIONS)[number];

const paramsSchema = z
  .object({
    ...baseParamsShape,
    mode: z.enum(['basic', 'gst']),
    operations: z.array(z.enum(OPERATIONS)).min(1).max(4),
    gstRates: z.array(z.number().min(0).max(100)).min(1).max(6),
    currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']),
  })
  .strict();
export type CalculatorParams = z.infer<typeof paramsSchema>;

const OP_WORDS: Record<Operation, RegExp> = {
  add: /\b(?:add|addition|adding|plus|sum|total|jod|jodo|jodna)\b|जोड़/i,
  subtract: /\b(?:subtract|subtraction|minus|difference|ghata|ghatao|ghatana)\b|घटा/i,
  multiply: /\b(?:multiply|multiplication|times|product|guna|gunaa)\b|गुणा/i,
  divide: /\b(?:divide|division|divided|quotient|bhag|bhaag)\b|भाग/i,
};

const STAT: Record<Operation, { label: string; expr: string }> = {
  add: { label: 'Sum (a + b)', expr: 'form.a + form.b' },
  subtract: { label: 'Difference (a − b)', expr: 'form.a - form.b' },
  multiply: { label: 'Product (a × b)', expr: 'form.a * form.b' },
  divide: { label: 'Quotient (a ÷ b)', expr: "if(form.b == 0, 'Not defined', round(form.a / form.b, 6))" },
};

/** Maps the chosen rate label ("18%") to its number without relying on string coercion. */
function rateExpr(rates: readonly number[]): string {
  return rates.reduceRight<string>((acc, r) => `if(form.rate == '${r}%', ${r}, ${acc})`, '0');
}

export const calculatorTemplate: KalamTemplate<CalculatorParams> = {
  id: 'calculator',
  title: 'Calculator',
  description: 'Adds, subtracts, multiplies or divides two numbers, or works out GST and the total.',
  strongKeywords: ['calculator', 'calculate', 'calculation', 'gst', 'hisaab lagao', 'jod ghata', 'कैलकुलेटर'],
  keywords: [
    'calculator', 'calculate', 'calculation', 'gst', 'vat', 'tax', 'addition', 'subtraction', 'multiplication',
    'division', 'add', 'subtract', 'multiply', 'divide', 'arithmetic', 'math', 'sum', 'percentage', 'jod',
    'ghata', 'guna', 'bhag', 'hisaab lagao', 'jod ghata', 'कैलकुलेटर',
  ],
  examples: [
    'Make a calculator with addition, subtraction, multiplication and division',
    'GST calculator with 5, 12, 18 and 28 percent',
    'jod ghata guna bhag wala calculator banao',
  ],
  paramsSchema,
  defaults: {
    name: 'Calculator', theme: 'ocean_blue', mode: 'basic', operations: [...OPERATIONS],
    gstRates: [5, 12, 18, 28], currency: 'INR',
  },
  extractParams(text) {
    const out: Partial<CalculatorParams> = extractBase(text);
    const gst = /\bgst\b|\bvat\b|\btax\b|जीएसटी/i.test(text);
    if (gst) {
      out.mode = 'gst';
      out.name ??= 'GST Calculator';
      const rates = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|percent|pratishat|प्रतिशत)/gi)]
        .map((m) => Number(m[1]))
        .filter((n) => n >= 0 && n <= 100);
      const listed = [...new Set(rates)].slice(0, 6);
      if (listed.length) out.gstRates = listed;
    }
    const ops = OPERATIONS.filter((op) => OP_WORDS[op].test(text));
    if (!gst && ops.length) out.operations = ops;
    const currency = extractCurrency(text);
    if (currency) out.currency = currency;
    return out;
  },
  build(p, opts) {
    const symbol = CURRENCY_SYMBOLS[p.currency];
    const children: KalamComponent[] = [];
    if (p.mode === 'gst') {
      const rate = rateExpr(p.gstRates);
      children.push(
        { id: 'amount_input', type: 'number', label: `Amount before tax (${symbol})`, field: 'amount', placeholder: '0' },
        { id: 'rate_choice', type: 'choice', label: 'GST rate', field: 'rate', options: p.gstRates.map((r) => `${r}%`) },
        { id: 'gst_amount', type: 'stat', label: 'GST', expr: `round(form.amount * ${rate} / 100, 2)`, format: 'currency', currency: p.currency },
      );
      if (p.currency === 'INR') {
        children.push({
          id: 'cgst_sgst', type: 'stat', label: 'CGST and SGST (each)', expr: `round(form.amount * ${rate} / 200, 2)`,
          format: 'currency', currency: p.currency,
        });
      }
      children.push({
        id: 'total_amount', type: 'stat', label: 'Total with GST',
        expr: `round(form.amount + form.amount * ${rate} / 100, 2)`, format: 'currency', currency: p.currency,
      });
    } else {
      children.push(
        { id: 'first_number', type: 'number', label: 'First number (a)', field: 'a', placeholder: '0' },
        { id: 'second_number', type: 'number', label: 'Second number (b)', field: 'b', placeholder: '0' },
        ...p.operations.map<KalamComponent>((op) => ({ id: `${op}_result`, type: 'stat', ...STAT[op] })),
      );
    }
    children.push({ id: 'clear_button', type: 'bigButton', label: 'Clear', action: 'clear', tone: 'secondary' });
    return assembleSpec(
      {
        templateId: 'calculator',
        name: p.name,
        description: p.mode === 'gst'
          ? `Works out GST at ${p.gstRates.join('%, ')}% and the total. Works offline.`
          : `Type two numbers to see the ${p.operations.length === 4 ? 'four results' : 'results'}. Works offline.`,
        glyph: 'calculator',
        theme: p.theme,
        collections: {},
        screens: [{
          id: 'calculator',
          title: p.name.slice(0, 60),
          description: p.mode === 'gst' ? 'Enter an amount and pick a rate.' : 'Results update as you type.',
          children,
        }],
        actions: { clear: { type: 'clearForm' } },
        intents: { clear: [...PHRASES.clear] },
        tags: ['calculator', p.mode === 'gst' ? 'gst' : 'arithmetic'],
      },
      opts,
    );
  },
};
