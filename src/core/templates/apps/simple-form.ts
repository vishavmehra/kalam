import { z } from 'zod';
import type { KalamComponent, KalamField } from '../../spec/schema';
import { PHRASES, assembleSpec, baseParamsShape, crudActions, extractBase, phrases, type KalamTemplate } from '../base';
import { extractList, toIdentifier } from '../extract';

const fieldParamSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    type: z.enum(['text', 'number', 'date', 'boolean', 'enum']),
    options: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    required: z.boolean().optional(),
  })
  .strict();
type FieldParam = z.infer<typeof fieldParamSchema>;

const paramsSchema = z
  .object({
    ...baseParamsShape,
    /** Singular noun for one saved form: "Entry", "Registration", "Visit". */
    recordLabel: z.string().trim().min(1).max(30),
    fields: z.array(fieldParamSchema).min(1).max(20),
  })
  .strict();
export type SimpleFormParams = z.infer<typeof paramsSchema>;

/** Field type from its label alone — deterministic, conservative (defaults to text). */
export function inferFieldType(label: string): FieldParam['type'] {
  const l = label.toLowerCase();
  if (/\b(?:date|dob|birthday|birth date|day of|when|tareekh|tarikh)\b|तारीख/.test(l)) return 'date';
  if (/\b(?:present|attended|paid|done|completed|yes\/no|agree|married|active|vaccinated)\b|\?$/.test(l)) return 'boolean';
  if (/\b(?:age|qty|quantity|amount|price|cost|count|number of|weight|height|marks|score|fee|fees|salary|rate|total|kg|years|umar)\b/.test(l)) return 'number';
  return 'text';
}

