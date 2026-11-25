import { z } from 'zod';
import type { KalamComponent, KalamField } from '../../spec/schema';
import { PHRASES, assembleSpec, baseParamsShape, cleanOptions, crudActions, extractBase, phrases, type KalamTemplate } from '../base';
import { extractList } from '../extract';

const paramsSchema = z
  .object({
    ...baseParamsShape,
    /** Optional grouping (Family, Customers…). Empty = no group field. */
    groups: z.array(z.string().trim().min(1).max(40)).max(8),
    includeEmail: z.boolean(),
    includeAddress: z.boolean(),
  })
  .strict();
export type ContactBookParams = z.infer<typeof paramsSchema>;

export const contactBookTemplate: KalamTemplate<ContactBookParams> = {
  id: 'contact_book',
  title: 'Contact book',
  description: 'Names, phone numbers and notes, sorted A to Z, with optional groups.',
  strongKeywords: ['contact', 'contacts', 'phone book', 'phonebook', 'address book', 'directory', 'phone numbers', 'sampark', 'संपर्क'],
  keywords: [
    'contact', 'contacts', 'phone', 'phone book', 'address book', 'directory', 'numbers', 'mobile', 'customers list',
    'naam aur number', 'sampark', 'number likhne', 'संपर्क',
  ],
  examples: ['A contact book with name, phone and email', 'customers ke naam aur number save karne ka app'],
  paramsSchema,
  defaults: { name: 'Contacts', theme: 'ocean_blue', groups: [], includeEmail: true, includeAddress: false },
  extractParams(text) {
    const out: Partial<ContactBookParams> = extractBase(text);
    const groups = extractList(text, ['groups', 'group', 'grouped by', 'categories'], 8);
    if (groups) out.groups = groups;
    if (/\baddress(?:es)?\b|\bpata\b|पता/i.test(text) && !/address book/i.test(text)) out.includeAddress = true;
    if (/\bno email\b|without email/i.test(text)) out.includeEmail = false;
    if (/\bcustomers?\b|\bgrahak\b|ग्राहक/i.test(text)) out.name ??= 'Customers';
    return out;
  },
  build(p, opts) {
    const groups = p.groups.length ? cleanOptions(p.groups, 'Other') : [];
    const fields: Record<string, KalamField> = {
      name: { type: 'text', label: 'Name', required: true, maxLength: 80 },
      phone: { type: 'text', label: 'Phone', placeholder: '+91 98765 43210', maxLength: 20 },
    };
    const inputs: KalamComponent[] = [
      { id: 'name_input', type: 'textInput', label: 'Name', field: 'name', required: true },
      { id: 'phone_input', type: 'textInput', label: 'Phone', field: 'phone', placeholder: '+91 98765 43210' },
    ];
    if (p.includeEmail) {
      fields.email = { type: 'text', label: 'Email', maxLength: 120 };
      inputs.push({ id: 'email_input', type: 'textInput', label: 'Email', field: 'email', placeholder: 'name@example.com' });
    }
    if (p.includeAddress) {
      fields.address = { type: 'text', label: 'Address', multiline: true, maxLength: 300 };
      inputs.push({ id: 'address_input', type: 'textInput', label: 'Address', field: 'address', multiline: true });
    }
    if (groups.length) {
      fields.group = { type: 'enum', label: 'Group', options: groups, defaultValue: groups[0] };
      inputs.push({ id: 'group_input', type: 'choice', label: 'Group', field: 'group' });
    }
    fields.note = { type: 'text', label: 'Note', multiline: true, maxLength: 500 };
    inputs.push({ id: 'note_input', type: 'textInput', label: 'Note', field: 'note', multiline: true });

    return assembleSpec(
      {
        templateId: 'contact_book',
        name: p.name,
        description: 'Keep names and numbers on this device, sorted A to Z.',
        glyph: 'users',
        theme: p.theme,
        collections: { contacts: { label: 'Contacts', fields } },
        screens: [
          {
            id: 'home',
            title: p.name.slice(0, 60),
            children: [
              { id: 'contact_count', type: 'stat', label: 'Contacts', expr: 'count(contacts)', format: 'integer' },
              { id: 'add_button', type: 'bigButton', label: 'Add contact', action: 'go_add', tone: 'primary' },
              {
                id: 'contact_list', type: 'list', source: 'contacts', primary: 'name', secondary: 'phone',
                sort: { field: 'name', direction: 'asc' }, detailScreen: 'contact',
                emptyText: 'No contacts yet. Add your first one.',
              },
            ],
          },
          {
            id: 'add', title: 'New contact', form: 'contacts',
            children: [
              ...inputs,
              { id: 'save_button', type: 'bigButton', label: 'Save contact', action: 'save_contacts', tone: 'primary' },
              { id: 'cancel_button', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
          {
            id: 'contact', title: 'Contact', form: 'contacts',
            children: [
              ...inputs.map((c) => ({ ...c, id: `edit_${c.id}` })),
              { id: 'update_button', type: 'bigButton', label: 'Save changes', action: 'update_contacts', tone: 'primary' },
              { id: 'delete_button', type: 'bigButton', label: 'Delete contact', action: 'delete_contacts', tone: 'danger' },
              { id: 'detail_back', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
        ],
        actions: crudActions('contacts', 'Contact', 'home', 'add'),
        intents: {
          go_add: phrases(['add contact', 'new contact', 'naya contact', 'number save karo', 'नया संपर्क']),
          save_contacts: [...PHRASES.save],
          update_contacts: [...PHRASES.update],
          delete_contacts: [...PHRASES.remove],
          go_home: [...PHRASES.home],
        },
        tags: ['contacts'],
      },
      opts,
    );
  },
};
