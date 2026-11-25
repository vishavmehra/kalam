import { z } from 'zod';
import { PHRASES, assembleSpec, baseParamsShape, crudActions, extractBase, phrases, type KalamTemplate } from '../base';

const paramsSchema = z
  .object({
    ...baseParamsShape,
    /** Singular noun: "Note", "Idea", "Diary entry". */
    noteLabel: z.string().trim().min(1).max(30),
  })
  .strict();
export type NotesParams = z.infer<typeof paramsSchema>;

export const notesTemplate: KalamTemplate<NotesParams> = {
  id: 'notes',
  title: 'Notes',
  description: 'Write dated notes, browse them newest first, edit or delete any note.',
  strongKeywords: ['notes', 'notebook', 'note taking', 'diary', 'journal', 'notepad', 'diary likhna', 'डायरी', 'नोट्स'],
  keywords: ['note', 'notes', 'notebook', 'diary', 'journal', 'notepad', 'ideas', 'write', 'likhna', 'likho', 'डायरी', 'नोट्स'],
  examples: ['A simple notes app', 'Daily diary to write my thoughts', 'ideas likhne ke liye notebook'],
  paramsSchema,
  defaults: { name: 'Notes', theme: 'warm_paper', noteLabel: 'Note' },
  extractParams(text) {
    const out: Partial<NotesParams> = extractBase(text);
    const t = text.toLowerCase();
    if (/\bdiary\b|\bjournal\b|डायरी/.test(t)) { out.noteLabel = 'Entry'; out.name ??= /journal/.test(t) ? 'Journal' : 'Diary'; }
    else if (/\bideas?\b/.test(t)) { out.noteLabel = 'Idea'; out.name ??= 'Ideas'; }
    return out;
  },
  build(p, opts) {
    const noun = p.noteLabel;
    const lower = noun.toLowerCase();
    const inputs = [
      { id: 'title_input', type: 'textInput', label: 'Title', field: 'title', required: true } as const,
      { id: 'body_input', type: 'textInput', label: noun, field: 'body', multiline: true, placeholder: 'Write here…' } as const,
      { id: 'date_input', type: 'date', label: 'Date', field: 'date' } as const,
    ];
    return assembleSpec(
      {
        templateId: 'notes',
        name: p.name,
        description: `Write ${lower}s, find them by date and keep them on this device.`,
        glyph: 'notebook',
        theme: p.theme,
        collections: {
          notes: {
            label: `${noun}s`,
            fields: {
              title: { type: 'text', label: 'Title', required: true, maxLength: 120 },
              body: { type: 'text', label: noun, multiline: true, maxLength: 5000 },
              date: { type: 'date', label: 'Date', defaultValue: 'today', required: true },
            },
          },
        },
        screens: [
          {
            id: 'home',
            title: p.name.slice(0, 60),
            children: [
              { id: 'note_count', type: 'stat', label: `${noun}s`, expr: 'count(notes)', format: 'integer' },
              {
                id: 'note_list', type: 'list', source: 'notes', primary: 'title', secondary: 'date',
                sort: { field: 'date', direction: 'desc' }, detailScreen: 'note',
                emptyText: `No ${lower}s yet. Write your first one.`,
              },
              { id: 'new_button', type: 'bigButton', label: `New ${lower}`, action: 'go_add', tone: 'primary' },
            ],
          },
          {
            id: 'new', title: `New ${lower}`, form: 'notes',
            children: [
              ...inputs,
              { id: 'save_button', type: 'bigButton', label: `Save ${lower}`, action: 'save_notes', tone: 'primary' },
              { id: 'cancel_button', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
          {
            id: 'note', title: noun, form: 'notes',
            children: [
              ...inputs.map((c) => ({ ...c, id: `edit_${c.id}` })),
              { id: 'update_button', type: 'bigButton', label: 'Save changes', action: 'update_notes', tone: 'primary' },
              { id: 'delete_button', type: 'bigButton', label: `Delete ${lower}`, action: 'delete_notes', tone: 'danger' },
              { id: 'detail_back', type: 'bigButton', label: 'Back', action: 'go_home', tone: 'secondary' },
            ],
          },
        ],
        actions: crudActions('notes', noun, 'home', 'new'),
        intents: {
          go_add: phrases([`new ${lower}`, `write ${lower}`, 'naya note', 'likhna hai', 'नया नोट']),
          save_notes: [...PHRASES.save],
          update_notes: [...PHRASES.update],
          delete_notes: [...PHRASES.remove],
          go_home: [...PHRASES.home],
        },
        tags: ['notes'],
      },
      opts,
    );
  },
};