export const simpleFormTemplate: KalamTemplate<SimpleFormParams> = {
  id: 'simple_form',
  title: 'Simple form',
  description: 'A form with your own fields that saves each entry into a browsable register.',
  strongKeywords: ['form', 'register', 'registration', 'survey', 'sign up sheet', 'attendance', 'record book', 'entry form', 'रजिस्टर', 'फॉर्म'],
  keywords: [
    'form', 'register', 'registration', 'survey', 'questionnaire', 'fields', 'collect', 'entries', 'record',
    'attendance', 'visitors', 'sign up', 'details', 'register book', 'रजिस्टर', 'फॉर्म',
  ],
  examples: ['Registration form with name, phone number, age and email', 'Visitor register with name, date and purpose'],
  paramsSchema,
  defaults: {
    name: 'Form', theme: 'calm_green', recordLabel: 'Entry',
    fields: [
      { label: 'Name', type: 'text', required: true },
      { label: 'Phone', type: 'text' },
      { label: 'Date', type: 'date' },
      { label: 'Note', type: 'text' },
    ],
  },
  extractParams(text) {
    const out: Partial<SimpleFormParams> = extractBase(text);
    const labels = extractList(text, ['fields', 'asking for', 'ask for', 'collect', 'columns', 'with', 'for'], 20);
    if (labels) {
      out.fields = labels.map((label, i) => ({ label, type: inferFieldType(label), ...(i === 0 ? { required: true } : {}) }));
    }
    const t = text.toLowerCase();
    if (/attendance|हाजिरी|haziri|hajiri/.test(t)) { out.recordLabel = 'Attendance'; out.name ??= 'Attendance'; }
    else if (/visitor/.test(t)) { out.recordLabel = 'Visit'; out.name ??= 'Visitor register'; }
    else if (/registration|sign ?up/.test(t)) { out.recordLabel = 'Registration'; out.name ??= 'Registrations'; }
    else if (/survey|feedback|questionnaire/.test(t)) { out.recordLabel = 'Response'; out.name ??= 'Survey'; }
    return out;
  },
  build(p, opts) {
    const used = new Set<string>();
    const fields: Record<string, KalamField> = {};
    const inputs: KalamComponent[] = [];
    for (const f of p.fields.slice(0, 20)) {
      const id = toIdentifier(f.label, used);
      const label = f.label.slice(0, 60);
      const required = f.required ? { required: true } : {};
      const options = [...new Set((f.options ?? []).map((o) => o.trim()).filter(Boolean))];
      const type = f.type === 'enum' && options.length === 0 ? 'text' : f.type;
      switch (type) {
        case 'number':
          fields[id] = { type, label, ...required };
          inputs.push({ id: `${id}_input`, type: 'number', label, field: id, ...required });
          break;
        case 'date':
          fields[id] = { type, label, ...required, ...(/^(?:date|today|visit date|entry date)$/i.test(label) ? { defaultValue: 'today' as const } : {}) };
          inputs.push({ id: `${id}_input`, type: 'date', label, field: id, ...required });
          break;
        case 'boolean':
          fields[id] = { type, label, defaultValue: false };
          inputs.push({ id: `${id}_input`, type: 'toggle', label, field: id });
          break;
        case 'enum':
          fields[id] = { type, label, ...required, options, defaultValue: options[0] };
          inputs.push({ id: `${id}_input`, type: 'choice', label, field: id, ...required });
          break;
        default: {
          const multiline = /address|note|comment|description|feedback|remarks|message|pata/i.test(label);
          fields[id] = { type: 'text', label, ...required, ...(multiline ? { multiline: true } : {}), maxLength: multiline ? 1000 : 200 };
          inputs.push({ id: `${id}_input`, type: 'textInput', label, field: id, ...required, ...(multiline ? { multiline: true } : {}) });
        }
      }
    }
    const ids = Object.keys(fields);
    const primary = ids.find((id) => fields[id]?.type === 'text') ?? ids[0] ?? 'entry';
    const secondary = ids.find((id) => id !== primary);
    const noun = p.recordLabel;
    const lower = noun.toLowerCase();
    return assembleSpec(
      {
        templateId: 'simple_form',
        name: p.name,
        description: `Fill in ${ids.length} field${ids.length === 1 ? '' : 's'} and keep every ${lower} in a register on this device.`,
        glyph: 'clipboard',
        theme: p.theme,
        collections: { entries: { label: `${noun} records`, fields } },
        screens: [
          {
            id: 'home',
            title: p.name.slice(0, 60),
            children: [
              { id: 'entry_count', type: 'stat', label: `${noun} records`, expr: 'count(entries)', format: 'integer' },
              { id: 'add_button', type: 'bigButton', label: `New ${lower}`, action: 'go_add', tone: 'primary' },
              {
                id: 'entry_list', type: 'list', source: 'entries', primary, ...(secondary ? { secondary } : {}),
                detailScreen: 'entry', emptyText: `No ${lower} records yet.`,
              },
            ],
          },
          {
            id: 'new', title: `New ${lower}`, form: 'entries',
            children: [
              ...inputs,
              { id: 'save_button', type: 'bigButton', label: 'Save', action: 'save_entries', tone: 'primary' },
              { id: 'cancel_button', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
          {
            id: 'entry', title: noun, form: 'entries',
            children: [
              ...inputs.map((c) => ({ ...c, id: `edit_${c.id}` })),
              { id: 'update_button', type: 'bigButton', label: 'Save changes', action: 'update_entries', tone: 'primary' },
              { id: 'delete_button', type: 'bigButton', label: `Delete ${lower}`, action: 'delete_entries', tone: 'danger' },
              { id: 'detail_back', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
        ],
        actions: crudActions('entries', noun, 'home', 'new'),
        intents: {
          go_add: phrases([`new ${lower}`, 'new entry', 'add entry', 'nayi entry', 'naya bharo', 'नई एंट्री']),
          save_entries: [...PHRASES.save],
          update_entries: [...PHRASES.update],
          delete_entries: [...PHRASES.remove],
          go_home: [...PHRASES.home],
        },
        tags: ['form', 'register'],
      },
      opts,
    );
  },
};
