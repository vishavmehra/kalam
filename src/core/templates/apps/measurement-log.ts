import { z } from 'zod';
import type { KalamComponent, KalamField } from '../../spec/schema';
import { PHRASES, assembleSpec, baseParamsShape, crudActions, extractBase, labelList, phrases, type KalamTemplate } from '../base';
import { extractList, extractUnit, toIdentifier } from '../extract';

const paramsSchema = z
  .object({
    ...baseParamsShape,
    measurements: labelList(20),
    unit: z.enum(['cm', 'in']),
    includePhone: z.boolean(),
  })
  .strict();
export type MeasurementLogParams = z.infer<typeof paramsSchema>;

const BODY_WORDS = ['chest', 'bust', 'waist', 'hip', 'shoulder', 'sleeve', 'length', 'neck', 'armhole', 'inseam', 'thigh', 'collar', 'bicep', 'wrist'];

export const measurementLogTemplate: KalamTemplate<MeasurementLogParams> = {
  id: 'measurement_log',
  title: 'Measurement log',
  description: 'Customer measurement book (tailoring, fitness) with dated records in cm or inches.',
  strongKeywords: ['measurement', 'measurements', 'naap', 'naap book', 'tailor', 'tailoring', 'darzi', 'boutique', 'नाप', 'दर्जी'],
  keywords: [
    'measurement', 'measurements', 'measure', 'naap', 'tailor', 'tailoring', 'darzi', 'boutique', 'stitching', 'silai',
    'chest', 'waist', 'sleeve', 'inches', 'cm', 'body', 'नाप', 'दर्जी',
  ],
  examples: ['Tailor measurement book with chest, waist and sleeve in inches', 'darzi ke liye naap likhne ka app'],
  paramsSchema,
  defaults: {
    name: 'Measurement book', theme: 'warm_paper', unit: 'in', includePhone: true,
    measurements: ['Chest', 'Waist', 'Hip', 'Shoulder', 'Sleeve', 'Length'],
  },
  extractParams(text) {
    const out: Partial<MeasurementLogParams> = extractBase(text);
    const listed = extractList(text, ['measurements', 'measurement', 'naap', 'measure'], 20);
    const t = text.toLowerCase();
    const body = BODY_WORDS.filter((w) => new RegExp(`\\b${w}s?\\b`).test(t)).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
    if (listed) out.measurements = listed;
    else if (body.length >= 2) out.measurements = body;
    const unit = extractUnit(text);
    if (unit) out.unit = unit;
    if (!out.name && /\btailor|darzi|दर्जी|boutique/i.test(text)) out.name = 'Tailor measurement book';
    return out;
  },
  build(p, opts) {
    const used = new Set<string>(['customer', 'phone', 'date', 'note']);
    const unitLabel = p.unit === 'cm' ? 'cm' : 'in';
    const fields: Record<string, KalamField> = {
      customer: { type: 'text', label: 'Customer name', required: true, maxLength: 80 },
    };
    const inputs: KalamComponent[] = [{ id: 'customer_input', type: 'textInput', label: 'Customer name', field: 'customer', required: true }];
    if (p.includePhone) {
      fields.phone = { type: 'text', label: 'Phone', maxLength: 20 };
      inputs.push({ id: 'phone_input', type: 'textInput', label: 'Phone', field: 'phone' });
    }
    for (const m of p.measurements.slice(0, 20)) {
      const id = toIdentifier(m, used, 'size');
      fields[id] = { type: 'number', label: m.slice(0, 60), min: 0, unit: unitLabel, decimals: 1 };
      inputs.push({ id: `${id}_input`, type: 'number', label: `${m.slice(0, 50)} (${unitLabel})`, field: id });
    }
    fields.date = { type: 'date', label: 'Date', required: true, defaultValue: 'today' };
    fields.note = { type: 'text', label: 'Note', multiline: true, maxLength: 500 };
    inputs.push(
      { id: 'date_input', type: 'date', label: 'Date', field: 'date', required: true },
      { id: 'note_input', type: 'textInput', label: 'Note', field: 'note', multiline: true, placeholder: 'Garment, fit, delivery…' },
    );
    return assembleSpec(
      {
        templateId: 'measurement_log',
        name: p.name,
        description: `Record ${p.measurements.length} measurements per customer in ${p.unit === 'cm' ? 'centimetres' : 'inches'}.`,
        glyph: 'ruler',
        theme: p.theme,
        collections: { measurements: { label: 'Measurements', fields } },
        screens: [
          {
            id: 'home',
            title: p.name.slice(0, 60),
            children: [
              { id: 'record_count', type: 'stat', label: 'Records', expr: 'count(measurements)', format: 'integer' },
              { id: 'today_count', type: 'stat', label: 'Taken today', expr: 'count(filter(measurements, date == today))', format: 'integer', secondary: true },
              { id: 'add_button', type: 'bigButton', label: 'New measurement', action: 'go_add', tone: 'primary' },
              {
                id: 'record_list', type: 'list', source: 'measurements', primary: 'customer', secondary: 'date',
                sort: { field: 'date', direction: 'desc' }, detailScreen: 'customer_record', emptyText: 'No measurements yet.',
              },
            ],
          },
          {
            id: 'add', title: 'New measurement', form: 'measurements',
            children: [
              ...inputs,
              { id: 'save_button', type: 'bigButton', label: 'Save measurements', action: 'save_measurements', tone: 'primary' },
              { id: 'cancel_button', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
          {
            id: 'customer_record', title: 'Measurements', form: 'measurements',
            children: [
              ...inputs.map((c) => ({ ...c, id: `edit_${c.id}` })),
              { id: 'update_button', type: 'bigButton', label: 'Save changes', action: 'update_measurements', tone: 'primary' },
              { id: 'delete_button', type: 'bigButton', label: 'Delete record', action: 'delete_measurements', tone: 'danger' },
              { id: 'detail_back', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
        ],
        actions: crudActions('measurements', 'Record', 'home', 'add'),
        intents: {
          go_add: phrases(['new measurement', 'take measurement', 'naya naap', 'naap lo', 'naap likho', 'नया नाप']),
          save_measurements: [...PHRASES.save],
          update_measurements: [...PHRASES.update],
          delete_measurements: [...PHRASES.remove],
          go_home: [...PHRASES.home],
        },
        tags: ['measurements', 'tailoring'],
      },
      opts,
    );
  },
};
